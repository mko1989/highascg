/**
 * Initial / reapply clip geometry from media resolution + content fit (same rules as look editor).
 */
import { sceneLayerPixelRectForContentFit } from './fill-math.js'
import { fetchMediaContentResolution } from './mixer-fill.js'
import { api } from './api-client.js'

/**
 * Sets clip.fillPx from canvas size, clip.contentFit, and resolved media resolution.
 * Falls back to full canvas when resolution is unknown (same as look editor without probe).
 * @param {object} clip
 * @param {import('./timeline-state.js').TimelineStateManager} timelineState
 * @param {string} timelineId
 * @param {number} layerIdx
 * @param {string} clipId
 * @param {import('./state-store.js').StateStore} stateStore
 * @param {import('./scene-state.js').SceneState} sceneState
 */
export async function applyTimelineClipLayoutFromMedia(
	clip,
	timelineState,
	timelineId,
	layerIdx,
	clipId,
	stateStore,
	sceneState,
) {
	const canvas = sceneState.getCanvasForScreen(sceneState.activeScreenIndex)
	const cw = canvas.width > 0 ? canvas.width : 1920
	const ch = canvas.height > 0 ? canvas.height : 1080
	const cf = clip.contentFit || 'native'
	const cr = await fetchMediaContentResolution(
		clip.source,
		stateStore,
		sceneState.activeScreenIndex,
		() => api.get('/api/media'),
	)
	if (!cr?.w || !cr.h) {
		timelineState.updateClip(timelineId, layerIdx, clipId, {
			fillPx: { x: 0, y: 0, w: cw, h: ch },
		})
		return
	}
	const rect = sceneLayerPixelRectForContentFit(cw, ch, cr.w, cr.h, cf)
	timelineState.updateClip(timelineId, layerIdx, clipId, {
		fillPx: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
	})
}
