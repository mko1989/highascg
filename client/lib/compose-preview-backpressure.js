/**
 * WO-280 — client-side backpressure for the ffmpeg_jpeg compose preview.
 *
 * The server pushes a `compose.preview` WS event on every JPEG mtime change (25 fps at
 * the default `composePreview.fps`). Browsers throttle `setInterval` in hidden tabs but
 * they do NOT throttle WebSocket delivery or `Image` loads, so a tab left open in the
 * background on a laptop kept pulling a full frame per push — N background tabs meant
 * N× server disk reads and a visibly lagging operator GUI.
 *
 * These are pure functions (no DOM, no timers) so they can be unit-tested offline. The
 * server mirror lives in `src/preview/compose-preview-backpressure.js` — the backoff
 * schedules of the two must stay identical.
 */

/** First retry delay after a failed frame load. */
export const BACKOFF_BASE_MS = 1000
/** Backoff ceiling — a permanently broken channel retries at most this slowly. */
export const BACKOFF_MAX_MS = 30000
/** Multiplier per consecutive failure. */
export const BACKOFF_FACTOR = 2

/** Meta-poll cadence while the tab is visible. */
export const POLL_VISIBLE_MS = 1000
/** Meta-poll cadence while the tab is hidden — slow, but still alive for reconnects. */
export const POLL_HIDDEN_MS = 30000
/** Minimum gap between accepted WS frame pushes while the tab is hidden. */
export const PUSH_HIDDEN_MIN_GAP_MS = 30000

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
export function computeBackoffDelayMs(failures, opts = {}) {
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
 * Meta-poll interval for the current page visibility. A hidden tab drops to a 30 s
 * heartbeat instead of 1 Hz.
 * @param {string} [visibilityState] - `document.visibilityState`
 * @param {{ visibleMs?: number, hiddenMs?: number }} [opts]
 * @returns {number}
 */
export function resolvePollIntervalMs(visibilityState, opts = {}) {
	const visibleMs = Number(opts.visibleMs) > 0 ? Number(opts.visibleMs) : POLL_VISIBLE_MS
	const hiddenMs = Number(opts.hiddenMs) > 0 ? Number(opts.hiddenMs) : POLL_HIDDEN_MS
	return visibilityState === 'hidden' ? hiddenMs : visibleMs
}

/**
 * Should a `compose.preview` WS push be turned into an actual image fetch?
 *
 * Visible tabs accept every push (the per-channel `loading` flag still caps them at one
 * outstanding request). Hidden tabs accept at most one push per `hiddenMinGapMs`, which
 * is what stops a backgrounded laptop tab from pulling 25 frames per second per channel.
 *
 * @param {string} [visibilityState] - `document.visibilityState`
 * @param {number} lastAcceptedAtMs - timestamp of the last accepted push (0 if never)
 * @param {number} nowMs
 * @param {{ hiddenMinGapMs?: number }} [opts]
 * @returns {boolean}
 */
export function shouldAcceptFramePush(visibilityState, lastAcceptedAtMs, nowMs, opts = {}) {
	if (visibilityState !== 'hidden') return true
	const gap = Number(opts.hiddenMinGapMs) > 0 ? Number(opts.hiddenMinGapMs) : PUSH_HIDDEN_MIN_GAP_MS
	const last = Number(lastAcceptedAtMs) || 0
	if (last <= 0) return true
	return Number(nowMs) - last >= gap
}
