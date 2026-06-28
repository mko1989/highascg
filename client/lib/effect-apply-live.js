/**
 * Live AMCP apply for mixer effect param edits (WO-74).
 * Preview bus updates go through scenes-refresh-preview; this path targets PGM / timeline on air.
 */
import { api } from './api-client.js'
import { postAmcpPreviewPipeline } from './amcp-preview-batch.js'
import { effectToAmcpLines } from './effect-registry.js'
import { previewChannelLayerForSceneLayer } from './scene-state.js'
import { TIMELINE_LAYER_BASE } from './scenes-preview-look-stack.js'
import { timelineState } from './timeline-state.js'

const EFFECT_LIVE_DEBOUNCE_MS = 80

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const _effectLiveTimers = new Map()

/**
 * @typedef {object} SceneLayerLiveContext
 * @property {'scene_layer'} kind
 * @property {import('./scene-state.js').SceneState} sceneState
 * @property {import('./state-store.js').StateStore} stateStore
 * @property {string} sceneId
 * @property {number} layerIndex
 */

/**
 * @typedef {object} TimelineClipLiveContext
 * @property {'timeline_clip'} kind
 * @property {import('./state-store.js').StateStore} stateStore
 * @property {string} timelineId
 * @property {number} layerIdx
 * @property {string} clipId
 * @property {object} clip
 */

/** @param {SceneLayerLiveContext | TimelineClipLiveContext} ctx @param {string} effectType */
function liveEffectKey(ctx, effectType) {
	if (ctx.kind === 'scene_layer') {
		return `sl:${ctx.sceneId}:${ctx.layerIndex}:${effectType}`
	}
	return `tc:${ctx.timelineId}:${ctx.layerIdx}:${ctx.clipId}:${effectType}`
}

/**
 * Debounced live MIXER apply when inspector effect params change on air.
 * @param {SceneLayerLiveContext | TimelineClipLiveContext | null | undefined} ctx
 * @param {string} effectType
 * @param {object} params
 */
export function scheduleLiveEffectApply(ctx, effectType, params) {
	if (!ctx || !effectType) return
	const key = liveEffectKey(ctx, effectType)
	const prev = _effectLiveTimers.get(key)
	if (prev) clearTimeout(prev)
	_effectLiveTimers.set(
		key,
		setTimeout(() => {
			_effectLiveTimers.delete(key)
			void pushLiveEffect(ctx, effectType, params)
		}, EFFECT_LIVE_DEBOUNCE_MS),
	)
}

/**
 * @param {SceneLayerLiveContext | TimelineClipLiveContext} ctx
 * @returns {{ channel: number, layer: number } | null}
 */
function resolveLiveEffectTarget(ctx) {
	if (ctx.kind === 'scene_layer') {
		const { sceneState, stateStore, sceneId, layerIndex } = ctx
		if (sceneState.liveSceneId !== sceneId) return null
		const scene = sceneState.getScene(sceneId)
		const layer = scene?.layers?.[layerIndex]
		if (!layer) return null
		const screenIdx = sceneState.activeScreenIndex ?? 0
		const cm = stateStore.getState()?.channelMap || {}
		const programChannels = cm.programChannels || [1]
		const channel =
			programChannels[Math.min(screenIdx, Math.max(0, programChannels.length - 1))] ?? 1
		const casparLayer = previewChannelLayerForSceneLayer(scene, layerIndex)
		return { channel: Number(channel), layer: Number(casparLayer) }
	}

	const { stateStore, timelineId, layerIdx, clipId } = ctx
	const tl = timelineState.getTimeline(timelineId)
	const liveClip = tl?.layers?.[layerIdx]?.clips?.find((c) => c.id === clipId) || ctx.clip
	if (!liveClip) return null
	const state = stateStore.getState?.() || {}
	const pb = state.timeline?.playback
	if (!pb || pb.timelineId !== timelineId) return null
	const pos = state.timeline?.tick?.position ?? pb.position ?? 0
	if (pos < liveClip.startTime || pos >= liveClip.endTime) return null

	const screenIdx = state.scene?.activeScreenIndex ?? 0
	const cm = state.channelMap || {}
	const programChannels = cm.programChannels || [1]
	const channel =
		programChannels[Math.min(screenIdx, Math.max(0, programChannels.length - 1))] ?? 1
	return { channel: Number(channel), layer: TIMELINE_LAYER_BASE + layerIdx }
}

/**
 * @param {SceneLayerLiveContext | TimelineClipLiveContext} ctx
 * @param {string} effectType
 * @param {object} params
 */
async function pushLiveEffect(ctx, effectType, params) {
	const target = resolveLiveEffectTarget(ctx)
	if (!target) return
	const { channel, layer } = target
	if (!Number.isFinite(channel) || channel < 1 || !Number.isFinite(layer) || layer < 1) return

	const cl = `${channel}-${layer}`
	const lines = effectToAmcpLines(effectType, params, cl)
	if (!lines?.length) return

	try {
		await postAmcpPreviewPipeline(lines)
	} catch (e) {
		console.warn('[EffectLive] AMCP batch failed:', e?.message || e)
	}

	try {
		await api.post('/api/mixer/effect', { channel, layer, effectType, params })
	} catch {
		/* AMCP batch is authoritative */
	}
}
