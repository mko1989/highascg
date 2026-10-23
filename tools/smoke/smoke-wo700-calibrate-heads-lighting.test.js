'use strict'
/**
 * WO-700 — calibrate a head from Previs → Lighting → Calibrate heads on stage marks (real floor spots,
 * project.fixtures.marks): "Beam is on <mark>" sends the mark's position as the calibrate `at` point (WO-630 path,
 * smoke-wo630). The session's output_enabled is now the head's own universe — a DMX-master head moves while the
 * follow output is off, and the summary must not say it will not. Owner 23.10: "the calibrate has different controls
 * than the programer" — a `hold: false` session leaves the head to the Programmer and each point reads the pan / tilt
 * the head is being sent (axisDeg, the inverse of axisBytes). Owner 23.10: "click calibrate, which doesnt output
 * artnet but moves the digital beam to light at the marker. the position pan/tilt of the digital gets corrected each
 * calibration point is added" — from the first point the solve (prior = the pose at start) puts the previs's beam
 * (gdtf-ik.js chain, test-spot.xml) on every mark so far; nothing is sent for it.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { FollowEngine } = require('../../src/fixtures/follow-engine')
const { MarkerHub } = require('../../src/tracking/marker-hub')
const { createCalibration } = require('../../src/fixtures/calibrate-session')
const { solveFixturePose } = require('../../src/fixtures/calibrate-solve')
const { axisBytes, axisDeg } = require('../../src/fixtures/follow-ik')
const { parseDescription } = require('../../src/fixtures/gdtf-parse')
const { buildRig } = require('../../src/fixtures/gdtf-rig')
const { chainOf, beamOf, aimFixture, axisFn, toPhys, fileAxis } = require('../../src/fixtures/gdtf-ik')

const GD = (rel) => fs.readFileSync(path.join(__dirname, '../../godot/client', rel), 'utf8')

describe('WO-700 calibrate heads from Lighting', () => {
	function rig(dmxOn) {
		const t = { ms: 1000 }
		const hub = new MarkerHub({ now: () => t.ms })
		const engine = new FollowEngine({ hub, now: () => t.ms, send: () => {} })
		engine.configure({
			output: { enabled: false, protocol: 'artnet' },
			dmx: { enabled: dmxOn, universes: ['artnet:3'] },
			patch: [
				{
					id: 'fx1',
					name: 'Spot L',
					universe: 3,
					address: 1,
					dest: '10.0.0.50',
					pose: { x: 0, y: 0, z: 6, hang: 'truss' },
				},
			],
		})
		engine.tick()
		return { engine, cal: createCalibration({ engine, hub }) }
	}

	it('output_enabled follows the head universe (DMX master), not only the follow output', () => {
		const on = rig(true)
		assert.equal(on.engine.isLive(on.engine.fixtures[0]), true)
		assert.equal(on.cal.handle({ action: 'start', id: 'fx1' }).body.output_enabled, true)
		const off = rig(false)
		assert.equal(off.cal.handle({ action: 'start', id: 'fx1' }).body.output_enabled, false)
	})

	it('a stage mark is a calibrate point at its position', () => {
		const { cal } = rig(true)
		cal.handle({ action: 'start', id: 'fx1' })
		const r = cal.handle({ action: 'point', id: 'fx1', at: [1.5, 2.36, 0] })
		assert.equal(r.status, 200)
		assert.deepEqual([r.body.points[0].x, r.body.points[0].y, r.body.points[0].z], [1.5, 2.36, 0])
	})

	it('axisDeg reads back what axisBytes wrote (coarse, fine, inverted)', () => {
		for (const ax of [
			{ ch: 1, fine: 2, range: 540, invert: false },
			{ ch: 3, fine: 0, range: 270, invert: true },
		]) {
			for (const deg of [-ax.range / 2, -33.3, 0, 71.25, ax.range / 2]) {
				const tol = ax.fine ? ax.range / 65535 : ax.range / 255
				assert.ok(Math.abs(axisDeg(ax, axisBytes(ax, deg)) - deg) <= tol, `${deg}° on ${JSON.stringify(ax)}`)
			}
		}
	})

	it('a hold:false session does not park the head; points take the pan / tilt being sent', () => {
		const { engine, cal } = rig(true)
		const fx = engine.fixtures[0]
		const r = cal.handle({ action: 'start', id: 'fx1', hold: false })
		assert.equal(r.status, 200)
		assert.equal(r.body.live, true)
		assert.notEqual(engine.aimOf('fx1').state, 'calibrating')
		assert.equal(cal.handle({ action: 'jog', id: 'fx1', dpan: 5 }).status, 409)
		const buf = engine.frameOf(fx) // what the programmer put on the wire for this head
		const put = (ax, deg) =>
			axisBytes(ax, deg).forEach((b, i) => {
				buf[fx.address - 2 + (i ? ax.fine : ax.ch)] = b
			})
		put(fx.pan, 42.5)
		put(fx.tilt, -20)
		const p = cal.handle({ action: 'point', id: 'fx1', at: [1, 2, 0] })
		assert.equal(p.status, 200)
		assert.ok(Math.abs(p.body.points[0].pan - 42.5) < 0.01)
		assert.ok(Math.abs(p.body.points[0].tilt + 20) < 0.01)
	})

	it('a live point with the head output off is refused', () => {
		const { cal } = rig(false)
		cal.handle({ action: 'start', id: 'fx1', hold: false })
		assert.equal(cal.handle({ action: 'point', id: 'fx1', at: [1, 2, 0] }).status, 409)
	})

	it('every point moves the typed head so its digital beam lands on each mark — and sends nothing', async () => {
		const XML = fs.readFileSync(path.join(__dirname, '../fixtures/gdtf/test-spot.xml'), 'utf8')
		const t = await parseDescription(XML, ['description.xml'])
		const resolveMode = (id, name) => {
			const m = t.modes.find((x) => x.name === name)
			return m ? { ...m, chain: chainOf(buildRig(t, m)) } : null
		}
		let sent = 0
		const engine = new FollowEngine({
			hub: { list: () => [], now: () => 0 },
			now: () => 0,
			send: () => {
				sent++
			},
			resolveMode,
		})
		const patched = { x: 0.6, y: -0.4, z: 6.3, hang: 'truss', yaw: 25 } // where the operator thinks it hangs
		const real = { x: 1, y: 0, z: 6, hang: 'truss', yaw: 0 }
		engine.configure({
			patch: [
				{
					id: 'h',
					name: 'Spot',
					typeId: 'cccccccccccc',
					mode: 'Standard',
					protocol: 'sacn',
					universe: 3,
					address: 1,
					pose: patched,
				},
			],
		})
		const fx = engine.fixtures[0]
		assert.ok(fx.gdtf.chain, 'test-spot.xml has an axis chain')
		const buf = new Uint8Array(512) // the console's / programmer's DMX the real head gets
		const cal = createCalibration({ engine, hub: { list: () => [], now: () => 0 }, frame: () => buf })
		assert.equal(cal.handle({ action: 'start', id: 'h', hold: false }).status, 200)
		const [pf, tf] = [axisFn(fx, 'Pan'), axisFn(fx, 'Tilt')]
		const miss = (pose, p, mark) => {
			const { origin, dir } = beamOf(
				fx.gdtf.chain,
				pose,
				toPhys(pf, fileAxis(pf, fx.pan), p.pan),
				toPhys(tf, fileAxis(tf, fx.tilt), p.tilt)
			)
			const w = mark.map((v, i) => v - origin[i])
			const along = w[0] * dir[0] + w[1] * dir[1] + w[2] * dir[2]
			return Math.hypot(...w.map((v, i) => v - along * dir[i]))
		}
		const marks = [
			[0, 3, 0],
			[3, 2, 0],
			[-2, 5, 0],
			[2, 6, 0],
		]
		let r = null
		for (const [n, mark] of marks.entries()) {
			const aim = aimFixture({ ...fx, pose: real }, mark) // the operator aims the real head onto the mark
			for (const [ax, deg] of [
				[fx.pan, aim.pan],
				[fx.tilt, aim.tilt],
			]) {
				axisBytes(ax, deg).forEach((b, i) => {
					buf[fx.address - 2 + (i ? ax.fine : ax.ch)] = b
				})
			}
			r = cal.handle({ action: 'point', id: 'h', at: mark }).body
			assert.equal(r.solve.ok, true, `solved from point ${n + 1}`)
			assert.equal(r.solve.partial === true, n + 1 < 3)
			for (const [k, p] of r.points.entries()) {
				assert.ok(
					miss({ ...patched, ...r.solve.pose }, p, marks[k]) < 0.05,
					`after ${n + 1} point(s) the digital beam hits mark ${k + 1}`
				)
			}
		}
		for (const k of ['x', 'y', 'z']) assert.ok(Math.abs(r.solve.pose[k] - real[k]) < 0.05, `${k} → the real hang point`)
		assert.ok(Math.abs(r.solve.pose.yaw - real.yaw) < 1)
		assert.deepEqual(r.pose0, { x: 0.6, y: -0.4, z: 6.3, yaw: 25 })
		assert.equal(sent, 0, 'calibrating sends no DMX')
	})

	it('a mark the beam cannot reach from near the patch moves nothing (live 23.10: was teleported onto the mark)', () => {
		// the box's Focus Profile 1: floor head at z 2 beaming straight up, a floor mark 9 m away it was not aimed at
		const prior = { x: -2.5, y: -6, z: 2, yaw: 0 }
		const r = solveFixturePose([{ pan: 1.06, tilt: -0.53, x: 0, y: 3, z: 0 }], { hang: 'floor', prior })
		assert.equal(r.ok, false)
		assert.equal(r.pose, undefined)
		assert.match(r.warning, /cannot land on this mark/)
		// … while one the head really is on, from 1 m off its patch, is fitted near it
		const near = solveFixturePose([{ pan: 0, tilt: 30, x: -1.5, y: -6 + 2 * Math.tan(Math.PI / 6), z: 4 }], {
			hang: 'floor',
			prior,
		})
		assert.equal(near.ok, true)
		assert.ok(
			Math.hypot(near.pose.x - prior.x, near.pose.y - prior.y, near.pose.z - prior.z) <= 2.05,
			JSON.stringify(near.pose)
		)
	})

	it('the Lighting fold wires marks, the floor pick and the session (source pins)', () => {
		const fold = GD('features/previs/fixtures/calibrate_fold.gd')
		assert.match(fold, /_calib\.lighting = true/)
		assert.match(fold, /_calib\.add_point_button\(_on_mark\)/)
		assert.match(fold, /_calib\.add_floor_point\(\[m\.x, m\.y, m\.z\]\)/)
		assert.match(fold, /sel\.floor_picked\.connect\(_add_mark\)/)
		assert.match(fold, /s\.patch\[i\] = F\.apply_solve\(s\.patch\[i\], solve\)/)
		// owner 23.10: just below the Programmer that aims the head
		assert.match(
			GD('features/previs/fixtures/fixtures_section.gd'),
			/add_child\(Fold\.new\("Programmer", \[prog\]\)\)\n\tadd_child\(Fold\.new\("Calibrate heads", \[CalibrateFold\.new\(\)\]\)\)/
		)
		const sec = GD('features/previs/tracking/calibrate_section.gd')
		assert.match(sec, /\{"action": "start", "hold": false\} if lighting/)
		assert.match(
			sec,
			/if lighting and res\.ok and str\(body\.get\("action"\)\) in \["point", "undo"\]:\n\t\t_follow_points\(res\.data\)/
		)
		assert.match(sec, /_apply\.visible = not lighting/)
		assert.match(
			GD('../../src/tracking/register.js'),
			/createCalibration\(\{ engine: _follow\.engine, hub, frame: _follow\.liveFrame \}\)/
		)
		assert.match(GD('features/previs/fixtures/fixtures_3d.gd'), /if sel\.mark_pick: {2}# WO-700/)
		assert.match(
			GD('features/previs/previs_tab.gd'),
			/stage\.add_child\(preload\("res:\/\/features\/previs\/fixtures\/calib_marks_3d\.gd"\)\.new\(\)\)/
		)
		assert.match(GD('features/previs/tracking/follow_model.gd'), /"marks": normalize_marks\(s\.get\("marks"\)\)/)
	})
})
