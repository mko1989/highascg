'use strict'

/**
 * WO-804 — calibrate the rig together: the app picks the anchor heads (rig-anchors.js), the operator aims each at its
 * marks one prompt at a time (rig-calibrate.js over the WO-700 live session), the anchors are solved
 * (calibrate-solve.js solvePoseForward) and the rest is inferred (rig-infer.js). The rig is the real MHP patch
 * (tools/smoke/fixtures/mhp-rig-movers.sample.json: the 110 pan / tilt heads of projects/_mvr/ba5546d8a901.mvr).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { chooseAnchors, findRows, marksFor } = require('../../src/fixtures/rig-anchors')
const { inferRig } = require('../../src/fixtures/rig-infer')
const { solvePoseForward } = require('../../src/fixtures/calibrate-solve')
const { beam, aim } = require('../../src/fixtures/follow-ik')
const { FollowEngine } = require('../../src/fixtures/follow-engine')
const { createCalibration } = require('../../src/fixtures/calibrate-session')
const { createRigCalibration } = require('../../src/fixtures/rig-calibrate')
const { parseDescription } = require('../../src/fixtures/gdtf-parse')
const { buildRig } = require('../../src/fixtures/gdtf-rig')
const { chainOf } = require('../../src/fixtures/gdtf-ik')
const { writeGdtf } = require('../../src/fixtures/gdtf-patch')
const { aimValues } = require('../../src/fixtures/gdtf-features')

const RIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/mhp-rig-movers.sample.json'), 'utf8')).heads
const XML = fs.readFileSync(path.join(__dirname, '../fixtures/gdtf/test-spot.xml'), 'utf8')
const SRC = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')
// the 9 preset marks (follow_model.gd preset_marks) over the MHP stage floor
const MARKS = [[-5, -2], [0, -2], [5, -2], [5, 3], [5, 8], [0, 8], [-5, 8], [-5, 3], [0, 3]].map(([x, y], i) => ({
	id: i + 1, name: `M${i + 1}`, x, y, z: 0 }))
const D = Math.PI / 180

/** The truth: the patch turned `turn`° (ccw in plan) about the origin, shifted, each row of 2+ heads (a truss, a
 * ladder) trimmed by `trim(rowIndex)` — a lone head is on no truss, so it moves with the rig. */
function moved(heads, rows, { turn = 1.2, shift = [0.25, -0.18, 0.06], trim = (i) => ((i % 5) - 2) * 0.07 } = {}) {
	const rowIx = new Map(rows.flatMap((r, i) => (r.heads.length > 1 ? r.heads.map((id) => [id, i]) : [])))
	const [c, s] = [Math.cos(turn * D), Math.sin(turn * D)]
	return new Map(heads.map((h) => {
		const p = h.pose
		const dz = rowIx.has(h.id) ? trim(rowIx.get(h.id)) : 0
		return [h.id, { ...p, x: p.x * c - p.y * s + shift[0], y: p.x * s + p.y * c + shift[1], z: p.z + shift[2] + dz, yaw: p.yaw - turn }]
	}))
}

