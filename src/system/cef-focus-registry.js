'use strict'

/**
 * In-memory CDP focus target (WO-89). Set by WO-88 operator fullscreen; read by CEF bridge.
 * @typedef {{ sourceId: string, hostChannel: number, hostLayer: number, needle: string, playArg?: string, zoneId: string }} CefFocusTarget
 */

/** @type {CefFocusTarget|null} */
let focusTarget = null
/** @type {Set<(target: CefFocusTarget|null) => void>} */
const listeners = new Set()

/**
 * @returns {CefFocusTarget|null}
 */
function getCefFocusTarget() {
	return focusTarget
}

/**
 * @param {CefFocusTarget|null|undefined} target
 */
function setCefFocusTarget(target) {
	const next = target && target.needle ? { ...target } : null
	const prevKey = focusTarget ? `${focusTarget.sourceId}:${focusTarget.needle}` : ''
	const nextKey = next ? `${next.sourceId}:${next.needle}` : ''
	focusTarget = next
	if (prevKey !== nextKey) {
		for (const fn of listeners) {
			try {
				fn(focusTarget)
			} catch (_) {}
		}
	}
}

function clearCefFocusTarget() {
	setCefFocusTarget(null)
}

/**
 * @param {(target: CefFocusTarget|null) => void} fn
 * @returns {() => void}
 */
function onCefFocusChange(fn) {
	listeners.add(fn)
	return () => listeners.delete(fn)
}

/**
 * @param {object} config
 * @param {number} channel
 * @param {number} [layer]
 * @returns {CefFocusTarget|null}
 */
function cefFocusTargetForHostChannel(config, channel, layer = 1) {
	const list = Array.isArray(config?.extraLiveSources) ? config.extraLiveSources : []
	for (const item of list) {
		const ch = parseInt(String(item.hostChannel), 10)
		const lyr = parseInt(String(item.hostLayer ?? 1), 10) || 1
		if (ch !== channel) continue
		if (layer != null && lyr !== layer) continue
		const needle = String(item.cefNeedle || item.playArg || item.templateOrUrl || '').trim()
		if (!needle) continue
		return {
			sourceId: String(item.sourceId || ''),
			hostChannel: ch,
			hostLayer: lyr,
			needle,
			playArg: String(item.playArg || item.templateOrUrl || '').trim(),
			zoneId: focusTarget?.hostChannel === ch ? focusTarget.zoneId : 'multiview',
		}
	}
	return null
}

module.exports = {
	getCefFocusTarget,
	setCefFocusTarget,
	clearCefFocusTarget,
	onCefFocusChange,
	cefFocusTargetForHostChannel,
}
