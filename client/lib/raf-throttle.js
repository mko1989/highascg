/**
 * Coalesce a burst of calls into at most one invocation per animation frame.
 *
 * WO-313: the device-view cable overlay's `window.onresize` called renderCableOverlay
 * directly. The Verlet rope cache is keyed on exact pixel coordinates, so a resize drag
 * invalidates every cable and re-runs the full rope simulation on every resize event —
 * dozens per second. The pointermove handler in device-view-events.js already used the
 * inline pending-flag idiom; this is that idiom extracted so it can be tested without a DOM.
 *
 * The trailing call runs INSIDE the frame callback (not on the leading edge), so the render
 * always sees the final geometry of the burst rather than the first.
 *
 * @param {() => void} fn - work to run at most once per frame
 * @param {(cb: () => void) => unknown} [raf] - frame scheduler; injectable for tests
 * @returns {() => void} throttled trigger
 */
export function rafThrottle(fn, raf) {
	const schedule = raf || ((cb) => globalThis.requestAnimationFrame(cb))
	let pending = false
	return () => {
		if (pending) return
		pending = true
		schedule(() => {
			pending = false
			fn()
		})
	}
}
