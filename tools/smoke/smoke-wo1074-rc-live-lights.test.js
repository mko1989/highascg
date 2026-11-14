'use strict'

/**
 * WO-1074 §2.6 — RC game: live lights (src/game/rc-lights-fk.js, src/game/rc-lights.js). The beam direction must be the
 * previs's (fixtures_3d.gd: pose_xform, axis_basis, beam along the Beam node's −Y): checked at rest, against hand-made
 * rotations, and end to end against the follow engine's own aiming — gdtf-ik.js aims a head at a point, the DMX it would
 * send is decoded by gdtf-visual.js (what visual() serves), and the direction computed from those axes must point at
 * that point. Synthetic rig always; a real GDTF from projects/_gdtf when the box has it (read-only, skipped elsewhere).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { fk, headFrame, lightOf, kindOf } = require('../../src/game/rc-lights-fk')
const { createRcLights, withLiveScene, MAX_LIGHTS } = require('../../src/game/rc-lights')
const { aimFixture, chainOf, toPhys, fileAxis, axisFn } = require('../../src/fixtures/gdtf-ik')

const close = (a, b, eps = 1e-6) => a.every((v, k) => Math.abs(v - b[k]) < eps)
const angleDeg = (a, b) => {
	const n = Math.hypot(...a) * Math.hypot(...b)
	return (Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / n))) * 180) / Math.PI
}
const I12 = (o = [0, 0, 0]) => [1, 0, 0, 0, 1, 0, 0, 0, 1, ...o]

/** A moving head: Base → Yoke (pan, 0.1 m down) → Head (tilt, 0.35 m down) → Beam (0.1 m further, along −Y). */
const RIG = {
	nodes: [
		{ id: 'Base', parent: -1, kind: 'Geometry', xf: I12() },
		{ id: 'Yoke', parent: 0, kind: 'Axis', axis: 'pan', xf: I12([0, -0.1, 0]) },
		{ id: 'Head', parent: 1, kind: 'Axis', axis: 'tilt', xf: I12([0, -0.35, 0]) },
		{ id: 'Beam', parent: 2, kind: 'Beam', xf: I12([0, -0.1, 0]), beam: { beamType: 'Spot', beamAngle: 20 } },
	],
}
const POSE = { x: 1, y: 4, z: 6, hang: 'truss', yaw: 0, pitch: 0, roll: 0 }

