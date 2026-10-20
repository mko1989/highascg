'use strict'

/**
 * WO-624 E3 / WO-616 T13 — calibrate the follow moving heads (owner 20.10: "dont see an option to calibrate lights").
 * The operator parks a head (follow-engine hold), jogs it onto floor spots and drops a marker on each; the server
 * solves the head's position + yaw from the (pan, tilt) ↔ point pairs (calibrate-solve.js) and says when Invert pan
 * is wrong. The client applies the pose to project.fixtures (client-owned).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { solveFixturePose } = require('../../src/fixtures/calibrate-solve')
const { aim } = require('../../src/fixtures/follow-ik')
const { FollowEngine, HOLD_TTL_MS } = require('../../src/fixtures/follow-engine')
const { createCalibration } = require('../../src/fixtures/calibrate-session')
const { MarkerHub } = require('../../src/tracking/marker-hub')

const ROOT = path.join(__dirname, '../..')
const SPOTS = [[0, 0, 0], [4, 1, 0], [-3, 3, 0], [2, 6, 0], [5, 4, 0]]
/** Deterministic ±0.2° "operator jog" error. */
const JITTER = [[0.2, -0.1], [-0.15, 0.2], [0.1, 0.05], [-0.2, -0.2], [0.05, 0.15]]