describe('WO-804 anchor choice on the MHP rig', () => {
	const plan = chooseAnchors(RIG, { marks: MARKS })
	it('finds the rig rows from the positions alone', () => {
		const multi = plan.rows.filter((r) => r.heads.length > 1)
		assert.equal(multi.length, 16)
		assert.equal(plan.rows.reduce((n, r) => n + r.heads.length, 0), RIG.length, 'every head in one row')
		const ladders = multi.filter((r) => r.dir && Math.abs(r.dir[2]) > 0.99)
		assert.equal(ladders.length, 4, 'the 4 Vizi Beam ladders')
		assert.equal(Math.max(...multi.map((r) => r.heads.length)), 18, 'the floor line of X-Dots')
	})
	it('few anchors: one per row, two on a long row, the first three span the rig', () => {
		assert.ok(plan.anchors.length <= RIG.length / 4, `${plan.anchors.length} of ${RIG.length}`)
		assert.equal(plan.anchors.length + plan.inferred.length, RIG.length)
		for (const r of plan.rows.filter((x) => x.heads.length > 1)) {
			const n = plan.anchors.filter((a) => a.row === r.id).length
			assert.ok(n >= 1, `${r.id} has an anchor`)
			if (r.heads.length >= 4 && r.extent_m >= 6 && !(Math.abs(r.dir[2]) > 0.99)) assert.equal(n, 2, `${r.id} long`)
		}
		const P = plan.anchors.slice(0, 3).map((a) => RIG.find((h) => h.id === a.id).pose)
		const area = Math.abs((P[1].x - P[0].x) * (P[2].y - P[0].y) - (P[2].x - P[0].x) * (P[1].y - P[0].y)) / 2
		assert.ok(area > 20, `first three anchors span ${area.toFixed(1)} m² of plan`)
	})
	it('3 spread marks per anchor, the one under the head first; max caps the count', () => {
		for (const a of plan.anchors) {
			assert.equal(new Set(a.marks).size, 3)
			const h = RIG.find((x) => x.id === a.id).pose
			const d = (m) => Math.hypot(m.x - h.x, m.y - h.y)
			assert.equal(d(MARKS[a.marks[0] - 1]), Math.min(...MARKS.map(d)))
		}
		assert.equal(chooseAnchors(RIG, { marks: MARKS, max: 6 }).anchors.length, 6)
		// fewer marks than wanted: all of them, the nearest first (RIG[0] hangs stage right: x −9.9)
		assert.deepEqual(marksFor(RIG[0], MARKS.slice(0, 2)), [1, 2])
	})
	it('a scatter with no lines still gets 3 spread anchors', () => {
		const scatter = [[0, 0, 9], [7, 1, 8], [3, 9, 10], [-6, 4, 7]].map(([x, y, z], i) => ({ id: `s${i}`, pose: { x, y, z } }))
		assert.equal(findRows(scatter).every((r) => r.heads.length === 1), true)
		assert.equal(chooseAnchors(scatter).anchors.length, 3)
	})
})

describe('WO-804 anchor pose solve (the WO-764 solver through the head model)', () => {
	const fwd = (pan, tilt, pose) => ({ origin: [pose.x, pose.y, pose.z], dir: beam(pose, pan, tilt) })
	const truth = { x: 1.3, y: 4.2, z: 9.6, yaw: 12, hang: 'truss', pitch: 0, roll: 0 }
	const pts = (marks) =>
		marks.map((m) => ({ ...aim({ pose: truth, pan: { range: 540 }, tilt: { range: 270 } }, [m.x, m.y, m.z]), x: m.x, y: m.y, z: m.z }))
	it('3 marks give x, y, z and yaw from the patched start; hang / pitch / roll kept', () => {
		const r = solvePoseForward(pts(MARKS.slice(0, 3).concat(MARKS[5])).slice(1), fwd, { pose: { ...truth, x: 1, y: 4.6, z: 10, yaw: 0 } })
		assert.equal(r.ok, true)
		for (const k of ['x', 'y', 'z']) assert.ok(Math.abs(r.pose[k] - truth[k]) < 0.01, k)
		assert.ok(Math.abs(r.pose.yaw - truth.yaw) < 0.1)
		assert.equal(r.pose.hang, 'truss')
		assert.ok(r.rms_deg < 0.05)
	})
	it('fewer than 3 marks → need; marks on one line → warning', () => {
		assert.deepEqual(solvePoseForward(pts(MARKS.slice(0, 2)), fwd, { pose: truth }), { ok: false, need: 1 })
		assert.match(solvePoseForward(pts(MARKS.slice(0, 3)), fwd, { pose: truth }).warning, /one line/)
	})
})

