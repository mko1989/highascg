'use strict'

/**
 * WO-764 — a head's real pose (x, y, z, yaw, pitch, roll) solved from its (pan, tilt) ↔ mark pairs through the GDTF
 * axis chain (src/fixtures/calibrate-pose.js solveHeadPose), with a fit report and verdict. Synthetic rigs: a known
 * TRUE pose, the angles that put its beam on each mark (inverted through the same chain), optional aiming noise, then
 * solved from the PATCH pose. The head is tools/fixtures/gdtf/test-spot.xml.
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { solveHeadPose, turnedDeg } = require('../../src/fixtures/calibrate-pose')
const { normalizeMap } = require('../../src/fixtures/beam-offset')
const { inferRig } = require('../../src/fixtures/rig-infer')
const { parseDescription } = require('../../src/fixtures/gdtf-parse')
const { buildRig } = require('../../src/fixtures/gdtf-rig')
const { chainOf, beamOf } = require('../../src/fixtures/gdtf-ik')

const XML = fs.readFileSync(path.join(__dirname, '../fixtures/gdtf/test-spot.xml'), 'utf8')
const src = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')
let chain = null
const forward = (pan, tilt, pose) => beamOf(chain, pose, pan, tilt)

/** Deterministic noise (mulberry32 + Box–Muller). */
function rng(seed) {
	let a = seed >>> 0
	const u = () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
	return () => Math.sqrt(-2 * Math.log(u() || 1e-12)) * Math.cos(2 * Math.PI * u())
}

/** The pan / tilt that put the TRUE head's beam on `mark` (Gauss–Newton on the across-beam miss, from a coarse scan). */
function aimAt(truth, mark) {
	const err = (p, t) => {
		const { origin, dir } = forward(p, t, truth)
		const w = mark.map((v, i) => v - origin[i])
		const along = w[0] * dir[0] + w[1] * dir[1] + w[2] * dir[2]
		return along <= 0 ? [1e3, 1e3, 1e3] : w.map((v, i) => v - along * dir[i])
	}
	const n2 = (e) => e[0] * e[0] + e[1] * e[1] + e[2] * e[2]
	let best = [0, 0]
	for (let p = -270; p <= 270; p += 10) for (let t = -135; t <= 135; t += 5) if (n2(err(p, t)) < n2(err(...best))) best = [p, t]
	let [p, t] = best
	for (let k = 0; k < 60; k++) {
		const e = err(p, t)
		const h = 1e-4
		const ep = err(p + h, t).map((v, i) => (v - e[i]) / h)
		const et = err(p, t + h).map((v, i) => (v - e[i]) / h)
		const a = n2(ep)
		const b = ep[0] * et[0] + ep[1] * et[1] + ep[2] * et[2]
		const c = n2(et)
		const g1 = ep[0] * e[0] + ep[1] * e[1] + ep[2] * e[2]
		const g2 = et[0] * e[0] + et[1] * e[1] + et[2] * e[2]
		const det = a * c - b * b
		if (Math.abs(det) < 1e-18) break
		p -= (c * g1 - b * g2) / det
		t -= (a * g2 - b * g1) / det
	}
	assert.ok(Math.sqrt(n2(err(p, t))) < 1e-6, `aimAt converged for ${mark}`)
	return [p, t]
}

/** The points the operator would take: true angles (+ noise °) on each mark. */
function take(truth, marks, { noise = 0, seed = 1, mirror = false } = {}) {
	const g = rng(seed)
	return marks.map((m, i) => {
		const [pan, tilt] = aimAt(truth, m)
		return { pan: (mirror ? -pan : pan) + noise * g(), tilt: tilt + noise * g(), x: m[0], y: m[1], z: m[2], name: `M${i + 1}` }
	})
}

const PATCH = { x: 0, y: 0, z: 5, yaw: 0, pitch: 0, roll: 0, hang: 'truss' }
const off = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const SPREAD5 = [[-3, -3, 0], [3, -3, 0], [3, 3, 0], [-3, 3, 0], [0.5, 0, 0]]
const SPREAD4 = SPREAD5.slice(0, 4)