function pairs(pose, { flipPan = false, spots = SPOTS } = {}) {
	const fx = { pose, pan: { range: 540 }, tilt: { range: 270 } }
	return spots.map((t, i) => {
		const a = aim(fx, t)
		const [jp, jt] = JITTER[i % JITTER.length]
		return { pan: (flipPan ? -a.pan : a.pan) + jp, tilt: a.tilt + jt, x: t[0], y: t[1], z: t[2] }
	})
}

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`)
const yawDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180)

describe('WO-624 E3 solveFixturePose', () => {
	it('recovers a hung head\'s position and yaw from 5 jogged spots (±0.2° operator error)', () => {
		const truth = { x: 3, y: 5, z: 7, yaw: 30, hang: 'truss' }
		const r = solveFixturePose(pairs(truth), { hang: 'truss' })
		assert.equal(r.ok, true)
		near(r.pose.x, 3, 0.1, 'x')
		near(r.pose.y, 5, 0.1, 'y')
		near(r.pose.z, 7, 0.1, 'z')
		assert.ok(yawDiff(r.pose.yaw, 30) < 1, `yaw ${r.pose.yaw}`)
		assert.equal(r.flip_pan, false)
		assert.ok(r.rms_deg < 0.5, `rms ${r.rms_deg}`)
		assert.equal(r.warning, null)
	})

	it('a floor head', () => {
		const truth = { x: -2, y: 8, z: 0.5, yaw: -120, hang: 'floor' }
		const r = solveFixturePose(pairs(truth), { hang: 'floor' })
		assert.equal(r.ok, true)
		near(r.pose.x, -2, 0.15, 'x')
		near(r.pose.y, 8, 0.15, 'y')
		near(r.pose.z, 0.5, 0.15, 'z')
		assert.ok(yawDiff(r.pose.yaw, -120) < 1.5, `yaw ${r.pose.yaw}`)
	})

	it('three spots are enough (looser: no redundancy against the jog error)', () => {
		const truth = { x: 3, y: 5, z: 7, yaw: 30, hang: 'truss' }
		const r = solveFixturePose(pairs(truth, { spots: SPOTS.slice(0, 3) }), { hang: 'truss' })
		assert.equal(r.ok, true)
		near(r.pose.x, 3, 0.3, 'x')
		near(r.pose.y, 5, 0.3, 'y')
		near(r.pose.z, 7, 0.3, 'z')
	})

	it('a head whose pan runs the other way is solved mirrored and says "flip Invert pan"', () => {
		const truth = { x: 1, y: 2, z: 6, yaw: 170, hang: 'truss' }
		const r = solveFixturePose(pairs(truth, { flipPan: true }), { hang: 'truss' })
		assert.equal(r.flip_pan, true)
		near(r.pose.x, 1, 0.1, 'x')
		near(r.pose.z, 6, 0.1, 'z')
		assert.ok(r.rms_deg < 0.5, `rms ${r.rms_deg}`)
	})

	it('fewer than 3 pairs → how many more; spots on one line → warning', () => {
		assert.deepEqual(solveFixturePose(pairs({ x: 0, y: 0, z: 6, yaw: 0, hang: 'truss' }).slice(0, 1)), { ok: false, need: 2 })
		const line = [[0, 0, 0], [2, 2, 0], [4, 4, 0], [6, 6, 0]]
		const r = solveFixturePose(pairs({ x: 3, y: -4, z: 6, yaw: 0, hang: 'truss' }, { spots: line }), { hang: 'truss' })
		assert.match(r.warning, /one line/)
	})
})

describe('WO-624 E3 calibration session over the real follow engine', () => {
	function rig() {
		const t = { ms: 1000 }
		const hub = new MarkerHub({ now: () => t.ms })
		const sent = []
		const engine = new FollowEngine({ hub, now: () => t.ms, send: (to, pkt) => sent.push(pkt) })
		// the patch is wrong on purpose: the head really hangs at (3, 5, 7) facing yaw 30
		engine.configure({ output: { enabled: true, protocol: 'artnet' }, patch: [{ id: 'fx1', name: 'Spot L', follow: 1, address: 1,
			dest: '10.0.0.50', pose: { x: 0, y: 0, z: 6, hang: 'truss', yaw: 0 } }] })
		hub.set({ id: 1, x: 1, y: 1, z: 0 })
		return { t, hub, engine, sent, cal: createCalibration({ engine, hub }) }
	}

	it('start parks the head, jog moves it, points + solve recover the real pose, end hands it back to its marker', () => {
		const r = rig()
		r.engine.tick()
		assert.equal(r.engine.aimOf('fx1').state, 'following')
		let res = r.cal.handle({ action: 'start', id: 'fx1' })
		assert.equal(res.status, 200)
		r.engine.tick()
		assert.equal(r.engine.aimOf('fx1').state, 'calibrating')
		const truth = { x: 3, y: 5, z: 7, yaw: 30, hang: 'truss' }
		for (const p of pairs(truth)) {
			res = r.cal.handle({ action: 'jog', id: 'fx1', pan: p.pan, tilt: p.tilt })
			assert.equal(res.status, 200)
			r.hub.set({ id: 2, x: p.x, y: p.y, z: p.z }) // the operator drops marker 2 on the spot
			r.t.ms += 1500 // a stale marker still counts: it stands where it was dropped
			r.engine.tick()
			assert.deepEqual([r.engine.aimOf('fx1').pan, r.engine.aimOf('fx1').tilt], [p.pan, p.tilt])
			res = r.cal.handle({ action: 'point', id: 'fx1', marker: 2 })
			assert.equal(res.status, 200, JSON.stringify(res.body))
		}
		assert.equal(res.body.points.length, 5)
		near(res.body.solve.pose.x, 3, 0.1, 'x')
		near(res.body.solve.pose.z, 7, 0.1, 'z')
		// the operator applies a pose with Invert pan flipped: the pairs taken before are re-read mirrored
		const flipped = JSON.parse(JSON.stringify(r.engine.fixtures[0]))
		r.engine.configure({ output: { enabled: true, protocol: 'artnet' }, patch: [{ ...flipped, pan: { ...flipped.pan, invert: true } }] })
		const before = res.body.points.map((p) => p.pan)
		res = r.cal.handle({ action: 'undo', id: 'fx1' })
		assert.deepEqual(res.body.points.map((p) => p.pan), before.slice(0, 4).map((p) => -p))
		assert.equal(res.body.solve.flip_pan, true, 'mirrored pairs now ask to flip back')
		r.engine.configure({ output: { enabled: true, protocol: 'artnet' }, patch: [flipped] })
		r.cal.handle({ action: 'jog', id: 'fx1', pan: pairs(truth).at(-1).pan })
		r.cal.handle({ action: 'point', id: 'fx1', marker: 2 })
		res = r.cal.handle({ action: 'jog', id: 'fx1', dpan: 10 })
		near(res.body.pan, pairs(truth).at(-1).pan + 10, 1e-9, 'relative jog')
		res = r.cal.handle({ action: 'undo', id: 'fx1' })
		assert.equal(res.body.points.length, 4)
		assert.equal(r.cal.list().length, 1)
		r.cal.handle({ action: 'end', id: 'fx1' })
		r.hub.set({ id: 1, x: 1, y: 1, z: 0 })
		r.engine.tick()
		assert.equal(r.engine.aimOf('fx1').state, 'following')
		assert.equal(r.cal.list().length, 0)
	})

	it('refuses an unknown fixture / marker, a step before start; a forgotten hold expires', () => {
		const r = rig()
		assert.equal(r.cal.handle({ action: 'start', id: 'nope' }).status, 404)
		assert.equal(r.cal.handle({ action: 'jog', id: 'fx1', pan: 3 }).status, 409)
		r.cal.handle({ action: 'start', id: 'fx1' })
		assert.equal(r.cal.handle({ action: 'point', id: 'fx1', marker: 9 }).status, 404)
		assert.equal(r.cal.handle({ action: 'jog', id: 'fx1', pan: 'x' }).status, 400)
		assert.equal(r.cal.handle({ action: 'jog', id: 'fx1', pan: 9999 }).body.pan, 270, 'clamped to the pan range')
		r.t.ms += HOLD_TTL_MS + 1
		r.hub.set({ id: 1, x: 1, y: 1, z: 0 })
		r.engine.tick()
		assert.equal(r.engine.aimOf('fx1').state, 'following')
	})
})

describe('WO-624 E3 route', () => {
	it('/api/tracking/follow/calibrate is served by the tracking module', () => {
		const src = fs.readFileSync(path.join(ROOT, 'src/tracking/register.js'), 'utf8')
		assert.match(src, /path === '\/api\/tracking\/follow\/calibrate'/)
		assert.match(src, /_calib = createCalibration\(\{ engine: _follow\.engine, hub \}\)/)
	})
})
