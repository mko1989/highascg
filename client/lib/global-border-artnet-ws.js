/**
 * Throttled Art-Net → UI bridge for per-screen global borders.
 * Must not emit sceneState `change` (that rebuilds the deck + schedules autosave every frame).
 */
import {
	applyRemoteGlobalBorderSlot,
	applyRemoteGlobalBordersArray,
} from './scene-state-global-border.js'

/** Min interval between inspector refresh events (~6–7 Hz). */
const UI_NOTIFY_MS = 150

let uiNotifyTimer = null
/** @type {Set<number>} */
const pendingScreenIndices = new Set()

function stableBorderFingerprint(slot) {
	if (!slot || typeof slot !== 'object') return 'null'
	const p = slot.params && typeof slot.params === 'object' ? slot.params : {}
	return JSON.stringify({
		enabled: !!slot.enabled,
		type: String(slot.type || ''),
		fadeDuration: Number(slot.fadeDuration) || 25,
		mirrorBorderOnPrv: slot.mirrorBorderOnPrv === true,
		activePgmLayer: Number(slot.activePgmLayer) === 996 ? 996 : 998,
		artnetListenEnabled: slot.artnetListenEnabled !== false,
		artnetChannelMap: Array.isArray(slot.artnetChannelMap) ? slot.artnetChannelMap : null,
		params: p,
		slices: Array.isArray(slot.slices)
			? slot.slices.map((s) => ({
					x: Number(s.x) || 0,
					y: Number(s.y) || 0,
					w: Number(s.w) || 0,
					h: Number(s.h) || 0,
				}))
			: [],
	})
}

function stableBorderArrayFingerprint(arr) {
	if (!Array.isArray(arr)) return '[]'
	return JSON.stringify(arr.map((s) => stableBorderFingerprint(s)))
}

function scheduleArtnetBorderUiNotify(screenIndex) {
	if (Number.isFinite(screenIndex) && screenIndex >= 0 && screenIndex <= 3) {
		pendingScreenIndices.add(screenIndex)
	}
	if (uiNotifyTimer) return
	uiNotifyTimer = setTimeout(() => {
		uiNotifyTimer = null
		const indices = [...pendingScreenIndices]
		pendingScreenIndices.clear()
		if (indices.length === 0) return
		window.dispatchEvent(
			new CustomEvent('global-border-artnet', { detail: { screenIndices: indices } }),
		)
	}, UI_NOTIFY_MS)
}

/**
 * @returns {boolean} whether stored border data changed
 */
export function ingestArtnetGlobalBorderSync(sceneState, data) {
	if (!data || typeof data.screenIndex !== 'number') return false
	const i = Math.max(0, Math.min(3, data.screenIndex))
	const before = stableBorderFingerprint(sceneState.globalBorders[i])
	applyRemoteGlobalBorderSlot(sceneState, i, data.border, { source: 'artnet' })
	const after = stableBorderFingerprint(sceneState.globalBorders[i])
	if (before === after) return false
	scheduleArtnetBorderUiNotify(i)
	return true
}

/**
 * @returns {boolean} whether any slot changed
 */
export function ingestArtnetGlobalBordersArray(sceneState, remote) {
	const before = stableBorderArrayFingerprint(sceneState.globalBorders)
	applyRemoteGlobalBordersArray(sceneState, remote, { source: 'artnet' })
	const after = stableBorderArrayFingerprint(sceneState.globalBorders)
	if (before === after) return false
	for (let i = 0; i < 4; i++) scheduleArtnetBorderUiNotify(i)
	return true
}
