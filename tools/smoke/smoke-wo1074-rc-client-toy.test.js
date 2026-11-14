'use strict'

/**
 * WO-1074 §3 toy scale — RC client (work/notes/rc-game-contract.md §3): the scene's one `scale` (game/rc/scale.js)
 * shrinks every length, speed and acceleration; times, rates and angles stay. Proven by driving the same bot over the
 * same fixture worlds (tools/smoke/lib/rc-client-fixtures.js: the room track with ramp / stage / drop / pad, a flat
 * oval, the server generator's over-and-under bridge and long deck loop) at scale 1 and shrunk:
 *  - × 1/8 (a power of two: every product is exact) → bit-identical drives (positions ÷ scale, events, laps);
 *  - × 0.1 (the live value) → the same checkpoint / lap sequence at the same steps (±2) and positions within 5 mm;
 * plus drift charge, items (pickup / slick / rocket / pulse / use positions), the cameras, wire precision, the
 * standings' teleport guard. Occupancy grids and long tracks: smoke-wo1074-rc-client-occ.test.js.
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const F = require('./lib/rc-client-fixtures.js')

let P, TM, ST, SC, PC, IT, RK, CAM, PR, THREE, PROPS, MESH, CAR

before(async () => {
	P = await F.load('physics.js')
	TM = await F.load('track-math.js')
	ST = await F.load('standings.js')
	SC = await F.load('scale.js')
	PC = await F.load('phys-const.js')
	IT = await F.load('items.js')
	RK = await F.load('rocket.js')
	CAM = await F.load('cameras.js')
	PR = await F.load('protocol.js')
	/* headless three.js: the canvas textures (gem halo, name tags) draw into a no-op 2D context */
	const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 60 }) : k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => ((t[k] = v), true) })
	const doc = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, ownerDocument: doc }) }
	if (!globalThis.document) globalThis.document = doc
	THREE = await import('three')
	PROPS = await F.load('props.js')
	MESH = await F.load('track-mesh.js')
	CAR = await F.load('car-model.js')
})

/** The fixture world × k about the origin: prepared track (scale k) + env. */
function world(raw, floors, obs, k) {
	const T = TM.prepareTrack(k === 1 ? raw : F.scaleTrack(raw, k), k)
	const env = P.createEnv(T, k === 1 ? floors : F.scaleFloors(floors, k), k === 1 ? obs : F.scaleObstacles(obs, k))
	return { T, env }
}

/** Bot drive: checkpoint changes [step, cp], position samples ÷ k every 30 steps, event counts, laps. */
function botDrive(raw, floors, obs, k, sec, laps) {
	const { T, env } = world(raw, floors, obs, k)
	assert.equal(T.scale, k)
	assert.equal(env.s, k)
	const car = P.createCar(TM.gridPose(T, 0))
	const r = new ST.RaceTracker(T)
	r.reset(0)
	r.move('me', car.x, car.z, 0, true, car.y)
	const cps = []
	const samples = []
	const ev = {}
	let done = 0
	let hint = -1
	let off = 0
	for (let i = 0; i < 60 * sec && done < laps; i++) {
		const b = F.botInput(TM, P, T, car, hint)
		hint = b.near.seg
		P.stepCar(car, b.input, env)
		for (const e of car.ev) ev[e.k] = (ev[e.k] || 0) + 1
		car.ev.length = 0
		if (!car.onTrack) off++
		const before = r.cars.get('me').lap.cp
		const e = r.move('me', car.x, car.z, (i * 1000) / 60, false, car.y)
		if (r.cars.get('me').lap.cp !== before) cps.push([i, r.cars.get('me').lap.cp])
		if (e?.type === 'lap') done = e.lap
		if (i % 30 === 0) samples.push([car.x / k, car.y / k, car.z / k, car.yaw])
		assert.ok([car.x, car.y, car.z].every(Number.isFinite))
	}
	return { cps, samples, ev, done, off }
}

