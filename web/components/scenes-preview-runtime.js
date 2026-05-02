/**
 * PRV preview push queue + AMCP batching for the scenes editor (coalesced, serialized).
 */

import { api } from '../lib/api-client.js'
import { audioRouteToAudioFilter } from '../lib/audio-routes.js'
import { resolveLayerFillForAmcp } from '../lib/mixer-fill.js'
import { shouldApplyStraightAlphaKeyer } from '../lib/media-ext.js'
import { buildPipOverlayAmcpLinesAll, buildPipOverlayRemoveLines } from '../lib/pip-overlay-amcp.js'
import { getPipOverlaysFromLayer } from '../lib/pip-overlay-registry.js'
import { amcpParam, chLayerAmcp } from './scenes-shared.js'

const PREVIEW_PUSH_DEBOUNCE_MS = 30

/** Scene content on PRV uses the same layer numbers as PGM (L9 = black CG; main clips on 10, 20, 30…; PIP/CG in the band above each). */
const PREVIEW_SCENE_LAYER_MIN = 10
/** Chunk size for `/api/amcp/batch` — should match server default {@link ../../src/caspar/amcp-batch.js resolveMaxBatchCommands}. */
const AMCP_BATCH_MAX_COMMANDS = 64

/**
 * Preview pipeline: use `/api/amcp/batch` (BEGIN…COMMIT when `amcp_batch` is enabled) for PLAY/MIXER/CG.
 * `MIXER <channel> COMMIT` is stripped and sent separately after each chunk — Caspar applies deferred
 * mixer transforms on that commit; **one** commit at the end of the full queue prevents visible layer-by-layer updates.
 *
 * @param {string[]} commands
 */
async function postAmcpPreviewPipeline(commands) {
	const lines = commands.map(String).map((s) => s.trim()).filter(Boolean)
	if (lines.length === 0) return
	const commitLines = []
	const batchable = []
	for (const line of lines) {
		if (/^MIXER\s+\d+\s+COMMIT\b/i.test(line)) commitLines.push(line)
		else batchable.push(line)
	}
	for (let i = 0; i < batchable.length; i += AMCP_BATCH_MAX_COMMANDS) {
		const chunk = batchable.slice(i, i + AMCP_BATCH_MAX_COMMANDS)
		try {
			await api.post('/api/amcp/batch', { commands: chunk })
		} catch {
			try {
				await api.post('/api/amcp/raw-batch', { commands: chunk })
			} catch {
				for (const t of chunk) {
					try {
						await api.post('/api/raw', { cmd: t })
					} catch {
						/* ignore */
					}
				}
			}
		}
	}
	for (const c of commitLines) {
		try {
			await api.post('/api/raw', { cmd: c })
		} catch {
			/* ignore */
		}
	}
}

