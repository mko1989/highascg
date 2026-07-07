/**
 * Program canvas for timeline clip geometry — matches playback sendTo screen + program resolution.
 */
import { timelineState } from './timeline-state.js'
import { getResolutionForScreen } from '../components/scenes-editor-logic.js'

/**
 * @param {string} [timelineId] — defaults to active timeline
 * @returns {number} 0-based screen index (never null)
 */
export function resolveTimelineScreenIdx(timelineId) {
	const id = timelineId || timelineState.getActive()?.id
	if (!id) return 0
	const sendTo = timelineState.getSendTo(id)
	const raw = sendTo?.screenIdx
	if (raw === null || raw === undefined) return 0
	const n = Number(raw)
	return Number.isFinite(n) && n >= 0 ? n : 0
}

/**
 * @param {string} [timelineId]
 * @param {import('./scene-state.js').SceneState} sceneState
 * @param {import('./state-store.js').StateStore} stateStore
 * @returns {{ w: number, h: number, screenIdx: number }}
 */
export function getTimelineProgramResolution(timelineId, sceneState, stateStore) {
	const screenIdx = resolveTimelineScreenIdx(timelineId)
	const { w, h } = getResolutionForScreen(screenIdx, sceneState, stateStore)
	return {
		w: w > 0 ? w : 1920,
		h: h > 0 ? h : 1080,
		screenIdx,
	}
}

/**
 * Canvas object for fill math / coordinate-origin helpers ({ width, height }).
 * @param {string} [timelineId]
 * @param {import('./scene-state.js').SceneState} sceneState
 * @param {import('./state-store.js').StateStore} stateStore
 */
export function getTimelineProgramCanvas(timelineId, sceneState, stateStore) {
	const { w, h, screenIdx } = getTimelineProgramResolution(timelineId, sceneState, stateStore)
	const base = sceneState.getCanvasForScreen(screenIdx)
	return {
		width: w,
		height: h,
		framerate: base?.framerate ?? 50,
		screenIdx,
	}
}
