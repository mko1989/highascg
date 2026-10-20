'use strict'

/**
 * WO-630 F1 — calibrate a follow head by clicking the beam spot (owner 20.10: "i cant seem to simply put the markers
 * with mouse to calibrate a moving head light"). `point` takes the clicked floor spot (`at`, PSN metres) instead of a
 * marker the operator first had to drag there; the solve is the same.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { aim } = require('../../src/fixtures/follow-ik')
const { FollowEngine } = require('../../src/fixtures/follow-engine')
const { createCalibration } = require('../../src/fixtures/calibrate-session')
const { MarkerHub } = require('../../src/tracking/marker-hub')

const SPOTS = [
	[0, 0, 0],
	[4, 1, 0],
	[-3, 3, 0],
	[2, 6, 0],
	[5, 4, 0],
]

function rig() {
	const t = { ms: 1000 }
	const hub = new MarkerHub({ now: () => t.ms })
	const engine = new FollowEngine({ hub, now: () => t.ms, send: () => {} })
	engine.configure({
		output: { enabled: true },
		patch: [
			{
				id: 'fx1',
				name: 'Spot L',
				follow: 1,
				address: 1,
				dest: '10.0.0.50',
				pose: { x: 0, y: 0, z: 6, hang: 'truss', yaw: 0 },
			},
		],
	})
	return { engine, cal: createCalibration({ engine, hub }) }
}

describe('WO-630 F1 calibration points from a clicked floor spot', () => {
	it('five clicked spots recover the real pose — no marker involved', () => {
		const r = rig()
		r.cal.handle({ action: 'start', id: 'fx1' })
		const fx = { pose: { x: 3, y: 5, z: 7, yaw: 30, hang: 'truss' }, pan: { range: 540 }, tilt: { range: 270 } }
		let res
		for (const spot of SPOTS) {
			const a = aim(fx, spot)
			r.cal.handle({ action: 'jog', id: 'fx1', pan: a.pan, tilt: a.tilt })
			res = r.cal.handle({ action: 'point', id: 'fx1', at: spot })
			assert.equal(res.status, 200, JSON.stringify(res.body))
		}
		assert.equal(res.body.points.length, 5)
		assert.deepEqual([res.body.points[1].x, res.body.points[1].y, res.body.points[1].z], [4, 1, 0])
		assert.equal(res.body.solve.ok, true)
		assert.ok(
			Math.abs(res.body.solve.pose.x - 3) < 0.05 && Math.abs(res.body.solve.pose.z - 7) < 0.05,
			JSON.stringify(res.body.solve.pose)
		)
	})

	it('refuses a malformed or far-away spot; a marker point still works', () => {
		const r = rig()
		r.cal.handle({ action: 'start', id: 'fx1' })
		assert.equal(r.cal.handle({ action: 'point', id: 'fx1', at: [1, 2] }).status, 400)
		assert.equal(r.cal.handle({ action: 'point', id: 'fx1', at: [1, 'x', 0] }).status, 400)
		assert.equal(r.cal.handle({ action: 'point', id: 'fx1', at: [1, 2, 900] }).status, 400)
		assert.equal(r.cal.handle({ action: 'point', id: 'fx1', marker: 7 }).status, 404)
	})
})
