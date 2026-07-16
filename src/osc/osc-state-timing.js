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
 *
 * Looping producers on the 2.6-dev binary report elapsed as a MONOTONIC clock that keeps
 * counting across loop iterations (observed live: elapsed=462802s on a looping bumper) —
 * once a real duration exists (WO-252), raw elapsed makes remaining/progress garbage and the
 * UI timer jump between the in-iteration and accumulated values. For looping files the
 * in-iteration position is elapsed modulo duration.
 * @param {number | null} elapsed
 * @param {number | null} duration
 * @param {{ loop?: boolean }} [opts]
 * @returns {{ remaining: number | null, progress: number | null, iterationElapsed: number | null }}
 */
function computeRemainingAndProgress(elapsed, duration, opts = {}) {
	let e = Number.isFinite(elapsed) ? elapsed : null
	if (opts.loop === true && Number.isFinite(duration) && duration > 0 && Number.isFinite(e) && e > duration) {
		e = e % duration
	}
	const remaining = Number.isFinite(duration) && Number.isFinite(e) ? Math.max(0, duration - e) : null
	const progress =
		Number.isFinite(duration) && duration > 0 && Number.isFinite(e)
			? Math.min(1, Math.max(0, e / duration))
			: null
	return { remaining, progress, iterationElapsed: e }
}

module.exports = {
	isSaneTimingValue,
	SANE_MAX_SECONDS,
	computeRemainingAndProgress,
}
