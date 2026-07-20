'use strict'

/**
 * WO-280 — backpressure primitives for the ffmpeg_jpeg compose preview.
 *
 * The JPEG compose preview rewrites `chN.jpg` at the configured fps (25 fps → a new
 * frame every 40 ms) and the server broadcasts `compose.preview` on every mtime change.
 * Each connected browser then GETs the full frame, so the disk read cost scaled with
 * `clients × channels × fps` — a laptop tab left open in the background was enough to
 * make the operator GUI lag. These helpers give the HTTP path a single-flight join
 * (one read per frame no matter how many clients ask for it) and a capped exponential
 * backoff that logs once per health transition instead of once per frame.
 *
 * Kept dependency-free and side-effect-free so it is unit-testable offline (no ffmpeg,
 * no Caspar, no network). The client mirror lives in
 * `client/lib/compose-preview-backpressure.js` — the two schedules must stay identical.
 */

/** First retry delay after a failure. */
const BACKOFF_BASE_MS = 1000
/** Backoff ceiling — a permanently broken channel retries at most this slowly. */
const BACKOFF_MAX_MS = 30000
/** Multiplier per consecutive failure. */
const BACKOFF_FACTOR = 2

/**
 * Capped exponential backoff schedule. `failures` is the number of *consecutive*
 * failures recorded so far, so the first failure (1) yields `baseMs`.
 *
 * Default schedule: 1000, 2000, 4000, 8000, 16000, 30000, 30000, …
 *
 * @param {number} failures - consecutive failure count (<= 0 means healthy → no delay)
 * @param {{ baseMs?: number, maxMs?: number, factor?: number }} [opts]
 * @returns {number} delay in ms before the next attempt is allowed
 */
function computeBackoffDelayMs(failures, opts = {}) {
	const n = Math.floor(Number(failures) || 0)
	if (n <= 0) return 0
	const base = Number(opts.baseMs) > 0 ? Number(opts.baseMs) : BACKOFF_BASE_MS
	const max = Number(opts.maxMs) > 0 ? Number(opts.maxMs) : BACKOFF_MAX_MS
	const factor = Number(opts.factor) > 1 ? Number(opts.factor) : BACKOFF_FACTOR
	const raw = base * Math.pow(factor, n - 1)
	// Math.pow overflows to Infinity for large n; Math.min still clamps to max.
	return Math.min(max, Math.round(raw))
}

/**
 * Single-flight join keyed by an arbitrary string. Concurrent `run()` calls for the
 * same key share one execution of `factory` and all resolve with its result; the entry
 * is dropped as soon as it settles, so the map is bounded by the number of *distinct
 * keys currently executing* (here: monitored channels), never by client count.
 *
 * Mirrors the established `_mediaClsTlsInFlight` promise-join in
 * `src/utils/periodic-sync.js` and the per-channel `_inFlight` map in
 * `src/preview/compose-preview-companion-thumb.js`.
 *
 * @returns {{ run: (key: string|number, factory: () => any) => Promise<any>, has: (key: string|number) => boolean, size: () => number, clear: () => void }}
 */
function createSingleFlight() {
	/** @type {Map<string, Promise<any>>} */
	const inFlight = new Map()

	return {
		run(key, factory) {
			const k = String(key)
			const existing = inFlight.get(k)
			if (existing) return existing
			let started
			try {
				started = Promise.resolve(factory())
			} catch (e) {
				return Promise.reject(e)
			}
			const tracked = started.finally(() => {
				// Only evict our own entry — a `clear()` between start and settle must not
				// delete a newer generation's promise.
				if (inFlight.get(k) === tracked) inFlight.delete(k)
			})
			inFlight.set(k, tracked)
			return tracked
		},
		has(key) {
			return inFlight.has(String(key))
		},
		size() {
			return inFlight.size
		},
		clear() {
			inFlight.clear()
		},
	}
}

/**
 * Per-key health gate: tracks consecutive failures, exposes the capped backoff window,
 * and reports *state changes only* so callers can log once on degrade and once on
 * recovery instead of once per frame.
 *
 * Healthy keys hold no entry at all, so the map stays bounded by the number of
 * currently-failing keys.
 *
 * @param {{ baseMs?: number, maxMs?: number, factor?: number }} [opts]
 */
function createBackoffGate(opts = {}) {
	/** @type {Map<string, { failures: number, blockedUntilMs: number, delayMs: number }>} */
	const byKey = new Map()

	/**
	 * @param {string|number} key
	 * @param {number} [nowMs]
	 * @returns {boolean} true when an attempt is allowed right now
	 */
	function canAttempt(key, nowMs = Date.now()) {
		const e = byKey.get(String(key))
		if (!e) return true
		return nowMs >= e.blockedUntilMs
	}

	/**
	 * @param {string|number} key
	 * @param {number} [nowMs]
	 * @returns {{ failures: number, delayMs: number, blockedUntilMs: number, changed: boolean }}
	 *   `changed` is true only on the healthy → degraded edge (first failure).
	 */
	function recordFailure(key, nowMs = Date.now()) {
		const k = String(key)
		const prev = byKey.get(k)
		const failures = (prev?.failures || 0) + 1
		const delayMs = computeBackoffDelayMs(failures, opts)
		const next = { failures, delayMs, blockedUntilMs: nowMs + delayMs }
		byKey.set(k, next)
		return { ...next, changed: !prev }
	}

	/**
	 * @param {string|number} key
	 * @returns {{ changed: boolean, failures: number }}
	 *   `changed` is true only on the degraded → healthy edge.
	 */
	function recordSuccess(key) {
		const k = String(key)
		const prev = byKey.get(k)
		if (!prev) return { changed: false, failures: 0 }
		byKey.delete(k)
		return { changed: true, failures: prev.failures }
	}

	return {
		canAttempt,
		recordFailure,
		recordSuccess,
		failures(key) {
			return byKey.get(String(key))?.failures || 0
		},
		delayMs(key) {
			return byKey.get(String(key))?.delayMs || 0
		},
		forget(key) {
			byKey.delete(String(key))
		},
		size() {
			return byKey.size
		},
		clear() {
			byKey.clear()
		},
	}
}

module.exports = {
	BACKOFF_BASE_MS,
	BACKOFF_MAX_MS,
	BACKOFF_FACTOR,
	computeBackoffDelayMs,
	createSingleFlight,
	createBackoffGate,
}
