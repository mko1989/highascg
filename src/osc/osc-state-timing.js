'use strict'

/**
 * Shared timing sanity check + remaining/progress computation for file/time OSC and INFO supplement.
 * WO-235 + WO-252: guard against extreme-magnitude float garbage (e.g. elapsed ~1e-32 / duration ~1e+23)
 * observed live during mid-teardown/init; a single insane sample must not corrupt the UI timer.
 */

const SANE_MAX_SECONDS = 30 * 24 * 3600 // 30 days

/**
 * Sanity check: reject both extreme-magnitude ends (subnormal AND astronomically large).
 * Legit frame-granular seconds are never nonzero-but-smaller than ~1ms.
 * @param {number} n
 * @returns {boolean}
 */
function isSaneTimingValue(n) {
	return Number.isFinite(n) && n > -1e-3 && (n === 0 || Math.abs(n) >= 1e-3) && Math.abs(n) <= SANE_MAX_SECONDS
}

/**
 * Compute remaining/progress from elapsed and duration, following the same logic
 * as the file/time OSC branch in osc-state.js.
 * @param {number | null} elapsed
 * @param {number | null} duration
 * @returns {{ remaining: number | null, progress: number | null }}
 */
function computeRemainingAndProgress(elapsed, duration) {
	const remaining =
		Number.isFinite(duration) && Number.isFinite(elapsed) ? Math.max(0, duration - elapsed) : null
	const progress =
		Number.isFinite(duration) && duration > 0 && Number.isFinite(elapsed)
			? Math.min(1, Math.max(0, elapsed / duration))
			: null
	return { remaining, progress }
}

module.exports = {
	isSaneTimingValue,
	SANE_MAX_SECONDS,
	computeRemainingAndProgress,
}