const CASES = () => {
	const D = F.deckTracks()
	return [
		['room (ramp, stage, drop, pad)', F.roomTrack(), F.ROOM_FLOORS, [], 60, 2],
		['flat oval', F.ovalTrack(), F.BIG_FLOORS, [], 30, 1],
		['over-and-under bridge', D.over, D.floors, D.obstacles, 90, 2],
		['long deck loop (rails)', D.sky, D.floors, D.obstacles, 90, 2],
	]
}

describe('WO-1074 §3 scale.js — the one place the scene scale becomes numbers', () => {
	it('validScale / sceneScale: missing or malformed → 1, clamped to [0.01, 10]', () => {
		assert.equal(SC.sceneScale({}), 1)
		assert.equal(SC.sceneScale(null), 1)
		assert.equal(SC.sceneScale({ scale: 0.1 }), 0.1)
		for (const bad of [0, -1, 'x', NaN, Infinity, null, '']) assert.equal(SC.validScale(bad), 1, String(bad))
		assert.equal(SC.validScale(0.001), 0.01)
		assert.equal(SC.validScale(50), 10)
	})

	it('physFor: scale 1 is PHYS itself; lengths / speeds / accelerations × s, every other key unchanged', () => {
		assert.equal(SC.physFor(1), PC.PHYS)
		assert.equal(SC.physFor(undefined), PC.PHYS)
		const P1 = PC.PHYS
		const Pt = SC.physFor(0.1)
		assert.ok(Object.isFrozen(Pt))
		assert.equal(SC.physFor(0.1), Pt, 'cached')
		for (const key of Object.keys(P1)) {
			const want = SC.PHYS_LENGTHS.includes(key) ? P1[key] * 0.1 : P1[key]
			assert.equal(Pt[key], want, key)
		}
		for (const key of SC.PHYS_LENGTHS) assert.ok(key in P1, `${key} is a PHYS key`)
		/* the contract's numbers: top 1.3 m/s, cap 2.4 m/s, gravity 2 m/s² */
		assert.ok(Math.abs(Pt.TOP_ON - 1.3) < 1e-9 && Math.abs(Pt.CAP - 2.4) < 1e-9 && Math.abs(Pt.GRAVITY - 2) < 1e-9)
		for (const t of ['DRIFT_T1', 'DRIFT_T2', 'SPIN', 'START_WINDOW', 'STALL']) assert.equal(Pt[t], P1[t], `${t} is a time`)
	})

	it('wire precision: ≥ 3 significant digits at the toy scale (speed 1 cm/s at 1, 1 mm/s at 0.1)', () => {
		assert.equal(SC.wireDecimals(2, 1), 2)
		assert.equal(SC.wireDecimals(2, 0.1), 3)
		assert.equal(SC.wireDecimals(2, 0.05), 4)
		const car = { x: 1.23456, y: 0.0581, z: -2.34567, yaw: 0.5 }
		assert.equal(PR.stateMsg(car, 4.1234, 0, 0).v, 4.12, 'scale 1 unchanged')
		const m = PR.stateMsg(car, 0.41234, 0, 0, 0, 0.1)
		assert.equal(m.v, 0.412)
		assert.deepEqual(m.p, [1.235, 0.058, -2.346], 'positions to 1 mm')
		assert.deepEqual(PR.useMsg('slick', [1.23456, 0, 2], 0).p, [1.235, 0, 2])
		assert.deepEqual(PR.useMsg('slick', [1.23456, 0, 2], 0, 0.1).p, [1.235, 0, 2], '1 mm at 0.1')
		assert.deepEqual(PR.useMsg('slick', [1.23456, 0, 2], 0, 0.01).p, [1.2346, 0, 2], 'finer below 0.1')
	})
})

