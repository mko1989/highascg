/**
 * Push Web UI selection to module backend for Companion variables + encoder actions.
 * @see main_plan.md FEAT-2
 */
import { api } from './api-client.js'
import { sceneState, previewChannelLayerForSceneLayer } from './scene-state.js'
import { multiviewState } from './multiview-state.js'
import { clipPixelRectAtLocalTime } from './timeline-clip-interp.js'

let _timer = null

/**
 * Serializable clone for Companion variables (`layerSnapshot` / `ui_selection_look_layer_json`).
 * @param {object | null | undefined} layer
 */
function layerSnapshotForCompanion(layer) {
	if (!layer || typeof layer !== 'object') return null
	try {
		return JSON.parse(JSON.stringify(layer))
	} catch {
		return null
	}
}

/**
 * @param {import('./state-store.js').StateStore} stateStore
 * @param {object|null} sel - same shape as inspector `selection` or null
 * @returns {object} POST body for /api/selection
 */
export function buildSelectionPayload(stateStore, sel) {
	if (!sel) return { context: 'none', label: '' }

	const state = stateStore?.getState?.() || {}
	const cm = state.channelMap || {}
	const timelinePos =
		state.timeline?.tick?.position ??
		state.timeline?.playback?.position ??
		0

	if (sel.type === 'sceneLayer' && sel.sceneId && typeof sel.layerIndex === 'number') {
		const screenIdx = sceneState.activeScreenIndex ?? 0
		const previewCh = cm.previewChannels?.[screenIdx] ?? cm.previewChannels?.[0] ?? 2
		const res = cm.previewResolutions?.[screenIdx] ?? cm.programResolutions?.[screenIdx] ?? { w: 1920, h: 1080 }
		const sc = sceneState.getScene(sel.sceneId)
		const layer = sc?.layers?.[sel.layerIndex]
		const fill = layer?.fill || { x: 0, y: 0, scaleX: 1, scaleY: 1 }
		return {
			context: 'scene_layer',
			label: `L${layer?.layerNumber ?? '?'}`,
			scene: {
				sceneId: sel.sceneId,
				sceneName: sc?.name || '',
				layerIndex: sel.layerIndex,
				channel: previewCh,
				casparLayer: previewChannelLayerForSceneLayer(sc, sel.layerIndex),
				screenIdx,
				res,
				fill,
				rotation: layer?.rotation ?? 0,
				opacity: layer?.opacity ?? 1,
				source: layer?.source || null,
			},
			layerSnapshot: layerSnapshotForCompanion(layer),
		}
	}

	if (sel.type === 'timelineClip' && sel.timelineId && sel.clip && typeof sel.layerIdx === 'number') {
		const clip = sel.clip
		const localMs = Math.max(0, Math.round(timelinePos - clip.startTime))
		const screenIdx = sceneState.activeScreenIndex ?? 0
		const res = cm.programResolutions?.[screenIdx] || { w: 1920, h: 1080 }
		const r = clipPixelRectAtLocalTime(clip, localMs, res.w, res.h, stateStore, screenIdx)
		return {
			context: 'timeline_clip',
			label: clip.source?.label || clip.source?.value || 'Clip',
			timeline: {
				timelineId: sel.timelineId,
				layerIdx: sel.layerIdx,
				clipId: sel.clipId || clip.id,
				aspectLocked: clip.aspectLocked !== false,
				pixelRect: { x: r.x, y: r.y, w: r.w, h: r.h },
				fill_x: r.x / res.w,
				fill_y: r.y / res.h,
				scale_x: r.w / res.w,
				scale_y: r.h / res.h,
			},
		}
	}

	if (sel.type === 'multiview' && sel.cellId) {
		const cell = multiviewState.getCell(sel.cellId)
		if (!cell) return { context: 'none', label: '' }
		const cells = multiviewState.getCells()
		const layerIndex = cells.findIndex((c) => c.id === sel.cellId) + 1
		return {
			context: 'multiview',
			label: cell.label || cell.id,
			multiview: {
				cellId: sel.cellId,
				layerIndex: layerIndex > 0 ? layerIndex : 1,
				multiviewChannel: cm.multiviewCh,
				canvasW: multiviewState.canvasWidth,
				canvasH: multiviewState.canvasHeight,
				x: cell.x,
				y: cell.y,
				w: cell.w,
				h: cell.h,
				aspectLocked: !!cell.aspectLocked,
			},
		}
	}

	if (sel.type === 'timelineLayer' && sel.timelineId && typeof sel.layerIdx === 'number') {
		return {
			context: 'none',
			label: sel.layer?.name || `Layer ${sel.layerIdx + 1}`,
		}
	}

	return { context: 'none', label: '' }
}

export function scheduleSelectionSync(stateStore, sel) {
	clearTimeout(_timer)
	_timer = setTimeout(() => {
		const payload = buildSelectionPayload(stateStore, sel)
		api.post('/api/selection', payload).catch(() => {})
	}, 100)
}
