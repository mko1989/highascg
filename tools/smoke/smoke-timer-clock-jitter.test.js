'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

// The clock module is browser ESM (client/lib). Load it via a tiny dynamic import shim so this
// stays a plain node:test file. performance.now is fed explicitly via opts.now (no globals).
let mod
async function load() {
	if (!mod) mod = await import('../../client/lib/playback-timing-clock.js')
	return mod
}

const FILE = (elapsed, duration = 100) => ({ name: 'clip', path: '/m/clip.mp4', duration, elapsed, fps: 25 })

test('timer clock: absorbs per-tick OSC jitter — does not re-anchor when the sample is within tolerance', async () => {
	const { createPlaybackTimingClock, syncPlaybackTimingClock } = await load()
	const clock = createPlaybackTimingClock()
	// First sync at t=0, elapsed=10 -> anchors and starts playing.
	syncPlaybackTimingClock(clock, FILE(10), { now: 0, forcePlaying: true })
	const anchorMs0 = clock.anchorMs
	const anchorEl0 = clock.anchorElapsed
	assert.equal(anchorEl0, 10)
	assert.equal(clock.playing, true)
	// 500ms later the smooth clock is at ~10.5. A noisy OSC sample says 10.45 (50ms behind) —
	// within tolerance, so the anchor must NOT move (that snap was the visible jitter).
	syncPlaybackTimingClock(clock, FILE(10.45), { now: 500, forcePlaying: true })
	assert.equal(clock.anchorMs, anchorMs0, 'anchorMs unchanged — clock kept extrapolating')
	assert.equal(clock.anchorElapsed, anchorEl0, 'anchorElapsed unchanged — no snap to the noisy sample')
})

test('timer clock: re-anchors on a real discontinuity (seek/loop beyond tolerance)', async () => {
	const { createPlaybackTimingClock, syncPlaybackTimingClock } = await load()
	const clock = createPlaybackTimingClock()
	syncPlaybackTimingClock(clock, FILE(10), { now: 0, forcePlaying: true })
	// A loop wrap / seek: elapsed jumps far from the extrapolated ~10.5 -> must re-anchor.
	syncPlaybackTimingClock(clock, FILE(0.2), { now: 500, forcePlaying: true })
	assert.equal(clock.anchorElapsed, 0.2, 'seek/loop re-anchors to the new position')
	assert.equal(clock.anchorMs, 500)
})

test('timer clock: extrapolation advances smoothly with wall time between absorbed samples', async () => {
	const { createPlaybackTimingClock, syncPlaybackTimingClock, extrapolatePlaybackFile } = await load()
	const clock = createPlaybackTimingClock()
	syncPlaybackTimingClock(clock, FILE(10), { now: 0, forcePlaying: true })
	// Absorbed noisy sample at 500ms, then read the extrapolation at 900ms: should be ~10.9, driven
	// by the wall clock from the ORIGINAL anchor, not snapped to either noisy sample.
	syncPlaybackTimingClock(clock, FILE(10.4), { now: 500, forcePlaying: true })
	const out = extrapolatePlaybackFile(clock, FILE(10.4), { now: 900 })
	assert.ok(Math.abs(out.elapsed - 10.9) < 0.05, `extrapolated ~10.9, got ${out.elapsed}`)
})
