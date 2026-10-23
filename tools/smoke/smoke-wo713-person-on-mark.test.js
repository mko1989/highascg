'use strict'
/**
 * WO-713 — calibrate on a person standing on a mark (owner 23.10: "there should be additional calibration method for
 * a person standing on mark # where i can position camera or a head to person standing on the mark making the
 * calibration more precise per each device").
 * R1 heads: `point` takes `height` (metres above the mark, or 'aim' = the head's own aim_z — the height it follows
 * at): the pair is the raised point, so the R7 pin lands where following aims (follow-engine: marker + aim_z), not on
 * the floor. The Lighting fold's "Person on the mark" tick sends 'aim'.
 * R3 tracking cameras: "Person is on <mark>" adds {world: mark, screen: feet pixel} (person_mark_model.gd).
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { FollowEngine } = require('../../src/fixtures/follow-engine')
const { MarkerHub } = require('../../src/tracking/marker-hub')
const { createCalibration } = require('../../src/fixtures/calibrate-session')
const { parseDescription } = require('../../src/fixtures/gdtf-parse')
const { buildRig } = require('../../src/fixtures/gdtf-rig')
const { chainOf } = require('../../src/fixtures/gdtf-ik')
const { writeGdtf } = require('../../src/fixtures/gdtf-patch')
const { aimValues } = require('../../src/fixtures/gdtf-features')
const { offsetAt } = require('../../src/fixtures/beam-offset')

const GD = (rel) => fs.readFileSync(path.join(__dirname, '../../godot/client', rel), 'utf8')
const XML = fs.readFileSync(path.join(__dirname, '../fixtures/gdtf/test-spot.xml'), 'utf8')

const POSE = { x: 1, y: 0, z: 6, hang: 'truss', yaw: 0 }
const REAL_OFFSET = { pan: 20, tilt: -6 }
const MARK = [0, 3, 0]

/** A test-spot.xml head (aim_z 1.4 m) in a live (hold: false) session, and the bytes its real head gets. */
async function typed(extra = {}) {
	const t = await parseDescription(XML, ['description.xml'])
	const resolveMode = (id, name) => {
		const m = t.modes.find((x) => x.name === name)
		return m ? { ...m, chain: chainOf(buildRig(t, m)) } : null
	}
	const engine = new FollowEngine({ hub: { list: () => [], now: () => 0 }, now: () => 0, send: () => {}, resolveMode })
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
				pose: POSE,
				aim_z: 1.4,
				...extra,
			},
		],
	})
	const fx = engine.fixtures[0]
	const buf = new Uint8Array(512)
	const cal = createCalibration({ engine, hub: { list: () => [], now: () => 0 }, frame: () => buf })
	assert.equal(cal.handle({ action: 'start', id: 'h', hold: false }).status, 200)
	return { fx, buf, cal }
}

