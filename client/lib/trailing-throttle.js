/**
 * Trailing-edge throttle for high-frequency operator gestures (WO-522).
 *
 * Drag inputs fire on every pointer move. When each change triggers a network round-trip, the
 * server sees a burst it cannot keep up with, the operator sees the result arrive late, and
 * responses can land out of order because each call was fired-and-forgotten.
 *
 * This is the same shape `scenes-preview-runtime-mixer-nudge.js` already uses for the compose
 * editor's mixer nudge — one pending timer, an in-flight guard, and a queued flag so the LAST
 * request always runs. Extracted here so the timeline editor gets the identical guarantee instead
 * of a second, subtly different implementation.
 *
 * The guarantee that matters: **the final state is always sent.** Intermediate frames may be
 * dropped — that is the point — but the value the operator settles on must reach the server, or a
 * layer ends up visibly wrong. That is why a bare `throttle` (leading-edge, drops the tail) is not
 * good enough here.
 */

/**
 * @param {() => Promise<unknown> | unknown} fn work to run, at most once per `ms`, never concurrently
 * @param {number} [ms] minimum gap between starts
 * @returns {{ (): void, flush: () => Promise<void>, cancel: () => void, pending: () => boolean }}
 */
export function createTrailingThrottle(fn, ms = 80) {
	let timer = null
	let inFlight = false
	let queued = false
	let lastRunAt = 0

	async function run() {
		timer = null
		if (inFlight) {
			// Something is already on the wire — remember to run again when it lands, rather than
			// stacking a concurrent request that could arrive out of order.
			queued = true
			return
		}
		inFlight = true
		lastRunAt = Date.now()
		try {
			await fn()
		} catch {
			/* Caller-owned errors must not kill the throttle; the next gesture still needs it. */
		} finally {
			inFlight = false
			if (queued) {
				queued = false
				schedule()
			}
		}
	}

	function schedule() {
		if (timer != null) return
		const wait = Math.max(0, ms - (Date.now() - lastRunAt))
		timer = setTimeout(run, wait)
	}

	/** Run now and wait — for gesture end, or before anything that reads the result server-side. */
	schedule.flush = async function flush() {
		if (timer != null) {
			clearTimeout(timer)
			timer = null
		}
		// Let any in-flight call finish first: starting a second concurrently is the out-of-order
		// hazard this whole helper exists to avoid.
		while (inFlight) {
			await new Promise((r) => setTimeout(r, 5))
		}
		// Cleared AFTER the wait, so `run` does not re-schedule behind us and flush really is final.
		queued = false
		await run()
	}

	schedule.cancel = function cancel() {
		if (timer != null) clearTimeout(timer)
		timer = null
		queued = false
	}

	schedule.pending = function pending() {
		return timer != null || inFlight || queued
	}

	return schedule
}
