/**
 * WO-278 (A) — keep the server's live-hardware snapshot warm for the duration of a cable gesture.
 *
 * Measured on the box: every device-view request that needs a live snapshot costs ~40 ms when
 * the server's xrandr cache is hot and 200–1770 ms when it is not (src/utils/hardware-info.js,
 * XRANDR_CACHE_TTL_MS = 3000). Applying a cable fires several such requests back to back, so
 * only the FIRST one pays the cold price — but that first one is exactly the operator's
 * click-to-connect, which is why connections "take a while to apply".
 *
 * Arming a cable is a reliable ~0.5–2 s warning that a mutation is coming. Warming the cache
 * then moves the cold build off the critical path.
 *
 * Idle cost is zero by construction: the interval only exists between start() and stop(), i.e.
 * while a cable is armed or a re-grab is in flight. Nothing polls when nothing is being dragged.
 */

/** Under the server's 3000 ms xrandr cache TTL, so a warm entry never lapses mid-gesture. */
export const PREWARM_INTERVAL_MS = 2500

/**
 * @param {number} lastWarmAt epoch ms of the last warm, 0/NaN if never
 * @param {number} now
 * @param {number} [intervalMs]
 * @returns {boolean}
 */
export function shouldPrewarm(lastWarmAt, now, intervalMs = PREWARM_INTERVAL_MS) {
	if (!Number.isFinite(lastWarmAt) || lastWarmAt <= 0) return true
	if (!Number.isFinite(now)) return false
	return now - lastWarmAt >= intervalMs
}

/**
 * @param {object} [opts]
 * @param {() => any} [opts.warm] fire-and-forget read that warms the server cache
 * @param {number} [opts.intervalMs]
 * @param {() => number} [opts.now]
 * @param {(fn: Function, ms: number) => any} [opts.setInterval]
 * @param {(h: any) => void} [opts.clearInterval]
 */
export function createSnapshotPrewarmer(opts = {}) {
	const warm = typeof opts.warm === 'function' ? opts.warm : null
	const intervalMs = Number.isFinite(opts.intervalMs) && opts.intervalMs > 0 ? opts.intervalMs : PREWARM_INTERVAL_MS
	const nowFn = typeof opts.now === 'function' ? opts.now : () => Date.now()
	const setT = typeof opts.setInterval === 'function' ? opts.setInterval : (fn, ms) => setInterval(fn, ms)
	const clearT = typeof opts.clearInterval === 'function' ? opts.clearInterval : (h) => clearInterval(h)

	let handle = null
	let lastWarmAt = 0
	let warmCount = 0

	const tick = () => {
		const now = nowFn()
		if (!shouldPrewarm(lastWarmAt, now, intervalMs)) return
		lastWarmAt = now
		warmCount++
		try {
			const r = warm?.()
			if (r && typeof r.catch === 'function') r.catch(() => {})
		} catch {
			/* prewarm is best-effort; never let it surface to the operator */
		}
	}

	return {
		/** Warm immediately, then keep warm until stop(). Idempotent. */
		start() {
			if (handle != null) return
			tick()
			handle = setT(tick, intervalMs)
		},
		/** Tear the timer down. Idempotent. */
		stop() {
			if (handle == null) return
			clearT(handle)
			handle = null
		},
		isRunning() {
			return handle != null
		},
		stats() {
			return { warmCount, lastWarmAt }
		},
	}
}