describe('WO-713 R1 — a person on the mark pins the head at their height', () => {
	it('a numeric height raises the point above the mark and is kept on it', async () => {
		const { fx, buf, cal } = await typed()
		writeGdtf(buf, fx, aimValues({ ...fx, offset: REAL_OFFSET }, [0, 3, 1.2]))
		const r = cal.handle({ action: 'point', id: 'h', at: MARK, height: 1.2 })
		assert.equal(r.status, 200)
		const p = r.body.points[0]
		assert.deepEqual([p.x, p.y, p.z, p.height], [0, 3, 1.2, 1.2])
		// '1.5' from a form field is a number too
		assert.equal(cal.handle({ action: 'point', id: 'h', at: MARK, height: '1.5' }).body.points[1].z, 1.5)
		// no height: the floor, as before (no height key)
		const f = cal.handle({ action: 'point', id: 'h', at: MARK }).body.points[2]
		assert.equal(f.z, 0)
		assert.equal('height' in f, false)
	})

	it("'aim' (and true) take the head's own aim_z", async () => {
		const { fx, buf, cal } = await typed()
		assert.equal(fx.aim_z, 1.4)
		writeGdtf(buf, fx, aimValues({ ...fx, offset: REAL_OFFSET }, [0, 3, 1.4]))
		const a = cal.handle({ action: 'point', id: 'h', at: [0, 3, 0.25], height: 'aim' }).body.points[0]
		assert.equal(a.height, 1.4)
		assert.ok(Math.abs(a.z - 1.65) < 1e-9, 'mark z + aim_z')
		assert.equal(cal.handle({ action: 'point', id: 'h', at: MARK, height: true }).body.points[1].height, 1.4)
	})

	it('the live pin solves at the raised point: exact there, and not the floor pin', async () => {
		const { fx, buf, cal } = await typed()
		const person = [MARK[0], MARK[1], MARK[2] + fx.aim_z]
		// the operator aims the real head at the person's chest (where following aims)
		writeGdtf(buf, fx, aimValues({ ...fx, offset: REAL_OFFSET }, person))
		const raised = cal.handle({ action: 'point', id: 'h', at: MARK, height: 'aim' }).body
		assert.equal(raised.solve.ok, true)
		const pin = raised.solve.map[0]
		assert.ok(
			Math.abs(pin.dpan - REAL_OFFSET.pan) < 0.1 && Math.abs(pin.dtilt - REAL_OFFSET.tilt) < 0.1,
			JSON.stringify(pin)
		)
		// Point at (aimValues with the pin) drives the real head onto the person
		const v = aimValues({ ...fx, offset_map: raised.solve.map }, person)
		const real = aimValues({ ...fx, offset: REAL_OFFSET }, person)
		assert.ok(Math.abs(v.Pan - real.Pan) < 0.05 && Math.abs(v.Tilt - real.Tilt) < 0.05, 'aim on the person')
		// the same head angles paired with the floor mark solve a different correction
		const two = await typed()
		writeGdtf(two.buf, two.fx, aimValues({ ...two.fx, offset: REAL_OFFSET }, person))
		const fp = two.cal.handle({ action: 'point', id: 'h', at: MARK }).body.solve.map[0]
		assert.ok(Math.abs(fp.pan - pin.pan) < 1e-6 && Math.abs(fp.tilt - pin.tilt) < 1e-6, 'same head angles')
		assert.ok(
			Math.hypot(fp.dpan - pin.dpan, fp.dtilt - pin.dtilt) > 1,
			`floor pin ${JSON.stringify(fp)} vs ${JSON.stringify(pin)}`
		)
		// floor and person pins share the head's one offset_map
		const e = offsetAt({ ...fx, offset_map: raised.solve.map }, pin.pan, pin.tilt)
		assert.ok(Math.abs(e.pan - pin.dpan) < 1e-6 && Math.abs(e.tilt - pin.dtilt) < 1e-6)
	})

	it('the hold (camera) session takes the raised point too', () => {
		const t = { ms: 1000 }
		const hub = new MarkerHub({ now: () => t.ms })
		const engine = new FollowEngine({ hub, now: () => t.ms, send: () => {} })
		engine.configure({
			output: { enabled: false, protocol: 'artnet' },
			patch: [{ id: 'fx1', name: 'Spot L', universe: 3, address: 1, pose: { x: 0, y: 0, z: 6, hang: 'truss' } }],
		})
		engine.tick()
		const cal = createCalibration({ engine, hub })
		cal.handle({ action: 'start', id: 'fx1' })
		const p = cal.handle({ action: 'point', id: 'fx1', at: [1, 2, 0], height: 'aim' }).body.points[0]
		assert.deepEqual([p.z, p.height], [1, 1], 'default aim_z 1 m')
	})

	it('a bad height is refused (400) and adds no point', async () => {
		const { cal } = await typed()
		for (const height of [-0.1, 3.5, 'chest', NaN, [1], { m: 1 }]) {
			const r = cal.handle({ action: 'point', id: 'h', at: MARK, height })
			assert.equal(r.status, 400, JSON.stringify(height))
			assert.match(r.body.error, /height must be metres above the mark/)
		}
		assert.equal(cal.handle({ action: 'undo', id: 'h' }).body.points.length, 0)
	})

	it('the Lighting fold: Person on the mark sends aim; floor marks unchanged (source pins)', () => {
		const fold = GD('features/previs/fixtures/calibrate_fold.gd')
		assert.match(fold, /_person\.text = "Person on the mark"/)
		assert.match(fold, /_calib\.add_floor_point\(\[m\.x, m\.y, m\.z\], "aim"\)/)
		assert.match(fold, /_calib\.add_floor_point\(\[m\.x, m\.y, m\.z\]\)/)
		assert.match(fold, /"Beam is on the person at %s"/)
		assert.match(fold, /PM\.near_line\(/)
		assert.match(
			GD('features/previs/tracking/calibrate_section.gd'),
			/if height != null:\n\t\t\tbody\["height"\] = height/
		)
	})

	it('R3: Person is on <mark> adds the feet ↔ mark point and solves (source pins)', () => {
		const page = GD('features/previs/tracking/tracking_page.gd')
		assert.match(page, /_body\.add_child\(PersonMarkRow\.new\(self\)\)/)
		const row = GD('features/previs/tracking/person_mark_row.gd')
		assert.match(row, /PM\.person_point\(/)
		assert.match(row, /page\.solve\(\)/)
		const model = GD('features/previs/tracking/person_mark_model.gd')
		// the feet pixel is the box's bottom centre in the calibration raster — the cast detect-model.js boxPoint makes
		assert.match(
			model,
			/Vector2\(\(float\(b\[0\]\) \+ float\(b\[2\]\)\) \/ 2\.0 \* raster\.x, float\(b\[3\]\) \* raster\.y\)/
		)
		assert.match(
			fs.readFileSync(path.join(__dirname, '../../src/tracking/detect-model.js'), 'utf8'),
			/\(\(Number\(box\[0\]\) \+ Number\(box\[2\]\)\) \/ 2\) \* w, Number\(top \? box\[1\] : box\[3\]\) \* h/
		)
	})
})
