/**
 * Logic and math for Scenes Editor.
 */

import { sceneState } from '../lib/scene-state.js'

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

	// 3. Try persisted screen destinations from live state for a faster update
	const sd = st?.screenDestinations || {}
	const dests = Array.isArray(sd.destinations) ? sd.destinations : []
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

/**
 * @param {string | null | undefined} fallbackSceneId - legacy single-id from the recall event
 * @param {object | null | undefined} lookPreset
 * @returns {{ mainIdx: number, sceneId: string }[]}
 */
export function lookRecallItemsFromPreset(fallbackSceneId, lookPreset) {
	const out = []
	if (lookPreset && typeof lookPreset === 'object' && Array.isArray(lookPreset.items) && lookPreset.items.length > 0) {
		for (const it of lookPreset.items) {
			if (!it || typeof it !== 'object' || !it.sceneId) continue
			const sid = String(it.sceneId).trim()
			if (!sid || !sceneState.getScene(sid)) continue
			const m = Number(it.mainIdx)
			const mainIdx = Number.isFinite(m) && m >= 0 && m <= 3 ? Math.floor(m) : 0
			out.push({ mainIdx, sceneId: sid })
		}
		if (out.length) return out
	}
	const sid = (lookPreset && lookPreset.sceneId) || fallbackSceneId
	if (!sid || !sceneState.getScene(String(sid))) return []
	const tm = lookPreset && typeof lookPreset.targetMain === 'number' ? lookPreset.targetMain : 0
	const mainIdx = Number.isFinite(tm) && tm >= 0 && tm <= 3 ? Math.floor(tm) : 0
	return [{ mainIdx, sceneId: String(sid) }]
}

/**
 * @param {object} deps
 * @param {(id: string, opts?: { targetMains?: number[] }) => void | Promise<void>} deps.sendSceneToPreviewCard
 * @param {(id: string, forceCut: boolean) => Promise<void>} deps.takeSceneToProgram
 * @param {boolean} [deps.forceCut]
 */
export async function runLookRecall(sceneId, lookPreset, target, deps) {
	const { sendSceneToPreviewCard, takeSceneToProgram, forceCut = false, showScenesToast } = deps
	const items = lookRecallItemsFromPreset(sceneId, lookPreset)
	if (!items.length) return
	
	const mainIndices = [...new Set(items.map(it => it.mainIdx))].sort()
	sceneState.armedScreenIndices = mainIndices
	if (mainIndices.length > 0) {
		sceneState.activeScreenIndex = mainIndices[0]
	}
	sceneState._emit('screenChange')

	if (target === 'prv' && typeof showScenesToast === 'function') {
		const name = lookPreset?.name || 'Look'
		showScenesToast(`Recall PRV: “${name}”`, 'info')
	}

	for (const it of items) {
		if (target === 'prv') {
			await sendSceneToPreviewCard(it.sceneId, { targetMains: [it.mainIdx] })
		} else {
			await takeSceneToProgram(it.sceneId, forceCut)
		}
	}
}