describe('rc-lights-fk — the previs forward kinematics', () => {
	it('a truss-hung head at rest points straight down; a floor-standing one straight up', () => {
		const k = fk(RIG, POSE, {})
		assert.ok(close(k.beams[0].d, [0, -1, 0]))
		assert.ok(close(k.beams[0].o, [1, 6 - 0.55, -4]), 'pose (x, z, −y) → Godot, beam 0.55 m below the clamp')
		assert.ok(close(k.pivot, [1, 6 - 0.45, -4]), 'pivot = the tilt node')
		const up = fk(RIG, { ...POSE, hang: 'floor', z: 0 }, {})
		assert.ok(close(up.beams[0].d, [0, 1, 0]))
	})

	it('tilt turns about the head RIGHT, pan about UP (axis_basis), yaw is −yaw about Y (pose_xform)', () => {
		// tilt +90 about +X: −Y → (0, 0, −1)·… Basis(RIGHT, θ) maps y-column (0,1,0) → (0, cos, sin): beam = −that
		const t = fk(RIG, POSE, { Head: 90 }).beams[0].d
		assert.ok(close(t, [0, 0, -1], 1e-9), JSON.stringify(t))
		const pt = fk(RIG, POSE, { Yoke: 90, Head: 90 }).beams[0].d // pan +90 about +Y turns −Z into −X
		assert.ok(close(pt, [-1, 0, 0], 1e-9), JSON.stringify(pt))
		const yawed = fk(RIG, { ...POSE, yaw: 90 }, { Head: 90 }).beams[0].d // Ry(−90°) turns −Z into +X
		assert.ok(close(yawed, [1, 0, 0], 1e-9), JSON.stringify(yawed))
	})

	it('end to end with the follow IK (synthetic rig): aimed at a point, the direction points at it', () => {
		const chain = chainOf(RIG)
		const fx = {
			pose: POSE,
			pan: { ch: 1, range: 540, invert: false },
			tilt: { ch: 3, range: 270, invert: false },
			gdtf: {
				chain,
				channels: [
					{ initial: 0, functions: [{ attribute: 'Pan', physFrom: -270, physTo: 270 }] },
					{ initial: 0, functions: [{ attribute: 'Tilt', physFrom: -135, physTo: 135 }] },
				],
			},
		}
		for (const target of [
			[0, 0, 0],
			[4, 1, 1.4],
			[-3, 9, 0],
			[1, 2, 0],
		]) {
			const pt = aimFixture(fx, target)
			assert.ok(pt, `reachable ${target}`)
			const pf = axisFn(fx, 'Pan')
			const tf = axisFn(fx, 'Tilt')
			const axes = { Yoke: toPhys(pf, fileAxis(pf, fx.pan), pt.pan), Head: toPhys(tf, fileAxis(tf, fx.tilt), pt.tilt) }
			const k = fk(RIG, POSE, axes)
			const g = [target[0], target[2], -target[1]]
			const b = k.beams[0]
			assert.ok(angleDeg(b.d, [g[0] - b.o[0], g[1] - b.o[1], g[2] - b.o[2]]) < 0.01, `beam → ${target}`)
			assert.ok(angleDeg(b.d, [g[0] - k.pivot[0], g[1] - k.pivot[1], g[2] - k.pivot[2]]) < 0.01, 'and from the pivot p')
		}
	})

	const REAL = path.join(__dirname, '..', '..', 'projects', '_gdtf', 'c24ac67a2350.json')
	it(
		'end to end with a real GDTF (MAC Quantum Profile) through the DMX the engine sends',
		{ skip: !fs.existsSync(REAL) && 'no projects/_gdtf on this machine' },
		() => {
			const { buildRig } = require('../../src/fixtures/gdtf-rig')
			const { compileVisual, decodeVisual } = require('../../src/fixtures/gdtf-visual')
			const { normalizePatch } = require('../../src/fixtures/follow-patch')
			const { writeFixture } = require('../../src/fixtures/follow-ik')
			const { transposeRotation } = require('../../src/stage/mvr-math')
			const rec = JSON.parse(fs.readFileSync(REAL, 'utf8'))
			if (rec.geometryMatrix !== 2) {
				// gdtf-store.js migrateGeometry (WO-1006), in memory
				const fix = (gs) => {
					for (const g of gs || []) {
						if (Array.isArray(g.m) && g.m.length === 16) g.m = transposeRotation(g.m)
						fix(g.children)
					}
				}
				fix(rec.type.geometry)
			}
			const mode = rec.type.modes.find((m) => m.name === 'Extended') || rec.type.modes[0]
			const rig = buildRig(rec.type, mode)
			const plan = compileVisual(rec.type, mode, rig)
			const resolveMode = () => ({ ...mode, chain: chainOf(rig) })
			let checked = 0
			for (const pose of [
				POSE,
				{ x: -3, y: 2, z: 0.4, hang: 'floor', yaw: 30 },
				{ x: 2, y: 7, z: 7, hang: 'truss', yaw: -60, pitch: 10, roll: 5 },
			]) {
				const {
					fixtures: [fx],
				} = normalizePatch(
					{ patch: [{ id: 'q', typeId: 'c24ac67a2350', mode: mode.name, address: 1, universe: 1, pose }] },
					{ resolveMode }
				)
				for (const target of [
					[0, 0, 0],
					[3, 5, 1],
					[-6, 2, 0],
				]) {
					const pt = aimFixture(fx, target)
					if (!pt) continue
					const buf = new Uint8Array(512)
					writeFixture(buf, fx, pt, [])
					const vis = decodeVisual(plan, buf, fx.address)
					const k = fk(rig, fx.pose, vis.axes)
					const g = [target[0], target[2], -target[1]]
					const b = k.beams[0]
					assert.ok(angleDeg(b.d, [g[0] - b.o[0], g[1] - b.o[1], g[2] - b.o[2]]) < 0.05, `${pose.hang} → ${target}`)
					checked++
				}
			}
			assert.ok(checked >= 6, `${checked} aims checked`)
		}
	)

	it('a multi-beam head is one entry: mean colour of the lit beams, max intensity, widest zoom', () => {
		const rig = {
			nodes: [
				{ id: 'Base', parent: -1, kind: 'Geometry', xf: I12() },
				{ id: 'A', parent: 0, kind: 'Beam', xf: I12([-0.1, 0, 0]), beam: {} },
				{ id: 'B', parent: 0, kind: 'Beam', xf: I12([0.1, 0, 0]), beam: {} },
				{ id: 'C', parent: 0, kind: 'Beam', xf: I12([0.2, 0, 0]), beam: { driven: false } },
			],
		}
		const f = headFrame(rig, POSE, {
			axes: {},
			beams: {
				A: { i: 1, c: [1, 0, 0], zoom: 10 },
				B: { i: 0.5, c: [0, 0, 1], zoom: 30 },
				C: { i: 1, c: [0, 1, 0], zoom: 90 },
			},
		})
		assert.deepEqual(f.slice(0, 3), [0, -1, 0])
		assert.ok(Math.abs(f[3] - 2 / 3) < 0.002 && f[4] === 0 && Math.abs(f[5] - 1 / 3) < 0.002, `colour ${f.slice(3, 6)}`)
		assert.equal(f[6], 1)
		assert.equal(f[7], 30, 'the undriven beam C never counts')
		assert.equal(headFrame(rig, POSE, null)[6], 0, 'no visual record → dark')
	})

	it('kinds: moving spot / wash, static bar and strobe', () => {
		assert.equal(kindOf(RIG, 'MAC Quantum Profile', ''), 'spot')
		const cells = {
			nodes: [
				{ id: 'B', parent: -1, kind: 'Geometry', xf: I12() },
				...[1, 2, 3, 4, 5].map((n) => ({ id: `c${n}`, parent: 0, kind: 'Beam', xf: I12(), beam: { beamAngle: 110 } })),
			],
		}
		assert.equal(kindOf(cells, 'PIXEL LINE IP (STROBE 3 IP)', ''), 'strobe')
		assert.equal(kindOf(cells, 'Pixel Bar', ''), 'bar')
		const wash = {
			nodes: RIG.nodes.map((n) => (n.kind === 'Beam' ? { ...n, beam: { beamType: 'Wash', beamAngle: 53 } } : n)),
		}
		assert.equal(kindOf(wash, 'Robin 600 LEDWash', ''), 'wash')
		assert.deepEqual(lightOf({ id: 'f', name: 'Spot 1', pose: POSE }, RIG, 'X'), {
			id: 'f',
			name: 'Spot 1',
			p: [1, 5.55, -4],
			kind: 'spot',
		})
	})
})

