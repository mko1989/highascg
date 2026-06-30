/**
 * Caspar channel used for look-stack preview / compose (matches
 * {@link createScenesPreviewRuntime} `resolvePreviewAmcpChannel` when `forcePrvBus` is false).
 */

import { isPreviewBusAvailable } from './scenes-preview-look-stack.js'

/**
 * Main index for a look — respects `mainScope` (screen 2 → index 1), not only active pill.
 * @param {{ mainScope?: string } | null | undefined} scene
 * @param {{ activeScreenIndex?: number }} sceneState
 * @param {number} [overrideMainIdx] — deck column / explicit take target
 * @returns {number}
 */
export function resolveMainIndexForScene(scene, sceneState, overrideMainIdx) {
	const mapCount = 4
	if (overrideMainIdx != null && Number.isFinite(Number(overrideMainIdx))) {
		return Math.max(0, Math.min(mapCount - 1, Math.floor(Number(overrideMainIdx))))
	}
	const scope = String(scene?.mainScope || 'all')
	if (scope === 'all') return Math.max(0, sceneState?.activeScreenIndex ?? 0)
	const n = parseInt(scope, 10)
	if (Number.isFinite(n) && n >= 0 && n < mapCount) return n
	return Math.max(0, sceneState?.activeScreenIndex ?? 0)
}

/**
 * @param {object} cm - `channelMap` from state
 * @param {{ activeScreenIndex?: number, editOnPgm?: boolean }} sceneState
 * @param {{ mainScope?: string } | null | undefined} scene
 * @param {'edit' | 'pgm' | 'prv'} busMode — `edit` = mapped PRV (null on PGM-only); `pgm` / `prv` = force that bus
 * @param {number} [overrideMainIdx] — deck column when operating on a scoped look from a specific main
 * @returns {number | null}
 */
export function resolveLookStackChannelForBus(cm, sceneState, scene, busMode, overrideMainIdx) {
	const map = cm && typeof cm === 'object' ? cm : {}
	const screenCount = Math.max(1, map.screenCount ?? 1)
	const mIdx = Math.min(resolveMainIndexForScene(scene, sceneState, overrideMainIdx), screenCount - 1)
	const pgm = Number(map.programChannels?.[mIdx] ?? map.playbackChannels?.[mIdx])
	const prv = Number(map.previewChannels?.[mIdx])

	if (busMode === 'pgm') {
		return Number.isFinite(pgm) && pgm > 0 ? pgm : null
	}
	if (busMode === 'prv') {
		if (!isPreviewBusAvailable(map, mIdx)) return null
		return Number.isFinite(prv) && prv > 0 ? prv : null
	}
	// edit — same as resolvePreviewAmcpChannel(mIdx, false)
	if (!isPreviewBusAvailable(map, mIdx)) return null
	return Number.isFinite(prv) && prv > 0 ? prv : null
}
