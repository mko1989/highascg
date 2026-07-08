'use strict'

/**
 * Bounded exponential backoff with jitter for peer reconnect loops (WO-147 / WO-65 T65.C2).
 *
 * attempt 1 → baseMs, attempt 2 → baseMs*2, … capped at maxMs, then ±jitter applied.
 * Deterministic when a `random` function is injected (tests).
 *
 * @param {number} attempt — 1-based consecutive failure count
 * @param {object} [opts]
 * @param {number} [opts.baseMs] — first retry delay (default 1000)
 * @param {number} [opts.maxMs] — upper bound before jitter (default 30000)
 * @param {number} [opts.jitter] — ± fraction of the delay (default 0.25)
 * @param {() => number} [opts.random] — [0,1) source (default Math.random)
 * @returns {number} delay in ms, always ≥ 1 and ≤ maxMs * (1 + jitter)
 */
function computeBackoffMs(attempt, opts = {}) {
	const baseMs = Math.max(1, Math.floor(opts.baseMs ?? 1000))
	const maxMs = Math.max(baseMs, Math.floor(opts.maxMs ?? 30000))
	const jitter = Math.min(0.9, Math.max(0, opts.jitter ?? 0.25))
	const random = typeof opts.random === 'function' ? opts.random : Math.random

	const n = Math.max(1, Math.floor(attempt))
	// Cap the exponent so large attempt counts cannot overflow before Math.min.
	const exp = Math.min(n - 1, 20)
	const raw = Math.min(maxMs, baseMs * 2 ** exp)
	const spread = raw * jitter
	const jittered = raw - spread + random() * 2 * spread
	return Math.max(1, Math.round(jittered))
}

module.exports = { computeBackoffMs }
