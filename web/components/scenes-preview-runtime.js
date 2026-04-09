/**
 * PRV preview push queue + AMCP batching for the scenes editor (coalesced, serialized).
 */

import { api } from '../lib/api-client.js'
import { audioRouteToAudioFilter } from '../lib/audio-routes.js'
import { resolveLayerFillForAmcp } from '../lib/mixer-fill.js'
import { shouldApplyStraightAlphaKeyer } from '../lib/media-ext.js'
import { amcpParam, chLayerAmcp } from './scenes-shared.js'

const PREVIEW_PUSH_DEBOUNCE_MS = 300

/** Scene content on PRV uses the same layer numbers as PGM (L9 = black CG; looks use L10+). */
const PREVIEW_SCENE_LAYER_MIN = 10
/** Layers above max(used) to clear so stray frames from nudged geometry don’t linger (was a fixed 10–48 sweep). */
const PREVIEW_CLEAR_LAYER_BUFFER = 4
/** Safety cap — very deep stacks only. */
const PREVIEW_SCENE_LAYER_CLEAR_CAP = 128
/** Must match server {@link ../../src/caspar/amcp-batch.js MAX_BATCH_COMMANDS} for BEGIN…COMMIT chunks. */
const AMCP_BATCH_MAX_COMMANDS = 96

/** @param {{ sceneState: object, stateStore: object, getPreviewChannel: () => number, getPreviewOutputResolution: () => { w: number, h: number, fps?: number } }} opts */
export function createScenesPreviewRuntime(opts) {
	const { sceneState, stateStore, getPreviewChannel, getPreviewOutputResolution } = opts

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
		/** @type {Map<number, { value: string, loop: boolean, straightAlpha: boolean, contentFit: string, audioRoute: string, volume: number, muted: boolean }>} */
		const contentByLayer = new Map()
		for (const l of scene.layers || []) {
			if (!l?.source?.value) continue
			contentByLayer.set(Number(l.layerNumber), {
				value: String(l.source.value),
				loop: !!l.loop,
				straightAlpha: !!l.straightAlpha,
				contentFit: l.contentFit || 'horizontal',
				audioRoute: l.audioRoute || '1+2',
				volume: l.volume != null ? l.volume : 1,
				muted: !!l.muted,
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
				p.muted !== meta.muted
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

		const previewCh = getPreviewChannel()
		const used = new Set()
		const prvRes = getPreviewOutputResolution()
		const previewCanvas = { width: prvRes.w, height: prvRes.h, framerate: prvRes.fps ?? 50 }

		try {
			const sortedLayers = [...(scene.layers || [])].sort(
				(a, b) => (a.layerNumber || 0) - (b.layerNumber || 0)
			)
			const geometryOnly = isGeometryOnlyPreview(sceneId, scene)

			const mediaListPromise = api.get('/api/media').catch(() => [])
			async function getMediaListOnce() {
				return mediaListPromise
			}

			if (!geometryOnly) {
				const sceneMaxLayer = Math.max(
					0,
					...(scene.layers || []).map((l) => Number(l.layerNumber) || 0)
				)
				const lastMaxLayer =
					lastPreviewLayers && lastPreviewLayers.size > 0
						? Math.max(...lastPreviewLayers)
						: 0
				const clearThrough = Math.min(
					PREVIEW_SCENE_LAYER_CLEAR_CAP,
					Math.max(
						PREVIEW_SCENE_LAYER_MIN,
						sceneMaxLayer + PREVIEW_CLEAR_LAYER_BUFFER,
						lastMaxLayer + PREVIEW_CLEAR_LAYER_BUFFER
					)
				)
				/** @type {string[]} */
				const clearCmds = []
				for (let ln = PREVIEW_SCENE_LAYER_MIN; ln <= clearThrough; ln++) {
					const dl = chLayerAmcp(previewCh, ln)
					clearCmds.push(`STOP ${dl}`, `MIXER ${dl} CLEAR`)
				}
				clearCmds.push(`MIXER ${Number(previewCh)} COMMIT`)
				for (let i = 0; i < clearCmds.length; i += AMCP_BATCH_MAX_COMMANDS) {
					try {
						await api.post('/api/amcp/batch', {
							commands: clearCmds.slice(i, i + AMCP_BATCH_MAX_COMMANDS),
						})
					} catch {
						/* ignore */
					}
				}
			}

			async function applyOneLayer(layer, opts) {
				const mixerOnly = opts?.mixerOnly === true
				const ln = layer.layerNumber
				const prvL = ln
				const cl = chLayerAmcp(previewCh, prvL)
				if (!layer.source?.value) {
					if (mixerOnly) return null
					try {
						await api.post('/api/amcp/batch', {
							commands: [`STOP ${cl}`, `MIXER ${cl} CLEAR`],
						})
					} catch {
						/* ignore */
					}
					return null
				}
				try {
					const f = await resolveLayerFillForAmcp(
						layer,
						stateStore,
						sceneState.activeScreenIndex,
						previewCanvas,
						getMediaListOnce
					)
					const clip = layer.source.value
					const wantLoop = !!layer.loop
					let playCmd = `PLAY ${cl}`
					if (clip) playCmd += ' ' + amcpParam(clip)
					if (!String(clip || '').startsWith('route://') && wantLoop) playCmd += ' LOOP'
					const af = audioRouteToAudioFilter(layer.audioRoute || '1+2')
					if (af) playCmd += ` AF ${amcpParam(af)}`
					const vol = layer.muted ? 0 : layer.volume != null ? layer.volume : 1
					/** @type {string[]} */
					const mixerPart = [
						`MIXER ${cl} ANCHOR 0 0`,
						`MIXER ${cl} FILL ${f.x} ${f.y} ${f.scaleX} ${f.scaleY} 0`,
						`MIXER ${cl} ROTATION ${layer.rotation ?? 0} 0`,
						`MIXER ${cl} OPACITY ${layer.opacity ?? 1} 0`,
						`MIXER ${cl} KEYER ${
							shouldApplyStraightAlphaKeyer(!!layer.straightAlpha, layer.source?.value) ? 1 : 0
						}`,
						`MIXER ${cl} VOLUME ${vol}`,
						`MIXER ${Number(previewCh)} COMMIT`,
					]
					const cmds = mixerOnly ? mixerPart : [playCmd, ...mixerPart]
					await api.post('/api/amcp/batch', { commands: cmds })
					return prvL
				} catch (e) {
					console.warn(`Scene preview layer ${ln} failed:`, e?.message || e)
					return null
				}
			}

			for (const layer of sortedLayers) {
				const done = await applyOneLayer(layer, { mixerOnly: geometryOnly })
				if (done != null) used.add(done)
			}

			lastPreviewLayers = used
			lastPreviewContentSnapshot = buildPreviewContentSnapshot(sceneId, scene)
			sceneState.setPreviewSceneId(sceneId)
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

	function clearLastPreviewLayers() {
		lastPreviewLayers = null
		lastPreviewContentSnapshot = null
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
		drainPreviewPushQueue,
		sendSceneToPreviewCard,
		clearLastPreviewLayers,
		primePreviewSnapshotFromScene,
	}
}