/** A fake follow service: `fixtures` (normalised patch) and a mutable visual(). */
function rig(n = 3) {
	let fixtures = Array.from({ length: n }, (_, k) => ({
		id: `f${k}`,
		name: `Head ${k}`,
		enabled: true,
		typeId: 'aaaaaaaaaaaa',
		mode: 'M',
		pose: { ...POSE, x: k },
	}))
	const vis = new Map(
		fixtures.map((f) => [
			f.id,
			{ id: f.id, axes: { Yoke: 0, Head: 0 }, beams: { Beam: { i: 0, c: [1, 1, 1], zoom: 20 } } },
		])
	)
	const sent = []
	const timers = []
	let t = 1000
	const lx = createRcLights({
		fixtures: () => fixtures,
		visual: () => ({ fixtures: [...vis.values()] }),
		rigOf: () => RIG,
		send: (ws, m) => sent.push([ws, m]),
		now: () => t,
		setInterval: (fn, ms) => (timers.push({ fn, ms }), timers.length),
		clearInterval: (id) => (timers[id - 1] = null),
	})
	return {
		lx,
		fixtures: () => fixtures,
		setFixtures: (f) => (fixtures = f),
		vis,
		sent,
		timers,
		tick: () => ((t += 100), lx.tick()),
		live: () => timers.filter(Boolean).length,
	}
}

