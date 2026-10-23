'use strict'
/**
 * WO-700 — calibrate a head from Previs → Lighting → Calibrate heads on stage marks (real floor spots,
 * project.fixtures.marks): "Beam is on <mark>" sends the mark's position as the calibrate `at` point (WO-630 path,
 * smoke-wo630). The session's output_enabled is the head's own universe (a DMX-master head moves while the follow
 * output is off).
 * R2 (owner 23.10: "the calibrate has different controls than the programer"): a `hold: false` session leaves the
 * head to the Programmer / console, sends nothing, and each point reads the angles the head is getting.
 * R3 (owner 23.10: "beam is on mark makes the fixture it self change position rather then changing where the beam
 * points"): the solve is the head's pan / tilt offset, never its pose — from one mark the previs's beam (gdtf-ik.js
 * chain, test-spot.xml) lands where the real one does; decodeVisual draws with it and Point at aims with it.
 * R4 (owner 23.10: "mark 1 and 4 calibrated position correctly but 2 and 3 didnt"): from 3 marks that no single
 * offset fits, the warning names where the marks put the head (`place`, x, y + offset); R6: a hint only — the
 * calibration never moves the head.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { FollowEngine } = require('../../src/fixtures/follow-engine')
const { MarkerHub } = require('../../src/tracking/marker-hub')
const { createCalibration } = require('../../src/fixtures/calibrate-session')
const { solveOffsets } = require('../../src/fixtures/calibrate-solve')
const { parseDescription } = require('../../src/fixtures/gdtf-parse')
const { buildRig } = require('../../src/fixtures/gdtf-rig')
const { chainOf, beamOf } = require('../../src/fixtures/gdtf-ik')
const { writeGdtf } = require('../../src/fixtures/gdtf-patch')
const { aimValues } = require('../../src/fixtures/gdtf-features')
const { normalizeFixture } = require('../../src/fixtures/follow-patch')
const { compileVisual, decodeVisual } = require('../../src/fixtures/gdtf-visual')

const GD = (rel) => fs.readFileSync(path.join(__dirname, '../../godot/client', rel), 'utf8')
const XML = fs.readFileSync(path.join(__dirname, '../fixtures/gdtf/test-spot.xml'), 'utf8')

/** A test-spot.xml head patched at `pose` (+ `extra` patch keys), and the 512 bytes its real head gets. */
async function typed(pose, extra = {}) {
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
				pose,
				...extra,
			},
		],
	})
	const fx = engine.fixtures[0]
	const buf = new Uint8Array(512)
	const cal = createCalibration({ engine, hub: { list: () => [], now: () => 0 }, frame: () => buf })
	return { t, engine, fx, buf, cal, sent: () => sent }
}

/** Distance (m) from `mark` to the beam of fx drawn at physical pan / tilt + offset. */
function miss(fx, pan, tilt, off, mark) {
	const { origin, dir } = beamOf(fx.gdtf.chain, fx.pose, pan + off.pan, tilt + off.tilt)
	const w = mark.map((v, i) => v - origin[i])
	const along = w[0] * dir[0] + w[1] * dir[1] + w[2] * dir[2]
	return Math.hypot(...w.map((v, i) => v - along * dir[i]))
}

