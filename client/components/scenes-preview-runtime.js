/**
 * PRV preview push queue + AMCP batching for the scenes editor (coalesced, serialized).
 */

import { api } from '../lib/api-client.js'
import { postAmcpPreviewPipeline } from '../lib/amcp-preview-batch.js'
import { buildPipOverlayRemoveLines } from '../lib/pip-overlay-amcp.js'
import { chLayerAmcp, buildIncomingScenePayload } from './scenes-shared.js'
import {
	allMatrixLayersOnPreviewChannel,
	defaultLookLayersForSweep,
	getOccupiedPreviewLookLayersFromState,
	isPreviewBusAvailable,
	PREVIEW_SCENE_LAYER_MIN,
	TIMELINE_LAYER_BASE,
	TIMELINE_LAYER_CLEAR_COUNT,
} from '../lib/scenes-preview-look-stack.js'
import { buildPreviewContentSnapshot, isGeometryOnlyPreview } from '../lib/scenes-preview-snapshot.js'
import { pushSceneToPreviewImpl } from '../lib/scenes-preview-push-scene.js'
import { createScenesPreviewGlobalBorder } from '../lib/scenes-preview-global-border.js'
import { clearPreviewLiveOnServer } from '../lib/scene-live-sync.js'

const PREVIEW_PUSH_DEBOUNCE_MS = 16

/**
 * Hard ceiling before a continuously-rescheduled full push must fire: pointermove streams arrive
 * faster than the 16ms debounce, so a pure debounce starved the push for the whole drag (updates
 * only appeared when the pointer paused — the looks-editor "preview lags seconds" report).
 */
const PREVIEW_PUSH_MAX_WAIT_MS = 200

/**
 * Throttle for the low-latency geometry/opacity/crop nudge (POST /api/preview/mixer-nudge).
 * Cosmetic acceleration only — the full preview push / take pipeline stays authoritative and
 * converges to the same values (the server computes MIXER lines from the same fill fractions).
 */