describe('WO-1074 §3 the same drive, shrunk (real physics + ground + rails + checkpoint logic)', () => {
	it('× 1/8: bit-identical — every position ÷ scale, every event, every checkpoint step', () => {
		for (const [name, raw, floors, obs, sec, laps] of CASES()) {
			const a = botDrive(raw, floors, obs, 1, sec, laps)
			const b = botDrive(raw, floors, obs, 0.125, sec, laps)
			assert.equal(a.done, laps, `${name}: the bot laps at scale 1`)
			assert.deepEqual(b.cps, a.cps, `${name}: checkpoints`)
			assert.deepEqual(b.ev, a.ev, `${name}: events`)
			assert.equal(b.off, a.off, `${name}: off-ribbon steps`)
			assert.deepEqual(b.samples, a.samples, `${name}: positions`)
		}
	})

	it('× 0.1 (live): same laps and checkpoint order at the same steps (±2), positions within 5 mm (0.05 m ÷ 0.1)', () => {
		for (const [name, raw, floors, obs, sec, laps] of CASES()) {
			const a = botDrive(raw, floors, obs, 1, sec, laps)
			const b = botDrive(raw, floors, obs, 0.1, sec, laps)
			assert.equal(b.done, laps, `${name}: laps at 0.1`)
			assert.deepEqual(
				b.cps.map((c) => c[1]),
				a.cps.map((c) => c[1]),
				`${name}: checkpoint order`
			)
			a.cps.forEach((c, i) => assert.ok(Math.abs(b.cps[i][0] - c[0]) <= 2, `${name}: cp ${i} at step ${b.cps[i][0]} vs ${c[0]}`))
			assert.deepEqual(b.ev, a.ev, `${name}: events (land, pad, wall …)`)
			assert.ok(Math.abs(b.off - a.off) <= 3, `${name}: off-ribbon ${b.off} vs ${a.off}`)
			let worst = 0
			const n = Math.min(a.samples.length, b.samples.length)
			assert.ok(Math.abs(a.samples.length - b.samples.length) <= 1)
			for (let i = 0; i < n; i++) worst = Math.max(worst, Math.hypot(...[0, 1, 2].map((j) => a.samples[i][j] - b.samples[i][j])))
			assert.ok(worst < 0.5, `${name}: worst position gap ${worst.toFixed(4)} scale-1 m`)
		}
	})

	it('drift: the same charge, mini-turbo and slide at 0.1 and 1/8 as at scale 1', () => {
		const run = (k) => {
			const { env } = world(F.ovalTrack(), F.BIG_FLOORS, [], k)
			const car = P.createCar({ x: 12 * k, y: 0, z: 0, yaw: 0 })
			const out = { ev: [], maxDriftT: 0, boost: 0, speeds: [] }
			for (let i = 0; i < 60 * 6; i++) {
				const drifting = i > 90 && i < 250
				P.stepCar(car, { throttle: 1, brake: 0, steer: drifting ? 0.8 : 0, drift: drifting }, env)
				for (const e of car.ev) out.ev.push(`${i}:${e.k}`)
				car.ev.length = 0
				out.maxDriftT = Math.max(out.maxDriftT, car.driftT || 0)
				out.boost = Math.max(out.boost, car.boost || 0)
				if (i % 20 === 0) out.speeds.push(P.forwardSpeed(car) / k)
			}
			return out
		}
		const a = run(1)
		assert.ok(a.maxDriftT > PC.PHYS.DRIFT_T1, `the scripted drift charges (${a.maxDriftT})`)
		assert.deepEqual(run(0.125), a, 'bit-identical at 1/8')
		const b = run(0.1)
		assert.deepEqual(b.ev, a.ev, 'drift events at the same steps')
		assert.ok(Math.abs(b.maxDriftT - a.maxDriftT) < 1e-9 && Math.abs(b.boost - a.boost) < 1e-9)
		b.speeds.forEach((v, i) => assert.ok(Math.abs(v - a.speeds[i]) < 1e-6, `speed ${i}: ${v} vs ${a.speeds[i]}`))
	})
})