const POSE = { x: 1, y: 0, z: 6, hang: 'truss', yaw: 0 }
const REAL_OFFSET = { pan: 20, tilt: -6 } // how the real head sits against its patch (yoke turned, tilt off)
const MARKS = [
	[0, 3, 0],
	[3, 2, 0],
	[-2, 5, 0],
	[2, 6, 0],
]

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

	it('a head without a GDTF pan / tilt chain has no live calibration', () => {
		const { cal } = rig(true)
		assert.equal(cal.handle({ action: 'start', id: 'fx1', hold: false }).status, 409)
	})

	it('one mark: the offset the real head has, the head not moved, nothing sent, no jog', async () => {
		const { fx, buf, cal, sent, engine } = await typed(POSE)
		const r0 = cal.handle({ action: 'start', id: 'h', hold: false })
		assert.equal(r0.status, 200)
		assert.deepEqual(r0.body.offset0, { pan: 0, tilt: 0 })
		assert.notEqual(engine.aimOf('h').state, 'calibrating')
		assert.equal(cal.handle({ action: 'jog', id: 'h', dpan: 5 }).status, 409)
		// the operator aims the real head onto the mark (Programmer values, as written to the wire)
		const v = aimValues({ ...fx, offset: REAL_OFFSET }, MARKS[0])
		writeGdtf(buf, fx, v)
		const r = cal.handle({ action: 'point', id: 'h', at: MARKS[0] }).body
		assert.ok(
			Math.abs(r.points[0].pan - v.Pan) < 0.05 && Math.abs(r.points[0].tilt - v.Tilt) < 0.05,
			'read the angles sent'
		)
		assert.equal(r.solve.ok, true)
		assert.ok(Math.abs(r.solve.offset.pan - REAL_OFFSET.pan) < 0.1, JSON.stringify(r.solve))
		assert.ok(Math.abs(r.solve.offset.tilt - REAL_OFFSET.tilt) < 0.1, JSON.stringify(r.solve))
		assert.equal(r.solve.pose, undefined, 'no pose: the head stays where it is patched')
		assert.equal(sent(), 0, 'calibrating sends no DMX')
	})

	it('more marks: least squares; the digital beam lands on every mark', async () => {
		const { fx, buf, cal } = await typed(POSE)
		cal.handle({ action: 'start', id: 'h', hold: false })
		let r = null
		for (const mark of MARKS) {
			writeGdtf(buf, fx, aimValues({ ...fx, offset: REAL_OFFSET }, mark))
			r = cal.handle({ action: 'point', id: 'h', at: mark }).body
		}
		for (const [k, p] of r.points.entries())
			assert.ok(miss(fx, p.pan, p.tilt, r.solve.offset, MARKS[k]) < 0.05, `mark ${k + 1}`)
		assert.equal(r.solve.warning, null)
	})

	it('R4: a head patched in the wrong spot — the warning names where the marks put it (a hint, R6)', async () => {
		// live 23.10 (owner: "mark 1 and 4 calibrated position correctly but 2 and 3 didnt"): the real head stood
		// ~2 m from its patch; one offset turned the beam onto the marks on one side only
		const REAL = { ...POSE, x: 2.5, y: -1.5 }
		const real = (await typed(REAL)).fx
		const { fx, buf, cal } = await typed(POSE)
		cal.handle({ action: 'start', id: 'h', hold: false })
		let r = null
		for (const mark of MARKS) {
			writeGdtf(buf, fx, aimValues({ ...real, offset: REAL_OFFSET }, mark))
			r = cal.handle({ action: 'point', id: 'h', at: mark }).body
		}
		assert.ok(r.solve.rms_deg > 1, 'no single offset fits')
		assert.equal(r.solve.pose, undefined, 'the head is not moved by itself')
		const { place } = r.solve
		assert.ok(Math.hypot(place.x - REAL.x, place.y - REAL.y) < 0.05, JSON.stringify(place))
		assert.ok(Math.abs(place.offset.pan - REAL_OFFSET.pan) < 0.5 && Math.abs(place.offset.tilt - REAL_OFFSET.tilt) < 0.5)
		assert.match(r.solve.warning, /not where it is patched.*check its position in the patch/)
		const moved = { ...fx, pose: { ...fx.pose, x: place.x, y: place.y } }
		for (const [k, p] of r.points.entries())
			assert.ok(miss(moved, p.pan, p.tilt, place.offset, MARKS[k]) < 0.05, `mark ${k + 1}`)
		// moved there, the session solves a plain offset again — no further move offered
		const again = await typed({ ...POSE, x: place.x, y: place.y })
		again.cal.handle({ action: 'start', id: 'h', hold: false })
		for (const mark of MARKS) {
			writeGdtf(again.buf, again.fx, aimValues({ ...real, offset: REAL_OFFSET }, mark))
			r = again.cal.handle({ action: 'point', id: 'h', at: mark }).body
		}
		assert.ok(r.solve.rms_deg < 0.2 && r.solve.place === null && r.solve.warning === null, JSON.stringify(r.solve))
	})

	it('R5: marks that disagree a little keep the small offset, not the flipped-over mirror', async () => {
		// live 23.10: two marks 3° apart solved (−168°, +139°) — the same beams, the digital head drawn upside down
		const off = (await typed({ ...POSE, x: 2.5, y: -1.5 })).fx
		const { fx, buf, cal } = await typed(POSE)
		cal.handle({ action: 'start', id: 'h', hold: false })
		for (const [n, pose] of [
			[0, 0],
			[1, 1],
			[2, 2],
		].map(([k]) => [k, MARKS[k]])) {
			writeGdtf(buf, fx, aimValues({ ...(n ? off : fx), offset: REAL_OFFSET }, pose))
			const { solve } = cal.handle({ action: 'point', id: 'h', at: pose }).body
			assert.ok(
				Math.abs(solve.offset.pan) < 45 && Math.abs(solve.offset.tilt) < 45,
				`${n + 1} marks ${JSON.stringify(solve)}`
			)
		}
	})

	it('a live point with no DMX for the head is refused', async () => {
		const { engine } = await typed(POSE)
		const cal = createCalibration({ engine, hub: { list: () => [], now: () => 0 }, frame: () => null })
		cal.handle({ action: 'start', id: 'h', hold: false })
		assert.equal(cal.handle({ action: 'point', id: 'h', at: [1, 2, 0] }).status, 409)
	})

	it('marks that disagree on one offset warn (head patched in the wrong place)', () => {
		const forward = (p, t) =>
			beamOf(
				[
					{ xf: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], axis: 'pan' },
					{ xf: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], axis: 'tilt' },
				],
				POSE,
				p,
				t
			)
		const pts = [
			{ pan: 0, tilt: 0, x: 1, y: 0, z: 0 },
			{ pan: 0, tilt: 0, x: 4, y: 4, z: 0 },
		]
		assert.match(solveOffsets(pts, forward).warning, /do not agree/)
		assert.deepEqual(solveOffsets([], forward), { ok: false, need: 1 })
		// live 23.10: a floor head beaming up, a floor mark it was not on → 127° of tilt: say so
		assert.match(
			solveOffsets([{ pan: 0, tilt: 0, x: 1, y: 3, z: 0 }], (p, t) =>
				beamOf(
					[
						{ xf: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], axis: 'pan' },
						{ xf: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], axis: 'tilt' },
					],
					{ ...POSE, z: 2, hang: 'floor' },
					p,
					t
				)
			).warning,
			/large tilt offset/
		)
	})

	it('the patch keeps the offset; the previs draws with it; Point at aims the real head with it', async () => {
		assert.deepEqual(normalizeFixture({ offset: { pan: 20, tilt: -6 } }, 0).offset, { pan: 20, tilt: -6 })
		assert.equal(normalizeFixture({ offset: { pan: 0, tilt: 0 } }, 0).offset, undefined, 'no offset → no key')
		assert.deepEqual(normalizeFixture({ offset: { pan: 999, tilt: 'x' } }, 0).offset, { pan: 180, tilt: 0 })
		const { t, fx, buf } = await typed(POSE, { offset: REAL_OFFSET })
		const mode = t.modes.find((m) => m.name === 'Standard')
		const plan = compileVisual(t, mode, buildRig(t, mode))
		writeGdtf(buf, fx, { Pan: 30, Tilt: 40 })
		const plain = decodeVisual(plan, buf, 1).axes
		const shifted = decodeVisual(plan, buf, 1, REAL_OFFSET).axes
		const deltas = Object.keys(plain)
			.map((k) => Math.round((shifted[k] - plain[k]) * 100) / 100)
			.sort((a, b) => a - b)
		assert.deepEqual(deltas, [-6, 20], 'pan + 20, tilt − 6')
		const v = aimValues(fx, [0, 3, 0]) // fx carries the offset: the real head (sent + offset) hits the target
		assert.ok(miss(fx, v.Pan, v.Tilt, REAL_OFFSET, [0, 3, 0]) < 0.02)
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
			GD('features/previs/tracking/follow_model.gd'),
			/out\.offset = \{"pan": float\(o\.pan\), "tilt": float\(o\.tilt\)\}/
		)
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