describe('WO-764 head pose solve (calibrate-pose.js)', () => {
	before(async () => {
		const t = await parseDescription(XML, ['description.xml'])
		chain = chainOf(buildRig(t, t.modes[0]))
		assert.ok(chain, 'test-spot has a pan / tilt chain')
	})

	it('noise-free: a raked, turned head 0.4 m off its patch is recovered with pitch and roll (6 parameters)', () => {
		const truth = { x: 0.3, y: -0.25, z: 5.1, yaw: 6, pitch: 5, roll: -4, hang: 'truss' }
		const s = solveHeadPose(take(truth, SPREAD5), forward, { pose: PATCH })
		assert.equal(s.ok, true)
		assert.equal(s.dof, 6, s.note)
		assert.ok(off(s.pose, truth) < 0.005, `position ${off(s.pose, truth)} m`)
		assert.ok(turnedDeg(s.pose, truth) < 0.05, `rotation ${turnedDeg(s.pose, truth)}°`)
		assert.equal(s.verdict, 'good', s.note)
		assert.match(s.note, /pitch \/ roll solved/)
		assert.ok(s.moved_m > 0.35 && s.turned_deg > 8, 'the report says how far it moved')
	})

	it('a level head stays level (4 parameters, pitch / roll as patched) and 0.3° aiming noise still gives a good fit', () => {
		const truth = { x: -0.3, y: 0.2, z: 4.9, yaw: -5, pitch: 0, roll: 0, hang: 'truss' }
		const s = solveHeadPose(take(truth, SPREAD4, { noise: 0.3, seed: 7 }), forward, { pose: PATCH })
		assert.equal(s.dof, 4, s.note)
		assert.deepEqual([s.pose.pitch, s.pose.roll], [0, 0])
		assert.ok(off(s.pose, truth) < 0.15, `position ${off(s.pose, truth)} m`)
		assert.ok(Math.abs(s.pose.yaw - truth.yaw) < 1, `yaw ${s.pose.yaw}`)
		assert.equal(s.verdict, 'good', s.note)
		assert.match(s.note, /^good: fit [\d.]+°, worst \d+ cm \(M\d\) · pitch \/ roll as patched/)
		assert.ok(s.sd.aim_m < 0.1 && s.rms_deg < 1)
	})

	it('a tilted head with noise: more marks pin pitch / roll', () => {
		const truth = { x: 0.3, y: -0.2, z: 5.1, yaw: 5, pitch: 5, roll: -4, hang: 'truss' }
		const grid = []
		for (const x of [-3, 0, 3]) for (const y of [-3, 0, 3]) grid.push([x, y, 0])
		const s = solveHeadPose(take(truth, grid, { noise: 0.3, seed: 3 }), forward, { pose: PATCH })
		assert.equal(s.dof, 6, s.note)
		assert.ok(off(s.pose, truth) < 0.2, `position ${off(s.pose, truth)} m`)
		assert.ok(turnedDeg(s.pose, truth) < 2, `rotation ${turnedDeg(s.pose, truth)}°`)
		assert.equal(s.verdict, 'good', s.note)
	})

	it('3 marks fit but cannot show a head is level: weak, asks for a 4th; 2 marks: not solved', () => {
		const truth = { x: 0.2, y: 0.1, z: 5, yaw: 3, pitch: 0, roll: 0, hang: 'truss' }
		const s = solveHeadPose(take(truth, SPREAD4.slice(0, 3)), forward, { pose: PATCH })
		assert.equal(s.ok, true)
		assert.equal(s.verdict, 'weak')
		assert.match(s.note, /aim it at a 4th mark/)
		assert.deepEqual(solveHeadPose(take(truth, SPREAD4.slice(0, 2)), forward, { pose: PATCH }), { ok: false, need: 1 })
	})

	it('marks nearly in a line: weak, says so', () => {
		const truth = { x: 0.2, y: 0.1, z: 5, yaw: 3, pitch: 0, roll: 0, hang: 'truss' }
		const line = [[-3, 0, 0], [-1, 0.05, 0], [1, -0.05, 0], [3, 0, 0]]
		const s = solveHeadPose(take(truth, line), forward, { pose: PATCH })
		assert.equal(s.verdict, 'weak', s.note)
		assert.match(s.note, /^weak: marks nearly in line/)
	})

	it('a desk patch with the pan inverted is caught: bad, check Invert pan', () => {
		const truth = { x: 0.2, y: 0.1, z: 5, yaw: 20, pitch: 0, roll: 0, hang: 'truss' }
		const s = solveHeadPose(take(truth, SPREAD5, { mirror: true }), forward, { pose: PATCH })
		assert.equal(s.flip_pan, true)
		assert.equal(s.verdict, 'bad')
		assert.match(s.note, /Invert pan/)
	})

	it('a mark measured 1 m wrong: bad, names that mark', () => {
		const truth = { x: 0.2, y: 0.1, z: 5, yaw: 3, pitch: 0, roll: 0, hang: 'truss' }
		const pts = take(truth, SPREAD5)
		pts[2] = { ...pts[2], x: pts[2].x + 1 }
		const s = solveHeadPose(pts, forward, { pose: PATCH })
		assert.equal(s.verdict, 'bad', s.note)
		assert.match(s.note, /^bad: [\d.]+ m off on M\d — was the beam on that mark/)
	})

	it('a floor head (turned over) low on the deck is recovered too', () => {
		const truth = { x: 4.2, y: 1.3, z: 0.4, yaw: 95, pitch: 3, roll: 2, hang: 'floor' }
		const marks = [[-2, -3, 0], [2, -3, 0], [2, 3, 2.5], [-2, 3, 1.8], [0, 0, 3]]
		const s = solveHeadPose(take(truth, marks), forward, { pose: { x: 4, y: 1, z: 0.4, yaw: 90, hang: 'floor' } })
		assert.equal(s.pose.hang, 'floor')
		assert.ok(off(s.pose, truth) < 0.01, `position ${off(s.pose, truth)} m`)
		assert.ok(turnedDeg(s.pose, truth) < 0.1, `rotation ${turnedDeg(s.pose, truth)}°`)
	})

	it('rig inference: a raked pipe (every anchor of the row tilted alike) rakes its heads; one turned clamp does not', () => {
		const heads = [0, 1, 2, 3, 4].map((i) => ({ id: `h${i}`, pose: { x: i * 2, y: 0, z: 6, yaw: 0, pitch: 0, roll: 0, hang: 'truss' } }))
		const rows = [{ id: 'r1', heads: heads.map((h) => h.id), dir: [1, 0, 0] }]
		const at = (i, pitch, dof) => ({ ok: true, dof, rms_deg: 0.1, pose: { x: i * 2, y: 0, z: 6, yaw: 0, pitch, roll: 0, hang: 'truss' } })
		const pitchOf = (r, id) => r.heads.find((h) => h.id === id).pose.pitch
		const raked = inferRig(heads, { h0: at(0, 4, 6), h4: at(4, 4.5, 6) }, rows)
		assert.ok(Math.abs(pitchOf(raked, 'h2') - 4.25) < 0.01, 'the row rake')
		const one = inferRig(heads, { h0: at(0, 5, 6), h4: at(4, 0, 4) }, rows)
		assert.equal(pitchOf(one, 'h2'), 0, 'a single tilted anchor is its own clamp')
		const differ = inferRig(heads, { h0: at(0, 5, 6), h4: at(4, -3, 6) }, rows)
		assert.equal(pitchOf(differ, 'h2'), 0, 'tilts that disagree are not a rake')
	})

	it('pins keep the mark they were taken on (at, name) — the session solves the pose from them', () => {
		const map = normalizeMap([{ pan: 1, tilt: 2, dpan: 0, dtilt: 0, at: [1, 2, 0], name: ' DSL ' },
			{ pan: 3, tilt: 4, dpan: 0, dtilt: 0, at: [1, 'x', 0], name: 'junk' }])
		assert.deepEqual(map[0].at, [1, 2, 0])
		assert.equal(map[0].name, 'DSL')
		assert.equal('at' in map[1] || 'name' in map[1], false)
		const session = src('src/fixtures/calibrate-session.js')
		assert.match(session, /pose_fit: poseFit\(map, lm, fx\)/)
		assert.match(session, /solveHeadPose\(pts, lm\.forward, \{ pose: fx\.pose, mirrorPan: lm\.mirrorPan \}\)/)
		assert.match(src('src/fixtures/rig-calibrate.js'), /solveHeadPose\(points, lm\.forward, \{ pose: fx\.pose, mirrorPan: lm\.mirrorPan \}\)/)
	})
})
