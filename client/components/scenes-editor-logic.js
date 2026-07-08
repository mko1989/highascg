/**
 * Logic and math for Scenes Editor.
 */

import { sceneState } from '../lib/scene-state.js'

export function getResolutionForScreen(screenIdx, sceneState, stateStore) {
	const s = Math.max(0, screenIdx)
	const st = stateStore.getState()
	const cm = st?.channelMap || {}

	// B150.2: before Caspar INFO CONFIG is gathered, the server fills
	// `channelMap.programResolutions` with 1920×1080 *placeholders*
	// (src/config/channel-map-from-ctx.js `pickRes` default). Only
	// `channelResolutionsByChannel` is INFO-derived, so use it to tell a real
	// live resolution from the placeholder — otherwise a 3072×1728 screen lays
	// out as 1080p on the editor's first pass.

	// 1. Live channel resolution from INFO CONFIG (trusted only when INFO-backed)
	const res = cm.programResolutions?.[s]
	const programCh = cm.programChannels?.[s]
	const infoRes = programCh != null ? cm.channelResolutionsByChannel?.[programCh] : null
	if (infoRes && infoRes.w > 0 && infoRes.h > 0 && res && res.w > 0 && res.h > 0) return { w: res.w, h: res.h }

	// 2. Persisted screen destinations (settings) — present in the very first
	// state snapshot, before Caspar is even connected.
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

	// 3. Last channelMap value cached in sceneState this session (may still be
	// the pre-INFO placeholder — hence after destinations).
	const cv = sceneState.getCanvasForScreen(s)
	if (cv && cv.width > 0 && cv.height > 0) return { w: cv.width, h: cv.height }

	// 4. Raw programResolutions (placeholder or non-INFO server value), then default.
	if (res && res.w > 0 && res.h > 0) return { w: res.w, h: res.h }
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
 * @param {(id: string, forceCut: boolean, takeOpts?: { targetMains?: number[], transitionOverride?: object }) => Promise<void>} deps.takeSceneToProgram
 * @param {boolean} [deps.forceCut]
 * @param {boolean} [deps.useGlobalTransition] — B150.5: take with the deck's default/global transition instead of each look's own.
 */
export async function runLookRecall(sceneId, lookPreset, target, deps) {
	const { sendSceneToPreviewCard, takeSceneToProgram, forceCut = false, useGlobalTransition = false, showScenesToast } = deps
	const transitionOverride =
		target === 'pgm' && useGlobalTransition && !forceCut ? sceneState.getResolvedGlobalDefaultTransition() : null
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
			// Target each item's own main — with multi-main presets the armed-pill
			// fallback would take every item's look on every armed screen.
			await takeSceneToProgram(it.sceneId, forceCut, {
				targetMains: [it.mainIdx],
				...(transitionOverride ? { transitionOverride } : {}),
			})
		}
	}
}
