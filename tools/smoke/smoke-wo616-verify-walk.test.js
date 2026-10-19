'use strict'

/**
 * WO-616 T10d — the verification walk (src/tracking/verify-walk.js) on synthetic snapshots: segment geometry (distance
 * and position along the line), cm stats, the walker pick (START_GATE_M, the line's ends, coasting predictions), the
 * sticky id, per-camera and world error, line coverage, the MIN_SAMPLES threshold, auto-stop after MAX_S, an explicit
 * person id, and reset.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const { VerifyWalk, segDist, stats, MAX_S, MIN_SAMPLES } = require(path.join(ROOT, 'src', 'tracking', 'verify-walk'))

const A = [0, 0]
const B = [4, 0]

/** A world person: fused floor position, measured this step unless age_s says it is a coasting prediction. */
const wp = (id, x, y, source = 'fused', age_s = 0) => ({ id, x, y, source, age_s })

/** One fusion step: cams = [{ id, persons: [{ tid, world, floor }] }], world = [wp, …]. */
const snap = (cams = [], world = []) => ({ cameras: cams, world: { persons: world } })

describe('WO-616 T10d verify walk', () => {
	it('segDist: distance from the segment and the position along it (t is 0–1 inside the ends)', () => {
		let s = segDist([1, 0], A, B)
		assert.equal(s.d, 0)
		assert.equal(s.t, 0.25)
		s = segDist([2, 0.3], A, B)
		assert.equal(s.d, 0.3)
		assert.equal(s.t, 0.5)
		s = segDist([6, 0], A, B)
		assert.equal(s.d, 2, 'past b: distance to the end point')
		assert.equal(s.t, 1.5)
		s = segDist([-1, 0], A, B)
		assert.equal(s.d, 1, 'before a: distance to the start point')
		assert.equal(s.t, -0.25)
	})

	it('stats: empty → nulls; [0.01, 0.03] → mean 2 cm, rms 2.2 cm, max 3 cm', () => {
		assert.deepEqual(stats([]), { n: 0, mean_cm: null, rms_cm: null, max_cm: null })
		assert.deepEqual(stats([0.01, 0.03]), { n: 2, mean_cm: 2, rms_cm: 2.2, max_cm: 3 })
	})

	it('start: rejects a non-point and a line under MIN_LENGTH_M; a 4 m line runs with no result', () => {
		const w = new VerifyWalk()
		let r = w.start({ a: 'x', b: B }, 0)
		assert.equal(r.ok, false)
		assert.equal(typeof r.error, 'string')
		r = w.start({ a: A, b: [0.3, 0] }, 0)
		assert.equal(r.ok, false)
		assert.equal(typeof r.error, 'string')
		assert.equal(w.status(0).running, false, 'a rejected start does not begin a walk')
		assert.deepEqual(w.start({ a: A, b: B }, 0), { ok: true })
		const st = w.status(0)
		assert.equal(st.running, true)
		assert.equal(st.result, null)
	})

	it('walker pick: the fresh person within the gate is taken, then kept by id even when a closer one appears', () => {
		const w = new VerifyWalk()
		w.start({ a: A, b: B }, 0)
		w.sample(snap([], [wp(1, 2, 0.3), wp(2, 2, 3)]), 0)
		assert.equal(w.status(0).live.person, 1, 'id 2 is 3 m off, outside the gate')
		for (let i = 1; i <= 4; i++) w.sample(snap([], [wp(1, 2, 0.3), wp(2, 2, 0.1)]), i * 67)
		const r = w.stop(268)
		assert.equal(r.person, 1)
		assert.equal(r.samples, 5)
		assert.equal(r.world.mean_cm, 30, 'every sample recorded id 1 at 0.3 m')
	})

	it('a person beyond the ends of the line (t outside 0–1) is not picked, however close', () => {
		const w = new VerifyWalk()
		w.start({ a: A, b: B }, 0)
		w.sample(snap([], [wp(3, -0.5, 0.1), wp(4, 4.5, 0.1)]), 0)
		assert.equal(w.status(0).live.person, null)
		assert.equal(w.status(0).live.samples, 0)
		w.sample(snap([], [wp(3, -0.5, 0.1), wp(5, 2, 0.5)]), 67)
		assert.equal(w.status(67).live.person, 5, 'the one standing on the line is picked')
	})

	it('coasting persons (age_s > 0) are neither picked nor sampled', () => {
		const w = new VerifyWalk()
		w.start({ a: A, b: B }, 0)
		w.sample(snap([], [wp(1, 2, 0.1, 'fused', 0.2)]), 0)
		const st = w.status(0)
		assert.equal(st.live.person, null)
		assert.equal(st.live.samples, 0)
	})

	it('per-camera stats: only the walker’s own boxes count; world error is the fused position', () => {
		const w = new VerifyWalk()
		w.start({ a: A, b: B }, 0)
		const cams = [
			{
				id: 'cam_1',
				persons: [
					{ tid: 1, world: 1, floor: [2, 0.05] },
					{ tid: 9, world: 9, floor: [2, 0.5] },
				],
			},
			{ id: 'cam_2', persons: [{ tid: 5, world: 1, floor: [2, 0.2] }] },
		]
		w.sample(snap(cams, [wp(1, 2, 0.1)]), 0)
		const r = w.stop(0)
		assert.deepEqual(Object.keys(r.cameras), ['cam_1', 'cam_2'])
		assert.equal(r.cameras.cam_1.mean_cm, 5)
		assert.equal(r.cameras.cam_2.mean_cm, 20)
		assert.equal(r.world.mean_cm, 10)
	})

	it('coverage: a walk over 40 even steps covers the whole line; the first half covers 0.5', () => {
		const full = new VerifyWalk()
		full.start({ a: A, b: B }, 0)
		for (let i = 0; i < 40; i++) full.sample(snap([], [wp(1, (4 * i) / 39, 0)]), i * 67)
		const rf = full.stop(40 * 67)
		assert.equal(rf.covered, 1)
		assert.equal(rf.samples, 40)
		assert.equal(rf.ok, true)

		const half = new VerifyWalk()
		half.start({ a: A, b: B }, 0)
		for (let i = 0; i < 20; i++) half.sample(snap([], [wp(1, (4 * i) / 39, 0)]), i * 67)
		assert.equal(half.stop(20 * 67).covered, 0.5)
	})

	it('ok is false below MIN_SAMPLES; sources count the fusion source of each walker step', () => {
		const w = new VerifyWalk()
		w.start({ a: A, b: B }, 0)
		for (let i = 0; i < 5; i++) w.sample(snap([], [wp(1, 2, 0, i < 3 ? 'fused' : 'cam_2')]), i * 67)
		const r = w.stop(335)
		assert.equal(r.ok, false)
		assert.equal(r.samples, 5)
		assert.deepEqual(r.sources, { fused: 3, cam_2: 2 })

		const enough = new VerifyWalk()
		enough.start({ a: A, b: B }, 0)
		for (let i = 0; i < MIN_SAMPLES; i++) enough.sample(snap([], [wp(1, 2, 0)]), i * 67)
		assert.equal(enough.stop(MIN_SAMPLES * 67).ok, true)
	})

	it('auto-stops after MAX_S: a sample past it ends the walk and keeps the result', () => {
		const w = new VerifyWalk()
		w.start({ a: A, b: B }, 0)
		w.sample(snap([], [wp(1, 2, 0)]), MAX_S * 1000 + 1)
		const st = w.status(MAX_S * 1000 + 1)
		assert.equal(st.running, false)
		assert.notEqual(st.result, null)
		assert.equal(st.result.duration_s, MAX_S)
	})

	it('explicit person: follows that world id 2 m off the line, ignoring a closer one; reset clears the walk', () => {
		const w = new VerifyWalk()
		w.start({ a: A, b: B, person: 7 }, 0)
		for (let i = 0; i < MIN_SAMPLES; i++) w.sample(snap([], [wp(7, 2, 2), wp(3, 2, 0)]), i * 67)
		assert.equal(w.status(MIN_SAMPLES * 67).live.person, 7)
		const r = w.stop(MIN_SAMPLES * 67)
		assert.equal(r.person, 7)
		assert.equal(r.world.mean_cm, 200)

		w.start({ a: A, b: B, person: 7 }, 0)
		w.sample(snap([], [wp(7, 2, 2)]), 0)
		w.reset()
		const st = w.status(0)
		assert.equal(st.running, false)
		assert.equal(st.result, null)
	})
})