/** @param {{ sceneState: object, stateStore: object, getChannelMap: () => object, getPreviewChannel: () => number|null, getPreviewOutputResolution: () => { w: number, h: number, fps?: number } }} opts */
export function createScenesPreviewRuntime(opts) {
	const { sceneState, stateStore, getChannelMap, getPreviewChannel, getPreviewOutputResolution } = opts

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
	/** @type {string | null} */
	let previewPushTargetId = null

	let previewDebounce = null

	let previewFlushRaf = null

	async function drainPreviewPushQueue() {
		if (previewPushBusy) {
			previewPushPending = true
			return
		}
		previewPushBusy = true
		try {
			const id = previewPushTargetId ?? sceneState.editingSceneId
			previewPushTargetId = null
			if (id) {
				await pushSceneToPreview(id)
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
	 * Wait until the preview AMCP push queue is idle (e.g. after `sendSceneToPreviewCard` for tandem PixelHue).
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
			previewPushTargetId = null
			void drainPreviewPushQueue()
		}, PREVIEW_PUSH_DEBOUNCE_MS)
	}

	function flushPreviewPush() {
		if (previewDebounce != null) clearTimeout(previewDebounce)
		previewDebounce = null
		previewPushTargetId = null
		void drainPreviewPushQueue()
	}

	function scheduleFlushPreviewFromInspector() {
		if (previewFlushRaf != null) cancelAnimationFrame(previewFlushRaf)
		previewFlushRaf = requestAnimationFrame(() => {
			previewFlushRaf = null
			flushPreviewPush()
		})
	}

	/** @param {string} sceneId @param {object} scene */
	function buildPreviewContentSnapshot(sceneId, scene) {
		/** @type {Map<number, { value: string, loop: boolean, straightAlpha: boolean, contentFit: string, audioRoute: string, volume: number, muted: boolean, pipSig: string }>} */
		const contentByLayer = new Map()
		for (const l of scene.layers || []) {
			if (!l?.source?.value) continue
			contentByLayer.set(Number(l.layerNumber), {
				value: String(l.source.value),
				loop: !!l.loop,
				straightAlpha: !!l.straightAlpha,
				contentFit: l.contentFit || 'native',
				audioRoute: l.audioRoute || '1+2',
				volume: l.volume != null ? l.volume : 1,
				muted: !!l.muted,
				pipSig: JSON.stringify(getPipOverlaysFromLayer(l)),
			})
		}
		return { sceneId, contentByLayer }
	}

	/** Same clips on the same layers — only geometry / opacity / rotation may have changed. */
	function isGeometryOnlyPreview(sceneId, scene) {
		if (!lastPreviewContentSnapshot || lastPreviewContentSnapshot.sceneId !== sceneId) return false
		const prev = lastPreviewContentSnapshot.contentByLayer
		const cur = buildPreviewContentSnapshot(sceneId, scene).contentByLayer
		if (prev.size !== cur.size) return false
		for (const [num, meta] of cur) {
			const p = prev.get(num)
			if (
				!p ||
				p.value !== meta.value ||
				p.loop !== meta.loop ||
				p.straightAlpha !== meta.straightAlpha ||
				p.contentFit !== meta.contentFit ||
				p.audioRoute !== meta.audioRoute ||
				p.volume !== meta.volume ||
				p.muted !== meta.muted ||
				(p.pipSig ?? '') !== (meta.pipSig ?? '')
			) {
				return false
			}
		}
		return true
	}

	async function pushSceneToPreview(sceneId) {
		if (!sceneId) return
		const scene = sceneState.getScene(sceneId)
		if (!scene) return
		const targetMainIdx = sceneState.activeScreenIndex

		const previewCh = Number(getPreviewChannel())
		const hasPreviewBus = Number.isFinite(previewCh) && previewCh > 0
		const used = new Set()
		const prvRes = getPreviewOutputResolution()
		const previewCanvas = { width: prvRes.w, height: prvRes.h, framerate: prvRes.fps ?? 50 }
		const authoringCanvas = sceneState.getCanvasForScreen(sceneState.activeScreenIndex)

		const cm = getChannelMap()
		const targetIdxs = (() => {
			const scope = String(scene.mainScope || 'all')
			if (scope === 'all') return Array.from({ length: cm.screenCount || 1 }, (_, i) => i)
			const n = parseInt(scope, 10)
			if (Number.isFinite(n) && n >= 0 && n < (cm.screenCount || 1)) return [n]
			return [sceneState.activeScreenIndex]
		})()

		try {
			const commandsByChannel = new Map()
			const mediaListPromise = api.get('/api/media').catch(() => [])
			async function getMediaListOnce() { return mediaListPromise }

			for (const mIdx of targetIdxs) {
				const previewCh = cm.previewChannels?.[mIdx] ?? null
				if (!previewCh || previewCh <= 0) {
					sceneState.setPreviewSceneId(sceneId, mIdx)
					continue
				}

				const queue = []
				const geometryOnly = isGeometryOnlyPreview(sceneId, scene) && lastPreviewChannel === previewCh
				const relevantLayerNumbers = (() => {
					const s = new Set()
					for (const l of scene.layers || []) {
						const n = Number(l?.layerNumber)
						if (!Number.isFinite(n) || n < PREVIEW_SCENE_LAYER_MIN) continue
						if (l?.source?.value || getPipOverlaysFromLayer(l).length > 0) s.add(n)
					}
					return s
				})()

				const layersToReset = new Set(relevantLayerNumbers)
				if (lastPreviewLayers && lastPreviewLayers.size > 0) {
					for (const n of lastPreviewLayers) {
						if (Number.isFinite(n) && n >= PREVIEW_SCENE_LAYER_MIN) layersToReset.add(n)
					}
				}

				if (!geometryOnly) {
					for (const ln of [...layersToReset].sort((a, b) => a - b)) {
						const dl = chLayerAmcp(previewCh, ln)
						queue.push(`STOP ${dl}`, `MIXER ${dl} CLEAR`, ...buildPipOverlayRemoveLines(previewCh, ln, 10000))
					}
				}

				const sortedLayers = [...(scene.layers || [])].sort((a, b) => (a.layerNumber || 0) - (b.layerNumber || 0))
				const layerNumsPip = (scene.layers || []).map((l) => Number(l.layerNumber)).filter((n) => n > 0)
				const nextPipLayerInPreview = (L) => {
					const a = layerNumsPip.filter((n) => n > L)
					return a.length ? Math.min(...a) : 10000
				}

				for (const layer of sortedLayers) {
					const ln = layer.layerNumber
					const cl = chLayerAmcp(previewCh, ln)
					if (!layer.source?.value) continue

					const f = await resolveLayerFillForAmcp(layer, stateStore, mIdx, previewCanvas, getMediaListOnce, authoringCanvas)
					const clip = layer.source.value
					const wantLoop = !!layer.loop
					let playCmd = `PLAY ${cl}`
					if (clip) playCmd += ' ' + amcpParam(clip)
					if (!String(clip || '').startsWith('route://') && wantLoop) playCmd += ' LOOP'
					const af = audioRouteToAudioFilter(layer.audioRoute || '1+2')
					if (af) playCmd += ` AF ${amcpParam(af)}`
					const vol = layer.muted ? 0 : layer.volume != null ? layer.volume : 1
					const mixerPart = [
						`MIXER ${cl} ANCHOR 0 0`,
						`MIXER ${cl} FILL ${f.x} ${f.y} ${f.scaleX} ${f.scaleY} 0`,
						`MIXER ${cl} ROTATION ${layer.rotation ?? 0} 0`,
						`MIXER ${cl} OPACITY ${layer.opacity ?? 1} 0`,
						`MIXER ${cl} KEYER ${shouldApplyStraightAlphaKeyer(!!layer.straightAlpha, layer.source?.value) ? 1 : 0}`,
						`MIXER ${cl} VOLUME ${vol}`,
					]
					if (geometryOnly) queue.push(...mixerPart)
					else queue.push(playCmd, ...mixerPart)

					const nextP = nextPipLayerInPreview(ln)
					if (geometryOnly) queue.push(...buildPipOverlayRemoveLines(previewCh, ln, nextP))
					const pipOverlays = getPipOverlaysFromLayer(layer)
					if (pipOverlays.length > 0) {
						queue.push(...buildPipOverlayAmcpLinesAll(pipOverlays, previewCh, ln, f, { w: prvRes.w, h: prvRes.h }, nextP))
					}
				}

				queue.push(`MIXER ${previewCh} COMMIT`)
				commandsByChannel.set(previewCh, queue)
				sceneState.setPreviewSceneId(sceneId, mIdx)
			}

			const allCommands = [...commandsByChannel.values()].flat()
			if (allCommands.length > 0) {
				await postAmcpPreviewPipeline(allCommands)
			}

			lastPreviewLayers = new Set((scene.layers || []).filter(l => l.source?.value).map(l => Number(l.layerNumber)))
			lastPreviewContentSnapshot = buildPreviewContentSnapshot(sceneId, scene)
			lastPreviewChannel = Number(getPreviewChannel())
		} catch (e) {
			console.warn('Scene preview push failed:', e?.message || e)
		}
	}

	function sendSceneToPreviewCard(sceneId) {
		if (previewDebounce != null) clearTimeout(previewDebounce)
		previewDebounce = null
		previewPushTargetId = sceneId
		void drainPreviewPushQueue()
	}

	/** @type {number | null} */
	let lastPreviewChannel = null

	function clearLastPreviewLayers() {
		lastPreviewLayers = null
		lastPreviewContentSnapshot = null
		lastPreviewChannel = null
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

	return {
		pushSceneToPreview,
		schedulePreviewPush,
		flushPreviewPush,
		scheduleFlushPreviewFromInspector,
		/** Await the current PRV push queue (e.g. chain PixelHue after Caspar preview). */
		drainPreviewPushQueue,
		waitForPreviewPushComplete,
		sendSceneToPreviewCard,
		clearLastPreviewLayers,
		primePreviewSnapshotFromScene,
	}
}
