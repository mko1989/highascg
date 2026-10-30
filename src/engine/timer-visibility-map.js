/**
 * WO-840 — the per-screen timer visibility map a look PRESET item carries: `{ [timerId]: boolean }` for the timers
 * assigned to that item's screen (owner 30.10: timer visibility is per screen, so it lives in look presets, not in
 * looks — RULES.md "Timers"). Untrusted input (deck JSON, request bodies): only boolean values survive.
 */

'use strict'

/**
 * @param {unknown} map
 * @returns {Record<string, boolean> | null} a clean copy, or null when there is nothing usable (→ timers untouched)
 */
function sanitizeVisibilityMap(map) {
	if (!map || typeof map !== 'object' || Array.isArray(map)) return null
	const out = {}
	for (const [timerId, visible] of Object.entries(map)) {
		if (typeof visible === 'boolean') out[timerId] = visible
	}
	return Object.keys(out).length > 0 ? out : null
}

module.exports = { sanitizeVisibilityMap }