describe('WO-804 inference (model b: rig fit + per row)', () => {
	const plan = chooseAnchors(RIG, { marks: MARKS })
	const truth = moved(RIG, plan.rows)
	const solved = Object.fromEntries(plan.anchors.map((a) => [a.id, { pose: truth.get(a.id), rms_deg: 0.1 }]))
	const r = inferRig(RIG, solved, plan.rows)
	it('every head is measured or inferred, each inferred one with a residual', () => {
		assert.equal(r.measured, plan.anchors.length)
		assert.equal(r.inferred, RIG.length - plan.anchors.length)
		for (const h of r.heads) {
			assert.ok(['measured', 'inferred'].includes(h.source))
			if (h.source === 'inferred') assert.equal(typeof h.residual_m, 'number', h.name)
		}
	})
	it('a turned, shifted rig with trusses at their own trims is recovered for the heads nobody measured', () => {
		assert.ok(Math.abs(r.fit.turn_deg - 1.2) < 0.2, `rig turn ${r.fit.turn_deg}`)
		for (const h of r.heads.filter((x) => x.source === 'inferred')) {
			const t = truth.get(h.id)
			const miss = Math.hypot(h.pose.x - t.x, h.pose.y - t.y, h.pose.z - t.z)
			assert.ok(miss < 0.02, `${h.name} off by ${miss.toFixed(3)} m`)
			assert.ok(Math.abs(((h.pose.yaw - t.yaw + 540) % 360) - 180) < 0.1, `${h.name} yaw`)
			assert.equal(h.pose.hang, t.hang)
		}
	})
	it('fewer than two anchors: inferred residual is unknown, not zero', () => {
		const one = inferRig(RIG, { [plan.anchors[0].id]: solved[plan.anchors[0].id] }, plan.rows)
		assert.ok(one.heads.filter((h) => h.source === 'inferred').every((h) => h.residual_m === null))
	})
})

/** The MHP rig patched with the test-spot GDTF (each head on its own sACN universe) at `poses` (id → pose). */
async function typedRig(poses) {
	const t = await parseDescription(XML, ['description.xml'])
	const resolveMode = (id, name) => {
		const m = t.modes.find((x) => x.name === name)
		return m ? { ...m, chain: chainOf(buildRig(t, m)) } : null
	}
	const engine = new FollowEngine({ hub: { list: () => [], now: () => 0 }, now: () => 0, send: () => {}, resolveMode })
	engine.configure({ patch: RIG.map((h, i) => ({ id: h.id, name: h.name, typeId: 'cccccccccccc', mode: 'Standard', protocol: 'sacn',
		universe: i + 1, address: 1, pose: poses.get(h.id) })) })
	return engine
}

