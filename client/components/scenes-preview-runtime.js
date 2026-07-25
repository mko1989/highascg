/**
 * PRV preview push queue + AMCP batching for the scenes editor (coalesced, serialized).
 */

import { api } from '../lib/api-client.js'
import { buildIncomingScenePayload } from './scenes-shared.js'
import { isPreviewBusAvailable } from '../lib/scenes-preview-look-stack.js'
import { buildPreviewContentSnapshot, isGeometryOnlyPreview } from '../lib/scenes-preview-snapshot.js'
import { pushSceneToPreviewImpl } from '../lib/scenes-preview-push-scene.js'
import { createScenesPreviewGlobalBorder } from '../lib/scenes-preview-global-border.js'
import { createMixerNudge, nudgeTargetMainIdxs } from './scenes-preview-runtime-mixer-nudge.js'
import { clearPreviewBusForMainImpl } from './scenes-preview-runtime-clear.js'

const PREVIEW_PUSH_DEBOUNCE_MS = 16

/**
 * Hard ceiling before a continuously-rescheduled full push must fire: pointermove streams arrive
 * faster than the 16ms debounce, so a pure debounce starved the push for the whole drag (updates
 * only appeared when the pointer paused — the looks-editor "preview lags seconds" report).
 */
const PREVIEW_PUSH_MAX_WAIT_MS = 200

/** Debounce for the deck PRV thumbnail redraw signal — coalesces rapid inspector drags into one repaint (T155.4a). */
const DECK_THUMB_REDRAW_DEBOUNCE_MS = 120

