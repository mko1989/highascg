import { sceneState } from '../lib/scene-state.js'

/**
 * Program output resolution for a main (used by inspectors / border slice math).
 * WO-532: callers that know which screen they are describing pass it — a look's inspector describes
 * the look's own screen (`mainScope`), not whichever screen is selected. Callers with no screen of
 * their own keep the active selection.
 * @param {object} stateStore
 * @param {number} [screenIdx]
 */
export function getResolutionForScreen(stateStore, screenIdx) {
	const state = stateStore.getState()
	const idx = Number.isInteger(screenIdx) && screenIdx >= 0 ? screenIdx : (sceneState.activeScreenIndex ?? 0)
	const pr = state?.channelMap?.programResolutions?.[idx]
	return pr && pr.w > 0 && pr.h > 0 ? pr : { w: 1920, h: 1080 }
}