describe('WO-1074 §3 items, cameras, standings at toy scale', () => {
	const toyOval = (k) => TM.prepareTrack(F.scaleTrack({ ...F.ovalTrack(), boxes: [{ id: 0, x: 12, y: 0.5, z: 0 }] }, k), k)

	it('box pickup reach, slick / rocket hit radii, pulse radius and use positions × scale', () => {
		for (const k of [1, 0.1]) {
			const T = toyOval(k)
			const at = (dx) => ({ x: (12 + dx) * k, y: 0, z: 0, yaw: 0, grounded: true, spin: 0, immune: 0 })
			assert.ok(new IT.ItemState().pickup(T, at(1.0), 0), `${k}: in reach at 1.0 · s`)
			assert.equal(new IT.ItemState().pickup(T, at(1.2), 0), null, `${k}: out of reach at 1.2 · s`)
			const it = new IT.ItemState()
			it.addHaz({ hid: 1, kind: 'slick', by: 9, p: [12 * k, 0, 0.9 * k], yaw: 0, ts: 0, until: null })
			assert.equal(it.hazardHit(T, at(0), 1, 5000), 1, `${k}: slick hit inside SLICK_R · s`)
			const far = new IT.ItemState()
			far.addHaz({ hid: 1, kind: 'slick', by: 9, p: [12 * k, 0, 1.1 * k], yaw: 0, ts: 0, until: null })
			assert.equal(far.hazardHit(T, at(0), 1, 5000), null, `${k}: no hit outside`)
			const fx = { id: 9, p: [12 * k, 0, 6.9 * k] }
			assert.equal(it.pulseHits(fx, at(0), 1, k), true)
			assert.equal(it.pulseHits({ id: 9, p: [12 * k, 0, 7.1 * k] }, at(0), 1, k), false)
			it.held = 'slick'
			const u = it.use({ x: 0, y: 0, z: 0, yaw: 0 }, k)
			assert.ok(Math.abs(u.msg.p[2] - IT.SLICK_BACK * k) < 1e-3, `${k}: slick dropped ${IT.SLICK_BACK} · s behind`)
			it.held = 'rocket'
			assert.ok(Math.abs(it.use({ x: 0, y: 0, z: 0, yaw: 0 }, k).msg.p[2] + IT.ROCKET_AHEAD * k) < 1e-3)
		}
	})

	it('rocket: the scale-1 flight × 1/8 exactly (speed, hover, lateral blend)', () => {
		const h = (k) => ({ hid: 2, kind: 'rocket', by: 1, p: [12 * k, 0.1 * k, 0.4 * k], yaw: Math.PI, ts: 0, until: null })
		for (const ms of [0, 200, 700, 2000, 4900]) {
			const a = RK.rocketPose(toyOval(1), h(1), ms)
			const b = RK.rocketPose(toyOval(0.125), h(0.125), ms)
			assert.deepEqual([b.x * 8, b.y * 8, b.z * 8, b.yaw], [a.x, a.y, a.z, a.yaw], `${ms} ms`)
		}
	})

	it('chase / top / fov / director framing × scale; the overview stays room-sized', () => {
		const car = { x: 1, y: 0.5, z: -2, yaw: 0.7 }
		const k = 0.125
		const small = { x: car.x * k, y: car.y * k, z: car.z * k, yaw: car.yaw }
		for (const v of [0, 5, 13, 20]) {
			const a = CAM.chaseTarget(car, v)
			const b = CAM.chaseTarget(small, v * k, null, k)
			assert.deepEqual(
				[...b.eye, ...b.target].map((q) => q / k),
				[...a.eye, ...a.target],
				`chase at ${v}`
			)
			assert.equal(CAM.fovFor(v * k, false, k), CAM.fovFor(v, false))
		}
		assert.deepEqual(CAM.topTarget(small, 7 * k, k).eye.map((q) => q / k), CAM.topTarget(car, 7).eye)
		const ceil = () => car.y * k + 0.8 * k
		const under = CAM.chaseTarget(small, 0, ceil, k)
		assert.ok(Math.abs(under.eye[1] - (car.y * k + 0.8 * k - CAM.CEIL_GAP * k)) < 1e-12, 'under a deck: CEIL_GAP · s below it')
		const T1 = TM.prepareTrack(F.ovalTrack())
		const Tk = toyOval(0.1)
		const o1 = CAM.overviewTarget(T1)
		const ok = CAM.overviewTarget(Tk)
		assert.ok(ok.eye[1] - ok.target[1] >= 6 * 0.6 - 1e-9, 'a toy track still gets a room-sized overview (≥ 3.6 m up)')
		assert.ok(o1.eye[1] > ok.eye[1])
		const D = new CAM.Director(3)
		const pose = { x: 12 * 0.1, y: 0, z: 0, yaw: 0, v: 1.2 }
		D.shot = 'car'
		D.carId = 'a'
		D.until = 99
		const shot = D.update(1, 1 / 60, Tk, ['a'], () => pose)
		assert.ok(Math.hypot(shot.eye[0] - pose.x, shot.eye[2] - pose.z) < 0.4, 'the director frames the toy from toy distance')
	})

	it('standings: a gate crossed in a 0.5 m hop counts at scale 1 but is a teleport at 0.1 (MAX_STEP_M × scale)', () => {
		const cross = (T, half) => {
			const r = new ST.RaceTracker(T)
			r.reset(0)
			const s1 = T.cumS[T.checkpoints[1]]
			const a = TM.pointAt(T, s1 - half)
			const b = TM.pointAt(T, s1 + half)
			r.move('a', a.x, a.z, 0, true, 0)
			r.move('a', b.x, b.z, 100, false, 0)
			return r.cars.get('a').lap.cp
		}
		assert.equal(cross(toyOval(1), 0.25), 1, 'scale 1: a 0.5 m step crosses the gate')
		assert.equal(cross(toyOval(0.1), 0.1), 1, 'scale 0.1: a 0.2 m step crosses the gate')
		assert.equal(cross(toyOval(0.1), 0.25), 0, 'scale 0.1: a 0.5 m hop is a teleport')
	})
})