/** @param {{ sceneState: object, stateStore: object, getChannelMap: () => object, getPreviewChannel: () => number|null, getPreviewOutputResolution: () => { w: number, h: number, fps?: number }, flushSceneDeckSync?: () => void }} opts */
export function createScenesPreviewRuntime(opts) {
	const { sceneState, stateStore, getChannelMap, getPreviewChannel, getPreviewOutputResolution, flushSceneDeckSync } = opts

	/** @type {Map<string, { sceneId: string, borderType: string }>} — key `${channel}-${layer}` */
	const lastGlobalBorderPushMeta = new Map()
	const gb = createScenesPreviewGlobalBorder({ sceneState, getChannelMap, lastGlobalBorderPushMeta })
	const {
		physicalPgmChannelForMain,
		physicalPrvChannelForMain,
		globalBorderSlotsForPreviewPush,
		borderPayloadForBorderLines,
		borderUsesCgUpdate,
		recordBorderPushMeta,
		borderMetaKey,
		recallGlobalBorderPreset,
		pushBorderOnlyNow,
		GB_LAYER_PRV_MIRROR,
	} = gb

	/**
	 * Shared preview-push state read/written by clearPreviewBusForMainImpl (scenes-preview-runtime-clear.js)
	 * as well as this closure.
	 * @type {{ lastPreviewLayers: Set<number>|null, lastPreviewContentSnapshot: ({ sceneId: string, contentByLayer: Map<number, { value: string, loop: boolean, straightAlpha: boolean }> } | null), lastPreviewChannel: number|null }}
	 */
	const previewState = { lastPreviewLayers: null, lastPreviewContentSnapshot: null, lastPreviewChannel: null }

	const mixerNudge = createMixerNudge({
		sceneState,
		getChannelMap,
		getLastPreviewContentSnapshot: () => previewState.lastPreviewContentSnapshot,
	})

	let previewPushBusy = false
	let previewPushPending = false
	/** @type {{ sceneId: string, targetMains?: number[], forcePrvBus?: boolean } | null} */
	let previewPushRequest = null

	let previewDebounce = null

	let previewFlushRaf = null

	/** @type {ReturnType<typeof setTimeout> | null} */
	let deckThumbRedrawTimer = null

	/**
	 * Canvas-mode deck PRV cells are a client-side composite of source thumbnails over `sceneState`
	 * (`scenes-editor-deck-thumb.js`); a MIXER-only push (fill/rotation/opacity, no PLAY) changes no
	 * source thumbnail URL, so nothing would otherwise tell that composite to repaint (B155.3/T155.4a).
	 * Debounced — reuses the repo's existing `window` CustomEvent redraw-signal pattern (see
	 * `timeline-redraw-request`, `dmx-redraw`) rather than a new event bus; the deck thumb painter
	 * listens for `scenes-deck-thumb-redraw` and calls its own `repaintDeckThumbs()`.
	 */
	function scheduleDeckThumbRedraw() {
		if (typeof window === 'undefined') return
		if (deckThumbRedrawTimer != null) clearTimeout(deckThumbRedrawTimer)
		deckThumbRedrawTimer = setTimeout(() => {
			deckThumbRedrawTimer = null
			window.dispatchEvent(new CustomEvent('scenes-deck-thumb-redraw'))
		}, DECK_THUMB_REDRAW_DEBOUNCE_MS)
	}

	// WO-213: Invalidate preview snapshot cache when server rewrites a PRV channel (pgm→prv exchange).
	if (typeof window !== 'undefined') {
		window.addEventListener('scenes-preview-invalidate', () => clearLastPreviewLayers())
	}

	async function drainPreviewPushQueue() {
		if (previewPushBusy) {
			previewPushPending = true
			return
		}
		previewPushBusy = true
		try {
			const req = previewPushRequest
			previewPushRequest = null
			const id = req?.sceneId ?? sceneState.editingSceneId
			const restrictMains = req?.targetMains
			const forcePrvBus = req?.forcePrvBus === true
			if (id) {
				await pushSceneToPreview(id, restrictMains, forcePrvBus)
			}
		} finally {
			previewPushBusy = false
			if (previewPushPending) {
				previewPushPending = false
				void drainPreviewPushQueue()
			}
		}
	}

	/**
	 * Wait until the preview AMCP push queue is idle (e.g. after `sendSceneToPreviewCard`).
	 */
	async function waitForPreviewPushComplete() {
		await new Promise((r) => setTimeout(r, 0))
		for (let i = 0; i < 400; i++) {
			if (!previewPushBusy && !previewPushPending) return
			await new Promise((r) => setTimeout(r, 16))
		}
	}

	/** First-schedule timestamp of the current debounce window (max-wait accounting). */
	let previewDebounceFirstAt = null

	/** Editor pushes target `editingSceneId`; a queued deck-stage request (forcePrvBus) must survive. */
	function dropEditorPushRequest() {
		if (previewPushRequest?.forcePrvBus !== true) previewPushRequest = null
	}

	function schedulePreviewPush() {
		mixerNudge.scheduleMixerNudge()
		const now = Date.now()
		if (previewDebounceFirstAt == null) previewDebounceFirstAt = now
		if (previewDebounce != null) clearTimeout(previewDebounce)
		if (now - previewDebounceFirstAt >= PREVIEW_PUSH_MAX_WAIT_MS) {
			previewDebounce = null
			previewDebounceFirstAt = null
			dropEditorPushRequest()
			void drainPreviewPushQueue()
			return
		}
		previewDebounce = setTimeout(() => {
			previewDebounce = null
			previewDebounceFirstAt = null
			dropEditorPushRequest()
			void drainPreviewPushQueue()
		}, PREVIEW_PUSH_DEBOUNCE_MS)
	}

	function flushPreviewPush() {
		/* WO-326: inspector edits flush through HERE, not schedulePreviewPush — without arming the
		 * nudge, an edit-on-PGM geometry-only edit hit pushEditsToPgmLive's early return ("the PGM
		 * nudge owns it") with no nudge ever scheduled, so inspector W/H changes never reached air.
		 * Canvas drags only worked because schedulePreviewPush arms it. */
		mixerNudge.scheduleMixerNudge()
		if (previewDebounce != null) clearTimeout(previewDebounce)
		previewDebounce = null
		previewDebounceFirstAt = null
		dropEditorPushRequest()
		void drainPreviewPushQueue()
	}

	function scheduleFlushPreviewFromInspector() {
		if (previewFlushRaf != null) cancelAnimationFrame(previewFlushRaf)
		previewFlushRaf = requestAnimationFrame(() => {
			previewFlushRaf = null
			flushPreviewPush()
		})
	}

	/**
	 * Stage a look on the PRV bus via server take API (no client look-stack AMCP).
	 * @param {string} sceneId
	 * @param {number[]|undefined} restrictMains
	 * @param {boolean} [forceCut]
	 */
	async function pushSceneToPreviewViaServer(sceneId, restrictMains, forceCut = true) {
		const scene = sceneState.getScene(sceneId)
		if (!scene) return
		flushSceneDeckSync?.()
		const cm = getChannelMap()
		let targetIdxs = (() => {
			const scope = String(scene.mainScope || 'all')
			if (scope === 'all') return Array.from({ length: cm.screenCount || 1 }, (_, i) => i)
			const n = parseInt(scope, 10)
			if (Number.isFinite(n) && n >= 0 && n < (cm.screenCount || 1)) return [n]
			return sceneState.armedScreenIndices?.length ? sceneState.armedScreenIndices : [sceneState.activeScreenIndex]
		})()
		if (Array.isArray(restrictMains) && restrictMains.length > 0) {
			const allow = new Set(restrictMains.map((x) => Number(x)).filter((n) => Number.isFinite(n)))
			const narrowed = targetIdxs.filter((i) => allow.has(i))
			targetIdxs =
				narrowed.length > 0
					? narrowed
					: [...allow].filter((i) => Number.isFinite(i) && i >= 0 && i < (cm.screenCount || 1))
		}
		for (const mIdx of targetIdxs) {
			if (!isPreviewBusAvailable(cm, mIdx)) {
				sceneState.setPreviewSceneId(sceneId, mIdx)
				continue
			}
			const programCh = Number(cm.programChannels?.[mIdx] ?? cm.playbackChannels?.[mIdx])
			if (!Number.isFinite(programCh) || programCh <= 0) continue
			const prvCh = Number(cm.previewChannels?.[mIdx])
			const fps = cm.programResolutions?.[mIdx]?.fps ?? 50
			const incomingScene = buildIncomingScenePayload(scene, {
				timeline: null,
				positionMs: 0,
				programChannel: programCh,
				mainIdx: mIdx,
				fps,
				stateStore,
				transitionTake: false,
				pgmOnly: false,
			})
			await api.post('/api/scene/take', {
				channel: programCh,
				sceneId,
				target: 'preview',
				forceCut,
				useServerLive: true,
				framerate: fps,
				incomingScene: {
					...incomingScene,
					globalBorder: sceneState.getGlobalBorderForScreen(mIdx),
				},
			})
			sceneState.setPreviewSceneId(sceneId, mIdx)
			if (Number.isFinite(prvCh) && prvCh > 0) previewState.lastPreviewChannel = prvCh
		}
		primePreviewSnapshotFromScene(sceneId)
	}

	/**
	 * WO-272 edit-on-PGM content push: the client full-push AMCP is bank-less and must NEVER touch a
	 * bank-mapped PGM channel, so CONTENT changes (clip/loop/audio/PIP — anything failing
	 * {@link isGeometryOnlyPreview}) go through the server take pipeline instead: a forceCut
	 * /api/scene/take at the PGM channel with `stageOnPreview: false` + `previewExchange: false`
	 * (leave PRV completely alone — the operator may have something staged there). Geometry/opacity/
	 * crop edits never reach here on the live path: {@link sendMixerNudge} targets PGM directly.
	 * Only mains where this look is CURRENTLY live take the cut — an edit must never put the look
	 * on an air channel it is not already on.
	 * @param {string} sceneId
	 * @param {number[]|undefined} restrictMains
	 */
	async function pushEditsToPgmLive(sceneId, restrictMains) {
		const scene = sceneState.getScene(sceneId)
		if (!scene) return
		if (previewState.lastPreviewContentSnapshot?.sceneId === sceneId && isGeometryOnlyPreview(previewState.lastPreviewContentSnapshot, scene)) {
			return /* geometry-only — the PGM nudge owns it */
		}
		const cm = getChannelMap()
		let targets = nudgeTargetMainIdxs(scene, cm, sceneState).filter((mIdx) => sceneState.getLiveSceneIdForMain?.(mIdx) === sceneId)
		if (Array.isArray(restrictMains) && restrictMains.length > 0) {
			const allow = new Set(restrictMains.map((x) => Number(x)))
			targets = targets.filter((i) => allow.has(i))
		}
		if (targets.length === 0) return
		flushSceneDeckSync?.()
		let failed = false
		for (const mIdx of targets) {
			const programCh = Number(cm.programChannels?.[mIdx] ?? cm.playbackChannels?.[mIdx])
			if (!Number.isFinite(programCh) || programCh <= 0) continue
			const fps = cm.programResolutions?.[mIdx]?.fps ?? 50
			const incomingScene = buildIncomingScenePayload(scene, {
				timeline: null,
				positionMs: 0,
				programChannel: programCh,
				mainIdx: mIdx,
				fps,
				stateStore,
				transitionTake: false,
				pgmOnly: !isPreviewBusAvailable(cm, mIdx),
			})
			try {
				await api.post('/api/scene/take', {
					channel: programCh,
					sceneId,
					forceCut: true,
					useServerLive: true,
					stageOnPreview: false,
					previewExchange: false,
					framerate: fps,
					incomingScene: {
						...incomingScene,
						globalBorder: sceneState.getGlobalBorderForScreen(mIdx),
					},
				})
			} catch (e) {
				failed = true
				console.warn('Edit-on-PGM content push failed:', e?.message || e)
			}
		}
		/* Only converge the snapshot when every target took — a stale snapshot retries on the next push. */
		if (!failed) primePreviewSnapshotFromScene(sceneId)
	}

	/**
	 * @param {string} sceneId
	 * @param {number[]|undefined} restrictMains - If set, only push AMCP / set preview state for these main indices (deck column, look recall, etc.).
	 * @param {boolean} [forcePrvBus] - When true (deck / recall), always use the mapped preview channel, not PGM from edit-on-PGM compose mode.
	 */
	async function pushSceneToPreview(sceneId, restrictMains, forcePrvBus = false) {
		if (forcePrvBus) {
			await pushSceneToPreviewViaServer(sceneId, restrictMains, true)
			return
		}
		/* WO-272 edit-on-PGM: editor pushes go to AIR, not PRV — geometry rides the PGM nudge,
		 * content changes cut through the (bank-aware) server take pipeline. */
		if (sceneState.editOnPgm === true && sceneState.editingSceneId === sceneId) {
			await pushEditsToPgmLive(sceneId, restrictMains)
			return
		}
		const out = await pushSceneToPreviewImpl({
			sceneId,
			restrictMains,
			forcePrvBus,
			sceneState,
			stateStore,
			getChannelMap,
			getPreviewOutputResolution,
			lastPreviewContentSnapshot: previewState.lastPreviewContentSnapshot,
			lastPreviewChannel: previewState.lastPreviewChannel,
			lastPreviewLayers: previewState.lastPreviewLayers,
			border: {
				slotsForPreviewPush: globalBorderSlotsForPreviewPush,
				payloadForBorderLines: borderPayloadForBorderLines,
				usesCgUpdate: borderUsesCgUpdate,
				recordPushMeta: recordBorderPushMeta,
			},
		})
		if (out) {
			previewState.lastPreviewLayers = out.lastPreviewLayers
			previewState.lastPreviewContentSnapshot = out.lastPreviewContentSnapshot
			previewState.lastPreviewChannel = out.lastPreviewChannel
			scheduleDeckThumbRedraw()
		}
	}

	/**
	 * @param {string} sceneId
	 * @param {{ targetMains?: number[], forcePrvBus?: boolean }} [opts]
	 */
	async function sendSceneToPreviewCard(sceneId, opts = {}) {
		if (previewDebounce != null) clearTimeout(previewDebounce)
		previewDebounce = null
		previewDebounceFirstAt = null
		const forcePrvBus = opts.forcePrvBus !== false
		/* Determinism (todos19.07.26): a deck recall/stage must never interleave with an in-flight
		 * editor push on the same PRV channel — the old direct `pushSceneToPreviewViaServer` call
		 * ran concurrently with the drain queue, so a stale editor push's STOP/CLEAR sweep and
		 * per-layer MIXER FILLs could land AFTER the take staged the new look (missing layers /
		 * layers wearing the previous look's transforms). Route it through the same single-flight
		 * queue: it runs strictly after, and supersedes, any queued editor push. */
		previewPushRequest = { sceneId, targetMains: opts.targetMains, forcePrvBus }
		await drainPreviewPushQueue()
		if (previewPushBusy || previewPushPending) await waitForPreviewPushComplete()
	}

	function clearLastPreviewLayers() {
		previewState.lastPreviewLayers = null
		previewState.lastPreviewContentSnapshot = null
		previewState.lastPreviewChannel = null
		lastGlobalBorderPushMeta.clear()
		mixerNudge.resetNudgeState()
	}

	/**
	 * Clear preview selection for one main and stop look-stack layers on the mapped PRV channel.
	 * When PGM and PRV share the same physical channel, only UI preview state is cleared (no AMCP).
	 * @param {number} mIdx
	 * @param {{ full?: boolean }} [opts] — `full`: also sweep timeline layers, deck decade slots, and all matrix layers on PRV (not only “last look” / occupied).
	 */
	async function clearPreviewBusForMain(mIdx, opts = {}) {
		if (previewDebounce != null) {
			clearTimeout(previewDebounce)
			previewDebounce = null
		}
		previewDebounceFirstAt = null
		previewPushRequest = null
		await clearPreviewBusForMainImpl(mIdx, opts, {
			sceneState,
			stateStore,
			getChannelMap,
			waitForPreviewPushComplete,
			physicalPgmChannelForMain,
			physicalPrvChannelForMain,
			borderPayloadForBorderLines,
			borderMetaKey,
			GB_LAYER_PRV_MIRROR,
			lastGlobalBorderPushMeta,
			ctx: previewState,
		})
	}

	/**
	 * After take, `applySceneFromTakePayload` replaces layers from the server — the next debounced push
	 * would otherwise see a "content change" vs the pre-take snapshot and run a full STOP/CLEAR sweep on PRV.
	 * Prime the snapshot from the current scene so the next push is geometry-only (mixer updates).
	 */
	function primePreviewSnapshotFromScene(sceneId) {
		const scene = sceneState.getScene(sceneId)
		if (!scene || !sceneId) return
		previewState.lastPreviewContentSnapshot = buildPreviewContentSnapshot(sceneId, scene)
		const used = new Set()
		for (const l of scene.layers || []) {
			if (l?.source?.value) used.add(Number(l.layerNumber))
		}
		previewState.lastPreviewLayers = used
	}

	/** @type {ReturnType<typeof setTimeout> | null} */
	let borderPushDebounceTimer = null

	function pushBorderOnly() {
		const jb = sceneState.borderJustEnabled
		const urgent = jb && typeof jb === 'object' && Object.values(jb).some(Boolean)
		if (urgent) {
			if (borderPushDebounceTimer) {
				clearTimeout(borderPushDebounceTimer)
				borderPushDebounceTimer = null
			}
			void pushBorderOnlyNow()
			return
		}
		if (borderPushDebounceTimer) clearTimeout(borderPushDebounceTimer)
		borderPushDebounceTimer = setTimeout(() => {
			borderPushDebounceTimer = null
			void pushBorderOnlyNow()
		}, 110)
	}

	return {
		pushSceneToPreview,
		schedulePreviewPush,
		flushPreviewPush,
		scheduleFlushPreviewFromInspector,
		/** Await the current PRV push queue before continuing (e.g. after preview recall). */
		drainPreviewPushQueue,
		waitForPreviewPushComplete,
		sendSceneToPreviewCard,
		clearLastPreviewLayers,
		clearPreviewBusForMain,
		primePreviewSnapshotFromScene,
		pushBorderOnly,
		recallGlobalBorderPreset,
	}
}
