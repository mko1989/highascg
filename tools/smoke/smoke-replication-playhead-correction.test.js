'use strict'

/**
 * WO-147 T147.4 — playhead correction threshold / sustain / rate-limit logic.
 * Pure controller with an injected mock clock — no AMCP, no timers, no peers.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	PLAYHEAD_CORRECTION_DEFAULTS,
	normalizePlayheadCorrection,
	getPlayheadCorrectionConfig,
	createPlayheadCorrectionController,
} = require('../../src/replication/playhead-correction')

function mockClock(startMs = 1_000_000) {
	let t = startMs
	return {
		now: () => t,
		advance: (ms) => {
			t += ms
			return t
		},
	}
}

// 25 fps → 12 frames = 480 ms. Use 600 ms (15 frames) as an "over threshold" drift.
const OVER = { channel: '1', layer: '10', driftMs: 600, leaderFrame: 1500, fps: 25, clip: 'CLIP_A' }
const UNDER = { ...OVER, driftMs: 200 } // 5 frames

test('defaults: disabled, 12 frames, 5 s sustain, 10 s rate limit', () => {
	assert.equal(PLAYHEAD_CORRECTION_DEFAULTS.enabled, false)
	assert.equal(PLAYHEAD_CORRECTION_DEFAULTS.driftFrames, 12)
	assert.equal(PLAYHEAD_CORRECTION_DEFAULTS.sustainedSec, 5)
	assert.equal(PLAYHEAD_CORRECTION_DEFAULTS.minCorrectionIntervalSec, 10)

	const cfg = normalizePlayheadCorrection(undefined)
	assert.deepEqual(cfg, { ...PLAYHEAD_CORRECTION_DEFAULTS })

	// Raw (un-normalized) config slice is honored; enabled must be exactly true.
	assert.equal(getPlayheadCorrectionConfig({ replication: {} }).enabled, false)
	assert.equal(getPlayheadCorrectionConfig({ replication: { playheadCorrection: { enabled: 1 } } }).enabled, false)
	const on = getPlayheadCorrectionConfig({
		replication: { playheadCorrection: { enabled: true, driftFrames: 20, sustainedSec: 3 } },
	})
	assert.deepEqual(on, { enabled: true, driftFrames: 20, sustainedSec: 3, minCorrectionIntervalSec: 10 })
})

test('disabled controller never corrects, even on huge sustained drift', () => {
	const clock = mockClock()
	const ctl = createPlayheadCorrectionController({ now: clock.now })
	for (let i = 0; i < 20; i++) {
		const v = ctl.observe({ ...OVER, driftMs: 10_000 })
		assert.equal(v.correct, false)
		assert.equal(v.reason, 'disabled')
		clock.advance(1000)
	}
	assert.equal(ctl.getState().correctionsTotal, 0)
})

test('threshold: drift ≤ N frames never sustains; > N frames must sustain M seconds', () => {
	const clock = mockClock()
	const ctl = createPlayheadCorrectionController({ config: { enabled: true }, now: clock.now })

	assert.equal(ctl.observe(UNDER).reason, 'within_threshold')

	// Over threshold — but not yet sustained.
	assert.equal(ctl.observe(OVER).reason, 'sustaining')
	clock.advance(4000)
	assert.equal(ctl.observe(OVER).reason, 'sustaining', 'still inside 5 s sustain window')

	// Dip back under threshold resets the sustain window.
	assert.equal(ctl.observe(UNDER).reason, 'within_threshold')
	clock.advance(2000)
	assert.equal(ctl.observe(OVER).reason, 'sustaining', 'sustain restarted after recovery')

	clock.advance(5000)
	const v = ctl.observe(OVER)
	assert.equal(v.correct, true)
	assert.equal(v.command, 'CALL 1-10 SEEK 1500')
	assert.equal(ctl.getState().correctionsTotal, 1)
})

test('rate limit: max one correction per 10 s even under continuous drift', () => {
	const clock = mockClock()
	const ctl = createPlayheadCorrectionController({ config: { enabled: true }, now: clock.now })

	// Sustain then first correction.
	ctl.observe(OVER)
	clock.advance(5000)
	assert.equal(ctl.observe(OVER).correct, true)

	// Drift keeps exceeding: sustain re-arms (5 s), then rate limit blocks until 10 s.
	let corrections = 1
	for (let t = 0; t < 9500; t += 500) {
		clock.advance(500)
		const v = ctl.observe(OVER)
		if (v.correct) corrections += 1
		assert.ok(['sustaining', 'rate_limited'].includes(v.reason), `no correction inside 10 s window (${v.reason})`)
	}
	assert.equal(corrections, 1, 'only the first correction inside the 10 s window')

	// After the 10 s window (and sustain satisfied), the next correction fires.
	clock.advance(1000)
	const next = ctl.observe(OVER)
	assert.equal(next.correct, true)
	assert.equal(ctl.getState().correctionsTotal, 2)
})

test('missing/incomparable sample resets sustain (no correction from stale windows)', () => {
	const clock = mockClock()
	const ctl = createPlayheadCorrectionController({ config: { enabled: true }, now: clock.now })

	ctl.observe(OVER)
	clock.advance(4900)
	assert.equal(ctl.observe(null).reason, 'no_sample', 'gap in comparable playback resets sustain')
	clock.advance(200)
	assert.equal(ctl.observe(OVER).reason, 'sustaining', 'must re-sustain from scratch')
	assert.equal(ctl.getState().correctionsTotal, 0)
})

test('frame math respects channel fps and negative drift (follower ahead)', () => {
	const clock = mockClock()
	const ctl = createPlayheadCorrectionController({ config: { enabled: true }, now: clock.now })

	// 50 fps → 12 frames = 240 ms; 300 ms is over threshold at 50 fps but under at 25 fps.
	const at50 = { channel: '2', layer: '20', driftMs: -300, leaderFrame: 777.4, fps: 50 }
	assert.equal(ctl.observe({ ...at50, fps: 25 }).reason, 'within_threshold')
	assert.equal(ctl.observe(at50).reason, 'sustaining', 'absolute drift counts in both directions')
	clock.advance(5000)
	const v = ctl.observe(at50)
	assert.equal(v.correct, true)
	assert.equal(v.command, 'CALL 2-20 SEEK 777', 'target frame rounded, layer/channel from sample')
})
