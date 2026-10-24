'use strict'

/**
 * WO-734 — how long the slideshow has been running. OSCPoint has no timer of its own (no elapsed variable or OSC
 * address in zinc-oscpoint v2), so it is timed here from its `state`: `running` and `paused` (auto-advance paused, the
 * presenter is still presenting) count, `edit` stops the clock. Back in the slideshow within GRACE_MS (an Esc by
 * mistake) carries on; later, or another presentation, starts again from zero.
 */

const GRACE_MS = 60_000

function createPresentationClock() {
	let name = ''
	let running = false
	let startedAt = 0
	let acc = 0
	let leftAt = 0

	/**
	 * @param {{ name?: string, state?: string }} v  the Companion variables as read
	 * @param {number} now  ms
	 * @returns {{ live: boolean, elapsed_s: number }}
	 */
	function update(v, now) {
		const live = v.state === 'running' || v.state === 'paused'
		const n = String(v.name || '')
		if (n && n !== name) {
			name = n
			acc = 0
			leftAt = 0
			if (running) startedAt = now
		}
		if (live && !running) {
			if (leftAt && now - leftAt > GRACE_MS) acc = 0
			running = true
			startedAt = now
		} else if (!live && running) {
			acc += now - startedAt
			running = false
			leftAt = now
		}
		return { live, elapsed_s: Math.floor((acc + (running ? now - startedAt : 0)) / 1000) }
	}

	return { update }
}

module.exports = { createPresentationClock, GRACE_MS }