describe('rc-lights — the realtime producer', () => {
	it('costs nothing without sockets; attach → lxfull with the list; idle → silent; one change → one lx entry', () => {
		const r = rig()
		assert.equal(r.live(), 0, 'no timer before anyone attaches')
		assert.equal(r.sent.length, 0)
		r.lx.attach('A')
		assert.equal(r.live(), 1)
		assert.equal(r.timers[0].ms, 100, '10 Hz')
		const [ws, full] = r.sent.shift()
		assert.equal(ws, 'A')
		assert.equal(full.t, 'lxfull')
		assert.equal(full.on, true)
		assert.deepEqual(
			full.lights.map((l) => [l.i, l.id, l.kind]),
			[
				[0, 'f0', 'spot'],
				[1, 'f1', 'spot'],
				[2, 'f2', 'spot'],
			]
		)
		assert.equal(full.f.length, 3)
		assert.deepEqual(full.f[1], [1, 0, -1, 0, 1, 1, 1, 0, 20])
		r.tick()
		r.tick()
		assert.equal(r.sent.length, 0, 'nothing while nothing changes')
		r.vis.get('f1').axes.Head = 90
		r.vis.get('f1').beams.Beam = { i: 0.8, c: [1, 0, 0], zoom: 12 }
		r.tick()
		assert.equal(r.sent.length, 1)
		const [, lx] = r.sent.shift()
		assert.equal(lx.t, 'lx')
		assert.deepEqual(lx.f, [[1, 0, 0, -1, 1, 0, 0, 0.8, 12]])
		r.tick()
		assert.equal(r.sent.length, 0)
	})

	it('a second socket gets its own lxfull; the deltas go to both; the last detach stops the timer', () => {
		const r = rig()
		r.lx.attach('A')
		r.vis.get('f0').beams.Beam.i = 1
		r.lx.attach('B')
		assert.deepEqual(
			r.sent.map(([w, m]) => [w, m.t]),
			[
				['A', 'lxfull'],
				['B', 'lxfull'],
			]
		)
		assert.equal(r.sent[1][1].f[0][7], 1, 'B starts from the current state')
		r.sent.length = 0
		r.tick()
		assert.deepEqual(
			r.sent.map(([w, m]) => [w, m.t, m.f.length]),
			[
				['A', 'lx', 1],
				['B', 'lx', 1],
			],
			'A still needs that change'
		)
		r.lx.detach('A')
		assert.equal(r.live(), 1)
		r.lx.detach('B')
		assert.equal(r.live(), 0)
	})

	it('host switch: off → lxfull on:false and no timer; on → lxfull to everyone', () => {
		const r = rig()
		r.lx.attach('A')
		r.sent.length = 0
		r.lx.setOn(false)
		assert.equal(r.lx.isOn(), false)
		assert.deepEqual(
			r.sent.map(([, m]) => [m.t, m.on, m.f.length]),
			[['lxfull', false, 0]]
		)
		assert.equal(r.live(), 0)
		r.lx.attach('B')
		assert.equal(r.sent.length, 1, 'switched off: a newcomer gets nothing')
		r.sent.length = 0
		r.lx.setOn(true)
		assert.deepEqual(
			r.sent.map(([w, m]) => [w, m.t, m.on]),
			[
				['A', 'lxfull', true],
				['B', 'lxfull', true],
			]
		)
		assert.equal(r.live(), 1)
		r.lx.stop()
		assert.equal(r.live(), 0)
		assert.equal(r.lx.subscribers(), 0)
	})

	it('a patch change (follow-engine configure() swaps the array) re-sends lxfull with the new list and rev; ≤ 150', () => {
		const r = rig(3)
		r.lx.attach('A')
		const rev0 = r.sent.shift()[1].rev
		r.setFixtures([
			...r.fixtures(),
			{ id: 'f9', name: 'New', enabled: true, typeId: 'aaaaaaaaaaaa', mode: 'M', pose: POSE },
		])
		r.tick()
		const [, full] = r.sent.shift()
		assert.equal(full.t, 'lxfull')
		assert.equal(full.lights.length, 4)
		assert.notEqual(full.rev, rev0)
		assert.equal(full.f.length, 4)
		r.setFixtures([...r.fixtures()]) // same contents, new array: no message
		r.tick()
		assert.equal(r.sent.length, 0)
		const big = rig(MAX_LIGHTS + 20)
		assert.equal(big.lx.list().length, MAX_LIGHTS)
	})

	it('withLiveScene splices lights + screens into the cached scene text', () => {
		const text = JSON.stringify({ rev: 'x', floors: [] })
		const out = JSON.parse(withLiveScene(text, { lights: [{ i: 0 }], screens: [{ id: 's' }] }))
		assert.deepEqual(out, { rev: 'x', floors: [], lights: [{ i: 0 }], screens: [{ id: 's' }] })
		assert.deepEqual(JSON.parse(withLiveScene('{}', {})), { lights: [], screens: [] })
	})
})