describe('WO-1074 §3 the drawn world × scale (headless three.js)', () => {
	/** World bounding box of a built object → [min xyz, max xyz]. */
	const bbox = (o) => {
		o.updateMatrixWorld(true)
		const b = new THREE.Box3().setFromObject(o)
		return [...b.min.toArray(), ...b.max.toArray()]
	}
	const near = (a, b, what) =>
		a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= 1e-6 * Math.max(1, Math.abs(b[i])), `${what}[${i}]: ${v} vs ${b[i]}`))

	it('track mesh, pads + item gems (fully shown) and the buggy at 1/8 are the scale-1 build × 1/8', () => {
		const raw = { ...F.roomTrack(), boxes: [{ id: 0, x: 12, z: 0 }] }
		const build = (k) => {
			const { T, env } = world(raw, F.ROOM_FLOORS, [], k)
			const props = PROPS.createProps(T)
			for (let i = 0; i < 60; i++) props.update(1, () => false, 1 / 30)
			const gem = props.group.children.find((c) => c.isGroup)
			const out = { mesh: bbox(MESH.buildTrackMesh(T, env.ground)), props: bbox(props.group), gem: gem.scale.x, car: bbox(CAR.createCarModel({ scale: k }).group) }
			props.dispose()
			return out
		}
		const one = build(1)
		const toy = build(1 / 8)
		assert.equal(one.gem, 1, 'scale 1: the gem holder at full size once shown')
		assert.equal(toy.gem, 1 / 8, 'toy: the gem holder × scale (its core, halo and bob with it)')
		for (const key of ['mesh', 'props', 'car']) near(toy[key], one[key].map((v) => v / 8), key)
	})
})
