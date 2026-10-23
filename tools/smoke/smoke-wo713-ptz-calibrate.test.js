'use strict'
/**
 * WO-713 R2 — calibrate a PTZ camera on a person standing on a mark. The hold (ptz-service.js) overrides the
 * director, lapses after its TTL and respects the ptz duty; a point pins held-vs-geometric (ptz-calibrate.js);
 * the pins bend aimAngles (ptz-model.js, beam-offset.js blend) and land exactly on the pinned angles at the pinned
 * target. Nothing leaves this process: `send` and `now` are injected.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const model = require('../../src/ptz/ptz-model')
const visca = require('../../src/ptz/visca')
const { createPtzService, HOLD_TTL_MS } = require('../../src/ptz/ptz-service')
const { createPtzCalibrate } = require('../../src/ptz/ptz-calibrate')
const { handleAuto } = require('../../src/tracking/auto-routes')

const CAM = { id: 'c1', enabled: true, host: '10.0.0.5', pose: { x: 0, y: -8, z: 2.5, yaw: 0 }, aim_z: 1.4 }
const project = (...list) => ({ previs: { tracking: { ptz: list } } })

function rig({ cam = CAM, allowed } = {}) {
	const sent = []
	const clock = { t: 1000 }
	const ptz = createPtzService({
		send: (host, port, buf) => sent.push(Buffer.from(buf)),
		now: () => clock.t,
		...(allowed ? { allowed } : {}),
	})
	ptz.configure(project(cam))
	const markers = new Map([[7, { x: 2, y: 3, z: 0 }]])
	const cal = createPtzCalibrate({ ptz, markerOf: (id) => markers.get(id) })
	const post = (data) => cal.handle(data)
	return { ptz, cal, sent, clock, post, markers }
}
const lastUnits = (sent) => {
	const b = sent.at(-1)
	const un = (i) => {
		const v = (b[i] << 12) | (b[i + 1] << 8) | (b[i + 2] << 4) | b[i + 3]
		return v > 0x7fff ? v - 0x10000 : v
	}
	return { pan: un(6), tilt: un(10) }
}

describe('WO-713 hold overrides the director', () => {
	it('sends the operator angles, never asks the director, and ends on release', () => {
		const { ptz, sent, clock } = rig()
		let asked = 0
		const targetOf = () => (asked++, { x: 0, y: 0, z: 0 })
		assert.equal(ptz.hold('c1', { pan: 10, tilt: -5 }).ok, true)
		ptz.step(clock.t, targetOf)
		assert.equal(asked, 0, "a held camera is not the director's")
		assert.deepEqual(lastUnits(sent), { pan: Math.round(10 * 14.4), tilt: Math.round(-5 * 14.4) })
		assert.equal(ptz.status()[0].state, 'calibrating')
		clock.t += 200
		ptz.step(clock.t, targetOf)
		assert.equal(sent.length, 1, 'same angles: the deadband sends nothing')
		ptz.hold('c1', { pan: 20 })
		clock.t += 200
		ptz.step(clock.t, targetOf)
		assert.equal(sent.length, 2)
		assert.equal(lastUnits(sent).pan, Math.round(20 * 14.4))
		ptz.release('c1')
		clock.t += 200
		ptz.step(clock.t, targetOf)
		assert.equal(asked, 1, 'the director has it back')
		assert.notEqual(ptz.status()[0].state, 'calibrating')
	})

	it('clamps held angles to the camera range and sends a zoom change once', () => {
		const { ptz, sent, clock } = rig({ cam: { ...CAM, pan: { min: -90, max: 90 } } })
		ptz.hold('c1', { pan: 400, tilt: 0, zoom: 4096 })
		ptz.step(clock.t)
		assert.equal(lastUnits(sent.slice(0, 2).slice(-1)).pan, Math.round(90 * 14.4))
		assert.equal(sent.length, 2, 'zoom + pan-tilt')
		assert.equal(sent[0].toString('hex'), Buffer.from(visca.zoomDirect(1, 4096)).toString('hex'))
		clock.t += 200
		ptz.step(clock.t)
		assert.equal(sent.length, 2, 'no repeat')
	})

	it('the TTL releases the hold; any hold() refreshes it', () => {
		const { ptz, clock, sent } = rig()
		ptz.hold('c1', { pan: 1, tilt: 1 })
		clock.t += HOLD_TTL_MS - 1
		assert.ok(ptz.holdOf('c1'))
		ptz.hold('c1', {})
		clock.t += HOLD_TTL_MS - 1
		assert.ok(ptz.holdOf('c1'), 'refreshed')
		clock.t += 2
		assert.equal(ptz.holdOf('c1'), null, 'lapsed')
		let asked = 0
		ptz.step(clock.t, () => (asked++, null))
		assert.equal(asked, 1)
		assert.equal(sent.length, 0)
	})

	it('the ptz duty gate sends nothing while held', () => {
		let on = false
		const { ptz, sent, clock } = rig({ allowed: () => on })
		ptz.hold('c1', { pan: 3, tilt: 3 })
		ptz.step(clock.t)
		assert.equal(sent.length, 0)
		assert.equal(ptz.status()[0].blocked_by_server, true)
		on = true
		ptz.step(clock.t)
		assert.equal(sent.length, 1)
	})

	it('refuses unknown, disabled and host-less cameras', () => {
		const { ptz } = rig()
		assert.equal(ptz.hold('nope', {}).status, 404)
		ptz.configure(project({ ...CAM, enabled: false }))
		assert.equal(ptz.hold('c1', {}).status, 409)
		ptz.configure(project({ ...CAM, host: '' }))
		assert.equal(ptz.hold('c1', {}).status, 409)
	})
})

describe('WO-713 point pins held minus geometric', () => {
	it('pins the geometric angles with the difference to the held ones', () => {
		const { post, markers } = rig()
		assert.equal(post({ action: 'start', id: 'c1' }).status, 200)
		const cam = model.normalizeCamera(CAM)
		const g = model.geomAngles(cam, markers.get(7))
		post({ action: 'jog', id: 'c1', pan: g.pan + 1.5, tilt: g.tilt - 0.8 })
		const r = post({ action: 'point', id: 'c1', marker: 7 })
		assert.equal(r.status, 200)
		assert.equal(r.body.pins.length, 1)
		const p = r.body.pins[0]
		assert.ok(Math.abs(p.pan - g.pan) < 1e-9 && Math.abs(p.tilt - g.tilt) < 1e-9)
		assert.ok(Math.abs(p.dpan - 1.5) < 1e-9 && Math.abs(p.dtilt + 0.8) < 1e-9)
		assert.equal(r.body.points[0].marker, 7)
		assert.deepEqual(r.body.points[0].at, [2, 3, 0])
	})

	it('the target is the mark plus aim_z, and at:[x,y,z] works without a hub marker', () => {
		const { post } = rig({ cam: { ...CAM, aim_z: 1.7 } })
		post({ action: 'start', id: 'c1' })
		post({ action: 'jog', id: 'c1', pan: 0, tilt: 0 })
		const r = post({ action: 'point', id: 'c1', at: [0, 0, 0] })
		const want = Math.atan2(1.7 - 2.5, 8) * (180 / Math.PI)
		assert.ok(Math.abs(r.body.pins[0].tilt - want) < 1e-9)
		assert.ok(Math.abs(r.body.pins[0].dtilt + want) < 1e-9)
	})

	it("relative jogs add up; undo and clear; the same mark again replaces its pin; the camera's own pins start the list", () => {
		const old = { pan: 40, tilt: -3, dpan: 1, dtilt: 1 }
		const { post } = rig({ cam: { ...CAM, offset_map: [old] } })
		let r = post({ action: 'start', id: 'c1' })
		assert.deepEqual(r.body.pins, [old])
		assert.equal(r.body.added, 0)
		post({ action: 'jog', id: 'c1', pan: 5, tilt: -3 })
		r = post({ action: 'jog', id: 'c1', dpan: 0.5, dtilt: 0.25 })
		assert.equal(r.body.pan, 5.5)
		assert.equal(r.body.tilt, -2.75)
		post({ action: 'point', id: 'c1', at: [1, 0, 0] })
		r = post({ action: 'point', id: 'c1', at: [1, 0, 0] })
		assert.equal(r.body.pins.length, 2, 'same spot: one pin')
		assert.equal(r.body.added, 2)
		r = post({ action: 'undo', id: 'c1' })
		assert.equal(r.body.added, 1)
		r = post({ action: 'clear', id: 'c1' })
		assert.deepEqual(r.body.pins, [])
		r = post({ action: 'end', id: 'c1' })
		assert.deepEqual(r.body, { id: 'c1', ended: true })
	})

	it('a lapsed hold ends the session', () => {
		const { post, clock } = rig()
		post({ action: 'start', id: 'c1' })
		clock.t += HOLD_TTL_MS + 1
		const r = post({ action: 'jog', id: 'c1', dpan: 1 })
		assert.equal(r.status, 409)
	})
})

describe('WO-713 offset_map in the aim', () => {
	const cam = (map) => model.normalizeCamera({ ...CAM, offset_map: map })

	it('lands exactly on the pinned angles at the pinned target', () => {
		const base = cam([])
		const t = { x: 3, y: 2, z: 0 }
		const g = model.geomAngles(base, t)
		const c = cam([
			{ pan: g.pan, tilt: g.tilt, dpan: 2.25, dtilt: -1.5 },
			{ pan: -30, tilt: -10, dpan: -4, dtilt: 3 },
		])
		const a = model.aimAngles(c, t)
		assert.equal(a.pan, g.pan + 2.25)
		assert.equal(a.tilt, g.tilt - 1.5)
		const none = model.aimAngles(base, t)
		assert.equal(none.pan, g.pan, 'no pins: unchanged geometry')
	})

	it('blends between pins and still clamps', () => {
		const c = cam([
			{ pan: -10, tilt: -10, dpan: 0, dtilt: 0 },
			{ pan: 10, tilt: -10, dpan: 4, dtilt: 0 },
		])
		const a = model.aimAngles(c, { x: 0, y: 0, z: 0 }) // midway in pan: half the offset
		const g = model.geomAngles(cam([]), { x: 0, y: 0, z: 0 })
		assert.ok(a.pan > g.pan && a.pan < g.pan + 4)
		const wide = model.normalizeCamera({
			...CAM,
			pan: { min: -5, max: 5 },
			offset_map: [{ pan: 0, tilt: -9, dpan: 20, dtilt: 0 }],
		})
		assert.equal(model.aimAngles(wide, { x: 0, y: 0, z: 0 }).pan, 5)
		assert.equal(model.aimAngles(wide, { x: 0, y: 0, z: 0 }).clamped, true)
	})

	it('the service sends the corrected angles to the camera', () => {
		const t = { x: 3, y: 2, z: 0 }
		const g = model.geomAngles(cam([]), t)
		const { ptz, sent, clock } = rig({ cam: { ...CAM, offset_map: [{ pan: g.pan, tilt: g.tilt, dpan: 2, dtilt: 1 }] } })
		ptz.step(clock.t, () => t)
		assert.equal(lastUnits(sent).pan, Math.round((g.pan + 2) * 14.4))
		assert.equal(lastUnits(sent).tilt, Math.round((g.tilt + 1) * 14.4))
	})

	it('normalize drops bad pins, clamps wild ones, keeps the newest 32', () => {
		const good = { pan: 1, tilt: 2, dpan: 3, dtilt: 4 }
		const c = cam([
			good,
			{ pan: 1, tilt: 2, dpan: 3 },
			{ pan: null, tilt: 2, dpan: 3, dtilt: 4 },
			{ pan: true, tilt: 2, dpan: 3, dtilt: 4 },
			{ pan: 'x', tilt: 2, dpan: 3, dtilt: 4 },
			{ pan: 1e9, tilt: -1e9, dpan: 999, dtilt: -999 },
			'junk',
			null,
		])
		assert.equal(c.offset_map.length, 2)
		assert.deepEqual(c.offset_map[0], good)
		assert.deepEqual(c.offset_map[1], { pan: 720, tilt: -360, dpan: 180, dtilt: -180 })
		const many = model.normalizeCamera({
			offset_map: Array.from({ length: 50 }, (_, i) => ({ pan: i, tilt: 0, dpan: 0, dtilt: 0 })),
		})
		assert.equal(many.offset_map.length, model.MAX_PINS)
		assert.equal(many.offset_map.at(-1).pan, 49)
		assert.deepEqual(model.normalizeCamera({ offset_map: 'nope' }).offset_map, [])
	})
})

describe('WO-713 routes', () => {
	function director() {
		const r = rig()
		return { r, dir: { ptzService: r.ptz, markerOf: (id) => r.markers.get(id), snapshot: () => ({}) } }
	}
	const call = (dir, method, data) =>
		handleAuto(dir, {
			method,
			path: '/api/tracking/ptz/calibrate',
			body: data === undefined ? undefined : JSON.stringify(data),
		})
	const json = (res) => JSON.parse(res.body)

	it('answers 400 for bad input', () => {
		const { dir } = director()
		assert.equal(call(dir, 'POST', { action: 'dance', id: 'c1' }).status, 400)
		assert.equal(call(dir, 'POST', { action: 'start' }).status, 400)
		assert.equal(handleAuto(dir, { method: 'POST', path: '/api/tracking/ptz/calibrate', body: '{nope' }).status, 400)
		assert.equal(handleAuto(dir, { method: 'POST', path: '/api/tracking/ptz/calibrate', body: '[]' }).status, 400)
		call(dir, 'POST', { action: 'start', id: 'c1' })
		assert.equal(call(dir, 'POST', { action: 'jog', id: 'c1', dpan: 'x' }).status, 400)
		assert.equal(call(dir, 'POST', { action: 'jog', id: 'c1', zoom: 70000 }).status, 400)
		assert.equal(call(dir, 'POST', { action: 'jog', id: 'c1', pan: '5' }).status, 400, 'a string is not an angle')
		assert.equal(call(dir, 'POST', { action: 'point', id: 'c1', at: [1, 2] }).status, 400)
		assert.equal(call(dir, 'POST', { action: 'point', id: 'c1', at: [1, 2, 9999] }).status, 400)
		call(dir, 'POST', { action: 'jog', id: 'c1', pan: 0, tilt: 0 })
		assert.equal(call(dir, 'POST', { action: 'point', id: 'c1' }).status, 400)
	})

	it('answers 404 for an unknown camera or marker', () => {
		const { dir } = director()
		assert.equal(call(dir, 'POST', { action: 'start', id: 'ghost' }).status, 404)
		call(dir, 'POST', { action: 'start', id: 'c1' })
		call(dir, 'POST', { action: 'jog', id: 'c1', pan: 0, tilt: 0 })
		assert.equal(call(dir, 'POST', { action: 'point', id: 'c1', marker: 99 }).status, 404)
	})

	it('answers 409 when not started, not enabled, or not yet positioned', () => {
		const { dir, r } = director()
		assert.equal(call(dir, 'POST', { action: 'jog', id: 'c1', dpan: 1 }).status, 409)
		assert.equal(call(dir, 'POST', { action: 'point', id: 'c1', marker: 7 }).status, 409)
		call(dir, 'POST', { action: 'start', id: 'c1' })
		assert.equal(call(dir, 'POST', { action: 'point', id: 'c1', marker: 7 }).status, 409, 'jog onto the person first')
		r.ptz.configure(project({ ...CAM, enabled: false }))
		assert.equal(call(dir, 'POST', { action: 'start', id: 'c1' }).status, 409)
	})

	it('GET lists open sessions; no PTZ service is 503; other paths are not ours', () => {
		const { dir } = director()
		assert.deepEqual(json(call(dir, 'GET')).sessions, [])
		call(dir, 'POST', { action: 'start', id: 'c1' })
		assert.equal(json(call(dir, 'GET')).sessions[0].id, 'c1')
		assert.equal(call({ ptzService: null }, 'GET').status, 503)
		assert.equal(call({ ptzService: null }, 'POST', { action: 'start', id: 'c1' }).status, 503)
		assert.equal(handleAuto(dir, { method: 'GET', path: '/api/tracking/ptz/other' }), null)
	})
})
