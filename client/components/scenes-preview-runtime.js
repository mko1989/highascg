/**
 * PRV preview push queue + AMCP batching for the scenes editor (coalesced, serialized).
 */

import { api } from '../lib/api-client.js'
import { postAmcpPreviewPipeline } from '../lib/amcp-preview-batch.js'
import { buildPipOverlayRemoveLines } from '../lib/pip-overlay-amcp.js'
import { amcpParam, chLayerAmcp, buildIncomingScenePayload } from './scenes-shared.js'
import {
	allMatrixLayersOnPreviewChannel,
	defaultLookDecadeLayersForSweep,
	getOccupiedPreviewLookLayersFromState,
	isPreviewBusAvailable,
	PREVIEW_SCENE_LAYER_MIN,
	TIMELINE_LAYER_BASE,
	TIMELINE_LAYER_CLEAR_COUNT,
} from '../lib/scenes-preview-look-stack.js'
import { buildPreviewContentSnapshot } from '../lib/scenes-preview-snapshot.js'
import { pushSceneToPreviewImpl } from '../lib/scenes-preview-push-scene.js'
import { createScenesPreviewGlobalBorder } from '../lib/scenes-preview-global-border.js'

const PREVIEW_PUSH_DEBOUNCE_MS = 16

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

	function schedulePreviewPush() {
		if (previewDebounce != null) clearTimeout(previewDebounce)
		previewDebounce = setTimeout(() => {
			previewDebounce = null
			previewPushRequest = null
			void drainPreviewPushQueue()
		}, PREVIEW_PUSH_DEBOUNCE_MS)
	}

	function flushPreviewPush() {
		if (previewDebounce != null) clearTimeout(previewDebounce)
		previewDebounce = null
		previewPushRequest = null
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
	 * @param {string} sceneId
	 * @param {number[]|undefined} restrictMains - If set, only push AMCP / set preview state for these main indices (deck column, look recall, etc.).
	 * @param {boolean} [forcePrvBus] - When true (deck / recall), always use the mapped preview channel, not PGM from edit-on-PGM compose mode.
	 */
	async function pushSceneToPreview(sceneId, restrictMains, forcePrvBus = false) {
		if (forcePrvBus) {
			await pushSceneToPreviewViaServer(sceneId, restrictMains, true)
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
		}
	}

	/**
	 * @param {string} sceneId
	 * @param {{ targetMains?: number[], forcePrvBus?: boolean }} [opts]
	 */
	async function sendSceneToPreviewCard(sceneId, opts = {}) {
		if (previewDebounce != null) clearTimeout(previewDebounce)
		previewDebounce = null
		const forcePrvBus = opts.forcePrvBus !== false
		if (forcePrvBus) {
			await pushSceneToPreviewViaServer(sceneId, opts.targetMains, true)
			return
		}
		previewPushRequest = { sceneId, targetMains: opts.targetMains, forcePrvBus }
		await drainPreviewPushQueue()
	}

	/** @type {number | null} */
	let lastPreviewChannel = null

	function clearLastPreviewLayers() {
		lastPreviewLayers = null
		lastPreviewContentSnapshot = null
		lastPreviewChannel = null
		lastGlobalBorderPushMeta.clear()
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
		previewPushRequest = null
		await waitForPreviewPushComplete()

		sceneState.setPreviewSceneId(null, mIdx)

		const pgmCh = physicalPgmChannelForMain(mIdx)
		const prvCh = physicalPrvChannelForMain(mIdx)
		const separatePrv = !!(prvCh && pgmCh && prvCh !== pgmCh)
		if (!separatePrv || !prvCh) return

		const previewCh = prvCh
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
			for (const n of defaultLookDecadeLayersForSweep()) occupied.add(n)
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
