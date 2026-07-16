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
 * Producers on the 2.6-dev binary report elapsed as a MONOTONIC clock that keeps counting past
 * the clip end (observed live: elapsed=462034s on a 5.04s clip whose OSC loop flag was even
 * FALSE) — with a real duration (WO-252) the raw elapsed makes remaining/progress garbage. The
 * binary's loop flag is unreliable, so we correct by MAGNITUDE, not by the flag:
 *   - elapsed within [0, duration]        -> as-is
 *   - elapsed a hair past duration, no loop -> pin to duration (a normal clip that just ended = 100%)
 *   - elapsed loop=true, OR elapsed > 2×duration -> modulo (in-iteration / monotonic-clock position)
 * The 2× guard keeps a normally-ending clip from snapping its bar back to ~0 at the finish.
 * @param {number | null} elapsed
 * @param {number | null} duration
 * @param {{ loop?: boolean }} [opts]
 * @returns {{ remaining: number | null, progress: number | null, iterationElapsed: number | null }}
 */
function computeRemainingAndProgress(elapsed, duration, opts = {}) {
	let e = Number.isFinite(elapsed) ? elapsed : null
	if (Number.isFinite(duration) && duration > 0 && Number.isFinite(e) && e > duration) {
		if (opts.loop === true || e > duration * 2) {
			e = e % duration
		} else {
			e = duration
		}
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