describe('WO-804 the operator flow over the live session (real GDTF head model)', () => {
	it('one prompt at a time, anchors solved from the real beams, the rest inferred close to the truth', async () => {
		const plan = chooseAnchors(RIG, { marks: MARKS })
		const truth = moved(RIG, plan.rows)
		const engine = await typedRig(new Map(RIG.map((h) => [h.id, h.pose])))
		const real = await typedRig(truth)
		const bufs = new Map(RIG.map((h) => [h.id, new Uint8Array(512)]))
		const calib = createCalibration({ engine, hub: { list: () => [], now: () => 0 }, frame: (fx) => bufs.get(fx.id) })
		const rig = createRigCalibration({ engine, calib, project: () => ({ fixtures: { marks: MARKS } }) })
		assert.equal(rig.route('POST', '{"action":"point"}').status, 409, 'start first')
		let v = rig.handle({ action: 'start' }).body
		assert.equal(v.anchors.length, plan.anchors.length)
		let aims = 0
		while (v.prompt) {
			const fx = engine.fixtures.find((f) => f.id === v.prompt.id)
			const rf = real.fixtures.find((f) => f.id === v.prompt.id)
			assert.equal(calib.list().length, 1, 'only the prompted head is in a session')
			writeGdtf(bufs.get(fx.id), fx, aimValues(rf, [v.prompt.mark.x, v.prompt.mark.y, v.prompt.mark.z]))
			const r = rig.route('POST', JSON.stringify({ action: 'point' }))
			assert.equal(r.status, 200, JSON.stringify(r.body))
			v = r.body
			aims++
		}
		assert.equal(v.done, true)
		assert.equal(aims, plan.anchors.length * 3)
		assert.equal(calib.list().length, 0, 'every head released')
		for (const a of v.anchors) assert.equal(a.status, 'solved', `${a.name}: ${a.warning}`)
		const out = v.result
		assert.equal(out.measured + out.inferred, RIG.length)
		for (const h of out.heads) {
			const t = truth.get(h.id)
			const miss = Math.hypot(h.pose.x - t.x, h.pose.y - t.y, h.pose.z - t.z)
			assert.ok(miss < 0.05, `${h.source} ${h.name} off by ${miss.toFixed(3)} m`)
		}
		// residuals: heads on a measured row are predicted to the cm; a lone head carries the rig-level uncertainty
		for (const h of out.heads.filter((x) => x.source === 'inferred')) {
			assert.equal(typeof h.residual_m, 'number')
			if (h.basis === 'row') assert.ok(h.residual_m < 0.05, `${h.name} residual ${h.residual_m}`)
		}
	})

	it('skip replaces a mark, undo steps back, infer stops early, measure adds a head, end releases', async () => {
		const engine = await typedRig(new Map(RIG.map((h) => [h.id, h.pose])))
		const bufs = new Map(RIG.map((h) => [h.id, new Uint8Array(512)]))
		const calib = createCalibration({ engine, hub: { list: () => [], now: () => 0 }, frame: (fx) => bufs.get(fx.id) })
		const rig = createRigCalibration({ engine, calib, project: () => ({ fixtures: { marks: MARKS } }) })
		const none = createRigCalibration({ engine, calib, project: () => ({ fixtures: { marks: MARKS.slice(0, 2) } }) })
		assert.match(none.handle({ action: 'start' }).body.error, /3 stage marks/)
		let v = rig.handle({ action: 'start', max: 4 }).body
		assert.equal(v.anchors.length, 4)
		const first = v.prompt.mark.id
		v = rig.handle({ action: 'skip' }).body
		assert.notEqual(v.prompt.mark.id, first, 'another mark')
		assert.equal(v.prompt.n, 1)
		const aimAt = () => {
			const fx = engine.fixtures.find((f) => f.id === v.prompt.id)
			writeGdtf(bufs.get(fx.id), fx, aimValues(fx, [v.prompt.mark.x, v.prompt.mark.y, v.prompt.mark.z]))
		}
		aimAt()
		v = rig.handle({ action: 'point' }).body
		assert.equal(v.prompt.n, 2)
		v = rig.handle({ action: 'undo' }).body
		assert.equal(v.prompt.n, 1)
		for (let i = 0; i < 6; i++) {
			aimAt()
			v = rig.handle({ action: 'point' }).body
		}
		assert.equal(v.anchors.filter((a) => a.status === 'solved').length, 2)
		v = rig.handle({ action: 'infer' }).body
		assert.equal(v.done, true)
		assert.equal(v.prompt, null)
		assert.equal(v.result.measured, 2)
		assert.equal(calib.list().length, 0)
		const extra = v.result.heads.find((h) => h.source === 'inferred').id
		v = rig.handle({ action: 'measure', id: extra }).body
		assert.equal(v.prompt.id, extra, 'prompted at once')
		assert.equal(rig.handle({ action: 'end' }).body.ended, true)
		assert.equal(calib.list().length, 0)
		assert.equal(rig.route('GET').body.active, false)
	})
})

describe('WO-804 wiring', () => {
	it('the route sits before the single-head calibrate route; the client keeps calibrated_pose', () => {
		const reg = SRC('src/tracking/register.js')
		assert.match(reg, /path === '\/api\/tracking\/follow\/calibrate\/rig' && \(_rig\?\.route\(method, body\)/)
		assert.ok(reg.indexOf("calibrate/rig'") < reg.indexOf("path === '/api/tracking/follow/calibrate')"))
		const fm = SRC('godot/client/features/previs/tracking/follow_model.gd')
		assert.match(fm, /out\["calibrated_pose"\] = cp/)
		assert.match(fm, /static func apply_rig\(/)
	})
})
