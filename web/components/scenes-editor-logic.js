/**
 * Logic and math for Scenes Editor.
 */
import { applyPixelhueTandem, lookPresetHasPixelhue, pixelhueBeforeCaspar } from '../lib/pixelhue-tandem.js'

export function getResolutionForScreen(screenIdx, sceneState, stateStore) {
	const s = Math.max(0, screenIdx)
	const st = stateStore.getState()
	const cm = st?.channelMap || {}
	
	// 1. Try live channel resolution from INFO CONFIG
	const res = cm.programResolutions?.[s]
	if (res && res.w > 0 && res.h > 0) return { w: res.w, h: res.h }

	// 2. Try persisted canvas resolutions in sceneState (updated via WS)
	const cv = sceneState.getCanvasForScreen(s)
	if (cv && cv.width > 0 && cv.height > 0) return { w: cv.width, h: cv.height }

	// 3. Try looking at the tandem topology config directly for a faster update
	const top = st?.tandemTopology || {}
	const dests = Array.isArray(top.destinations) ? top.destinations : []
	const routable = dests.filter(d => d && String(d.mode || 'pgm_prv') !== 'multiview' && String(d.mode || 'pgm_prv') !== 'stream')
	const perMain = routable.filter(d => (parseInt(String(d.mainScreenIndex ?? 0), 10) || 0) === s)
	const picked = perMain.find(d => String(d.mode || 'pgm_prv') === 'pgm_prv') || perMain[0]

	if (picked) {
		if (picked.width > 0 && picked.height > 0) return { w: picked.width, h: picked.height }
		// Standard modes fallback
		const std = { PAL: [720, 576], NTSC: [720, 486], '720p5000': [1280, 720], '1080p5000': [1920, 1080] }
		if (picked.videoMode && std[picked.videoMode]) return { w: std[picked.videoMode][0], h: std[picked.videoMode][1] }
	}

	return { w: 1920, h: 1080 }
}

export async function runLookRecall(sceneId, lookPreset, target, { sendSceneToPreviewCard, waitForPreviewPushComplete, takeSceneToProgram, showScenesToast }) {
	const before = lookPreset && lookPresetHasPixelhue(lookPreset) && pixelhueBeforeCaspar(lookPreset)
	if (before) await applyPixelhueTandem(lookPreset, target, showScenesToast)
	if (target === 'prv') { sendSceneToPreviewCard(sceneId); await waitForPreviewPushComplete() }
	else await takeSceneToProgram(sceneId, false)
	if (!before && lookPreset && lookPresetHasPixelhue(lookPreset)) await applyPixelhueTandem(lookPreset, target, showScenesToast)
}
