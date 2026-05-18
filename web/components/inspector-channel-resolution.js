import { sceneState } from '../lib/scene-state.js'

/**
 * Program output resolution for the active main (used by inspectors / border slice math).
 * @param {object} stateStore
 */
export function getResolutionForScreen(stateStore) {
	const state = stateStore.getState()
	const idx = sceneState.activeScreenIndex ?? 0
	const pr = state?.channelMap?.programResolutions?.[idx]
	return pr && pr.w > 0 && pr.h > 0 ? pr : { w: 1920, h: 1080 }
}