const PREVIEW_NUDGE_THROTTLE_MS = 90

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

	/** @type {Set<number> | null} */
	let lastPreviewLayers = null

	/**
	 * After a successful push, tracks which layers had which clip so we can send MIXER-only updates
	 * (no PLAY) when only fill / rotation / opacity change — video keeps playing.
	 * @type {{ sceneId: string, contentByLayer: Map<number, { value: string, loop: boolean, straightAlpha: boolean }> } | null}
	 */
	let lastPreviewContentSnapshot = null

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
		scheduleMixerNudge()
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
		scheduleMixerNudge()
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
			if (Number.isFinite(prvCh) && prvCh > 0) lastPreviewChannel = prvCh
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
		if (lastPreviewContentSnapshot?.sceneId === sceneId && isGeometryOnlyPreview(lastPreviewContentSnapshot, scene)) {
			return /* geometry-only — the PGM nudge owns it */
		}
		const cm = getChannelMap()
		let targets = nudgeTargetMainIdxs(scene, cm).filter((mIdx) => sceneState.getLiveSceneIdForMain?.(mIdx) === sceneId)
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
			lastPreviewContentSnapshot,
			lastPreviewChannel,
			lastPreviewLayers,
			border: {
				slotsForPreviewPush: globalBorderSlotsForPreviewPush,
				payloadForBorderLines: borderPayloadForBorderLines,
				usesCgUpdate: borderUsesCgUpdate,
				recordPushMeta: recordBorderPushMeta,
			},
		})
		if (out) {
			lastPreviewLayers = out.lastPreviewLayers
			lastPreviewContentSnapshot = out.lastPreviewContentSnapshot
			lastPreviewChannel = out.lastPreviewChannel
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

	/** @type {number | null} */
	let lastPreviewChannel = null

	function clearLastPreviewLayers() {
		lastPreviewLayers = null
		lastPreviewContentSnapshot = null
		lastPreviewChannel = null
		lastGlobalBorderPushMeta.clear()
		lastNudgeSentByLayer.clear()
		lastNudgeSceneId = null
		lastNudgeTargetPgm = false
	}

	// --- Low-latency mixer nudge (POST /api/preview/mixer-nudge) -------------------------------
	// While the looks editor drags geometry/opacity/crop, send ONLY the changed layers' fill
	// fractions to the server every ~90ms; the server maps look layer → staged PRV layer and
	// computes the MIXER lines with the SAME fill math the take pipeline uses. Cosmetic
	// acceleration only: content changes and convergence stay with the full push above.

	/** @type {ReturnType<typeof setTimeout> | null} */
	let nudgeTimer = null
	let nudgeInFlight = false
	let nudgeQueued = false
	let lastNudgeAt = 0
	/** @type {Map<string, string>} `${mIdx}:${layerNumber}` → JSON of last-nudged geometry */
	const lastNudgeSentByLayer = new Map()
	/** @type {string | null} */
	let lastNudgeSceneId = null
	/** WO-272: whether the last nudge targeted PGM (edit-on-PGM) — a mode flip resets the dedup map. */
	let lastNudgeTargetPgm = false

	function nudgeCropParams(l) {
		if (!Array.isArray(l.effects)) return null
		const fx = l.effects.find((e) => e?.type === 'crop')
		return fx?.params ?? null
	}

	function nudgeGeometryKeyForLayer(l) {
		return JSON.stringify({
			fill: l.fill ?? null,
			rotation: l.rotation ?? 0,
			opacity: l.opacity ?? 1,
			crop: nudgeCropParams(l),
			/* Lock state changes the resolved FILL (unlock → stretch, WO-326b) — toggling it with
			 * an unchanged rect must still re-nudge, so it is part of the dedup identity. */
			aspectLocked: l.aspectLocked !== false,
		})
	}

	/** Minimal layer subset — the server resolves fill fractions → MIXER numbers itself. */
	function nudgeLayerPayload(l) {
		const crop = nudgeCropParams(l)
		return {
			layerNumber: l.layerNumber,
			fill: l.fill ?? null,
			rotation: l.rotation ?? 0,
			opacity: l.opacity ?? 1,
			contentFit: l.contentFit,
			fillNativeAspect: l.fillNativeAspect,
			/* WO-326b: the server's mapContentFitToStretch branches on aspectLocked === false.
			 * Omitting it here made only the NUDGE contain-fit while the full push stretched —
			 * the two writers raced at throttle boundaries and the layer "sometimes jumped back
			 * to locked" mid-drag on PRV. */
			aspectLocked: l.aspectLocked,
			source: l.source ? { type: l.source.type, value: l.source.value } : null,
			effects: crop ? [{ type: 'crop', params: crop }] : [],
		}
	}

	function nudgeTargetMainIdxs(scene, cm) {
		const scope = String(scene.mainScope || 'all')
		if (scope === 'all') return Array.from({ length: cm.screenCount || 1 }, (_, i) => i)
		const n = parseInt(scope, 10)
		if (Number.isFinite(n) && n >= 0 && n < (cm.screenCount || 1)) return [n]
		return sceneState.armedScreenIndices?.length ? sceneState.armedScreenIndices : [sceneState.activeScreenIndex]
	}

	function scheduleMixerNudge() {
		if (nudgeTimer != null) return
		const wait = Math.max(0, PREVIEW_NUDGE_THROTTLE_MS - (Date.now() - lastNudgeAt))
		nudgeTimer = setTimeout(() => {
			nudgeTimer = null
			void sendMixerNudge()
		}, wait)
	}

	async function sendMixerNudge() {
		if (nudgeInFlight) {
			nudgeQueued = true
			return
		}
		nudgeInFlight = true
		lastNudgeAt = Date.now()
		try {
			const id = sceneState.editingSceneId
			const scene = id ? sceneState.getScene(id) : null
			if (!id || !scene) return
			/* Only nudge the look our last full push/stage put on PRV, and only while the edit is
			 * geometry/opacity/crop-only — content changes (clip/loop/audio/PIP) need the full
			 * push's PLAY pipeline and must never be short-cut. */
			if (!lastPreviewContentSnapshot || lastPreviewContentSnapshot.sceneId !== id) return
			if (!isGeometryOnlyPreview(lastPreviewContentSnapshot, scene)) return
			/* WO-272 edit-on-PGM: same nudge machinery, pointed at the on-air PGM channel (the
			 * server maps logical→physical layers bank-aware and staleness-guards against what is
			 * actually live there). Only mains where this look IS live are nudged. */
			const pgmMode = sceneState.editOnPgm === true
			if (lastNudgeSceneId !== id || lastNudgeTargetPgm !== pgmMode) {
				lastNudgeSentByLayer.clear()
				lastNudgeSceneId = id
				lastNudgeTargetPgm = pgmMode
			}
			const cm = getChannelMap()
			for (const mIdx of nudgeTargetMainIdxs(scene, cm)) {
				if (pgmMode) {
					if (sceneState.getLiveSceneIdForMain?.(mIdx) !== id) continue
				} else if (!isPreviewBusAvailable(cm, mIdx)) continue
				const changed = []
				for (const l of scene.layers || []) {
					if (!l?.source?.value) continue
					const ln = Number(l.layerNumber)
					if (!Number.isFinite(ln)) continue
					const key = `${mIdx}:${ln}`
					const geom = nudgeGeometryKeyForLayer(l)
					if (lastNudgeSentByLayer.get(key) === geom) continue
					changed.push({ layer: l, key, geom })
				}
				if (changed.length === 0) continue
				const cv = sceneState.getCanvasForScreen(mIdx)
				try {
					const res = await api.post('/api/preview/mixer-nudge', {
						mainIndex: mIdx,
						sceneId: id,
						...(pgmMode ? { target: 'pgm' } : {}),
						composeCanvas: cv ? { w: cv.width, h: cv.height } : null,
						layers: changed.map((c) => nudgeLayerPayload(c.layer)),
					})
					if (res?.ok) {
						for (const c of changed) lastNudgeSentByLayer.set(c.key, c.geom)
					} else {
						/* Not staged (yet/anymore) on this PRV — never repaint a foreign look; the
						 * authoritative push restages and the next nudge retries after that. */
						for (const c of changed) lastNudgeSentByLayer.delete(c.key)
					}
				} catch {
					/* cosmetic path — the authoritative push converges */
				}
			}
		} finally {
			nudgeInFlight = false
			if (nudgeQueued) {
				nudgeQueued = false
				scheduleMixerNudge()
			}
		}
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
		await waitForPreviewPushComplete()

		sceneState.setPreviewSceneId(null, mIdx)

		// Skip clear for PGM-only mains (no separate preview bus)
		const cm = getChannelMap()
		if (!isPreviewBusAvailable(cm, mIdx)) return

		const pgmCh = physicalPgmChannelForMain(mIdx)
		const prvCh = physicalPrvChannelForMain(mIdx)
		const separatePrv = !!(prvCh && pgmCh && prvCh !== pgmCh)
		if (!separatePrv || !prvCh) return

		const previewCh = prvCh
		let clearedViaServer = false
		try {
			const res = await clearPreviewLiveOnServer(mIdx, { sceneState, stateStore })
			clearedViaServer = !!(res?.cleared || res?.clearedAmcp)
		} catch (e) {
			console.warn('Clear preview: server clear failed, falling back to client AMCP:', e?.message || e)
		}

		if (!clearedViaServer) {
			const queue = []
			const occupied = getOccupiedPreviewLookLayersFromState(stateStore, previewCh)
			if (Number(lastPreviewChannel) === Number(previewCh) && lastPreviewLayers) {
				for (const n of lastPreviewLayers) {
					if (Number.isFinite(n) && n >= PREVIEW_SCENE_LAYER_MIN && n < 10000) occupied.add(n)
				}
			}
			if (opts.full) {
				for (const n of allMatrixLayersOnPreviewChannel(stateStore, previewCh)) occupied.add(n)
				for (let ti = 0; ti < TIMELINE_LAYER_CLEAR_COUNT; ti++) occupied.add(TIMELINE_LAYER_BASE + ti)
				for (const n of defaultLookLayersForSweep()) occupied.add(n)
			}

			for (const ln of [...occupied].sort((a, b) => a - b)) {
				const dl = chLayerAmcp(previewCh, ln)
				queue.push(`STOP ${dl}`, `MIXER ${dl} CLEAR`, ...buildPipOverlayRemoveLines(previewCh, ln, 10000))
			}

			const gb = sceneState.getGlobalBorderForScreen(mIdx)
			const mirror = gb?.mirrorBorderOnPrv === true
			const include997 =
				mirror || lastGlobalBorderPushMeta.has(borderMetaKey(previewCh, GB_LAYER_PRV_MIRROR))

			if (include997) {
				try {
					const borderRes = await api.post('/api/scene/border-lines', {
						channel: previewCh,
						layer: GB_LAYER_PRV_MIRROR,
						border: borderPayloadForBorderLines(gb, false),
						isUpdate: false,
					})
					const raw = borderRes?.lines
					if (Array.isArray(raw) && raw.length > 0) queue.push(...raw)
				} catch (e) {
					console.warn('Failed to clear PRV border mirror:', e?.message || e)
				}
				lastGlobalBorderPushMeta.delete(borderMetaKey(previewCh, GB_LAYER_PRV_MIRROR))
			}

			const commitLine = `MIXER ${previewCh} COMMIT`
			queue.push(commitLine)
			if (queue.some((l) => l !== commitLine)) {
				await postAmcpPreviewPipeline(queue)
			}
		}

		if (Number(lastPreviewChannel) === Number(previewCh)) {
			lastPreviewLayers = null
			lastPreviewContentSnapshot = null
			lastPreviewChannel = null
		}
	}

	/**
	 * After take, `applySceneFromTakePayload` replaces layers from the server — the next debounced push
	 * would otherwise see a "content change" vs the pre-take snapshot and run a full STOP/CLEAR sweep on PRV.
	 * Prime the snapshot from the current scene so the next push is geometry-only (mixer updates).
	 */
	function primePreviewSnapshotFromScene(sceneId) {
		const scene = sceneState.getScene(sceneId)
		if (!scene || !sceneId) return
		lastPreviewContentSnapshot = buildPreviewContentSnapshot(sceneId, scene)
		const used = new Set()
		for (const l of scene.layers || []) {
			if (l?.source?.value) used.add(Number(l.layerNumber))
		}
		lastPreviewLayers = used
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
