'use strict'

/**
 * WO-1074 — RC car game, browser client: the pure modules (game/rc/physics.js, track-math.js, lap-logic.js).
 * Contract: work/notes/rc-game-contract.md (top ≈ 9 m/s on track, ≈ 4 off, never above 12; obstacles and the floor
 * edges stop the car; checkpoints in order; driving backwards over the line never counts).
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const RC = path.join(__dirname, '..', '..', 'game', 'rc')
const load = (f) => import(pathToFileURL(path.join(RC, f)).href)

let P, TM, L

before(async () => {
	P = await load('physics.js')
	TM = await load('track-math.js')
	L = await load('lap-logic.js')
})

/** Oval (ellipse) driven in point order. */
function ovalTrack(a = 8, b = 5, n = 120) {
	const points = []
	for (let i = 0; i < n; i++) {
		const t = (i / n) * Math.PI * 2
		points.push([a * Math.cos(t), b * Math.sin(t)])
	}
	return { id: 'oval', name: 'Oval', floor: 'stage', y: 1.42, width: 2.2, closed: true, points, checkpoints: [0, 30, 60, 90], grid: [] }
}

/** Figure-eight (lemniscate of Gerono) — the centre line crosses itself at the origin at points 40 and 120. */
function eightTrack(a = 8, n = 160) {
	const points = []
	for (let i = 0; i < n; i++) {
		const t = (i / n) * Math.PI * 2
		points.push([a * Math.cos(t), a * Math.sin(t) * Math.cos(t)])
	}
	return { id: 'eight', name: 'Eight', floor: 'stage', y: 0, width: 2, closed: true, points, checkpoints: [0, 40, 80, 120], grid: [] }
}

/** A long straight (open) strip heading −Z from the origin. */
function straightTrack(len = 200, width = 4) {
	const points = []
	for (let z = 0; z >= -len; z -= 1) points.push([0, z])
	return { id: 'straight', floor: 'hall', y: 0, width, closed: false, points, checkpoints: [0], grid: [] }
}

const BIG_RECT = [-500, -500, 500, 500]

function drive(car, env, input, seconds, others = []) {
	const steps = Math.round(seconds * 60)
	for (let i = 0; i < steps; i++) P.stepCar(car, input, env, others)
	return car
}

describe('WO-1074 physics', () => {
	it('accelerates to the on-track top speed (≈ 9 m/s) and no further', () => {
		const T = TM.prepareTrack(straightTrack())
		const env = P.createEnv(T, BIG_RECT, [])
		const car = P.createCar({ x: 0, z: 0, yaw: 0 }, 0)
		drive(car, env, { throttle: 1 }, 0.3)
		const early = P.forwardSpeed(car)
		assert.ok(early > 2 && early < 9, `still accelerating after 0.3 s: ${early}`)
		drive(car, env, { throttle: 1 }, 3)
		const v = P.forwardSpeed(car)
		assert.ok(v > 8.9 && v <= 9 + 1e-9, `top on track ≈ 9, got ${v}`)
		assert.ok(car.onTrack)
		assert.ok(car.z < -10, 'moved along −Z (yaw 0 faces −Z)')
		assert.ok(Math.abs(car.x) < 1e-6, 'straight line without steering')
	})

	it('is slower off the track surface (≈ 4 m/s) and slows down when leaving the track at speed', () => {
		const T = TM.prepareTrack(straightTrack())
		const env = P.createEnv(T, BIG_RECT, [])
		const off = P.createCar({ x: 10, z: 0, yaw: 0 }, 0)
		drive(off, env, { throttle: 1 }, 3)
		assert.equal(off.onTrack, false)
		const v = P.forwardSpeed(off)
		assert.ok(v > 3.9 && v <= 4 + 1e-9, `off-track top ≈ 4, got ${v}`)

		const fast = P.createCar({ x: 0, z: 0, yaw: 0 }, 0)
		drive(fast, env, { throttle: 1 }, 2)
		fast.x = 10 // now off the asphalt at ~9 m/s
		drive(fast, env, { throttle: 1 }, 0.25)
		const v2 = P.forwardSpeed(fast)
		assert.ok(v2 < 8 && v2 > 4, `decelerating towards 4 off track, got ${v2}`)
		drive(fast, env, { throttle: 1 }, 2)
		assert.ok(P.forwardSpeed(fast) <= 4 + 1e-9)
	})

	it('never exceeds the 12 m/s hard cap, whatever happens', () => {
		const T = TM.prepareTrack(ovalTrack())
		const env = P.createEnv(T, [-12, -9, 12, 9], [{ min: [-1, 0, -1], max: [1, 1, 1] }])
		const car = P.createCar({ x: 8, z: 0, yaw: 0 }, T.y)
		car.vx = 40
		car.vz = -30
		P.stepCar(car, { throttle: 1 }, env)
		assert.ok(Math.hypot(car.vx, car.vz) <= 12 + 1e-9)
		let seed = 12345
		const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
		const others = [{ x: 7.8, z: 0.2 }]
		for (let i = 0; i < 4000; i++) {
			const input = { throttle: rnd() > 0.3 ? 1 : 0, brake: rnd() > 0.8 ? 1 : 0, steer: rnd() * 2 - 1, hand: rnd() > 0.9 }
			P.stepCar(car, input, env, others)
			assert.ok(Math.hypot(car.vx, car.vz) <= 12 + 1e-9, `step ${i}`)
			assert.ok(Number.isFinite(car.x) && Number.isFinite(car.z) && Number.isFinite(car.yaw))
			assert.equal(car.y, T.y, 'stays on the track floor plane')
		}
	})

	it('reverses slowly and brakes before reversing', () => {
		const T = TM.prepareTrack(straightTrack())
		const env = P.createEnv(T, BIG_RECT, [])
		const car = P.createCar({ x: 0, z: -100, yaw: 0 }, 0)
		drive(car, env, { throttle: 1 }, 1)
		drive(car, env, { brake: 1 }, 0.1)
		assert.ok(P.forwardSpeed(car) > 0, 'brake first')
		drive(car, env, { brake: 1 }, 3)
		const v = P.forwardSpeed(car)
		assert.ok(v < -2.5 && v >= -3 - 1e-9, `reverse top 3, got ${v}`)
	})

	it('stops at an obstacle (car-height AABB) and slides along it; ignores boxes above car height', () => {
		const T = TM.prepareTrack(straightTrack())
		const wall = { min: [-2, 0, -21], max: [2, 1, -20] }
		const env = P.createEnv(T, BIG_RECT, [wall])
		const car = P.createCar({ x: 0, z: 0, yaw: 0 }, 0)
		let minZ = Infinity
		for (let i = 0; i < 6 * 60; i++) {
			P.stepCar(car, { throttle: 1 }, env)
			minZ = Math.min(minZ, car.z)
		}
		assert.ok(minZ >= -20 + P.PHYS.RADIUS - 1e-9, `never inside the box (min z ${minZ})`)
		assert.ok(Math.abs(P.forwardSpeed(car)) < 0.6, `stopped at the wall, v=${P.forwardSpeed(car)}`)

		/* angled approach: slides sideways along the wall instead of sticking */
		const wide = P.createEnv(T, BIG_RECT, [{ min: [-40, 0, -21], max: [40, 1, -20] }])
		const car2 = P.createCar({ x: 0, z: -15, yaw: 0.6 }, 0)
		const x0 = car2.x
		drive(car2, wide, { throttle: 1 }, 2)
		assert.ok(car2.z >= -20 + P.PHYS.RADIUS - 1e-9)
		assert.ok(car2.x < x0 - 1, 'slid along the wall towards −X')

		const high = P.createEnv(T, BIG_RECT, [{ min: [-2, 1.0, -21], max: [2, 3, -20] }])
		const car3 = P.createCar({ x: 0, z: 0, yaw: 0 }, 0)
		drive(car3, high, { throttle: 1 }, 4)
		assert.ok(car3.z < -25, 'a box above 0.6 m is driven under')
	})

	it('cannot leave the floor rect', () => {
		const T = TM.prepareTrack(ovalTrack())
		const rect = [-10, -7, 10, 7]
		const env = P.createEnv(T, rect, [])
		for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7, 2.4]) {
			const car = P.createCar({ x: 0, z: 0, yaw }, T.y)
			for (let i = 0; i < 5 * 60; i++) {
				P.stepCar(car, { throttle: 1, steer: 0.05 }, env)
				assert.ok(car.x >= rect[0] + P.PHYS.RADIUS - 1e-9 && car.x <= rect[2] - P.PHYS.RADIUS + 1e-9, `x ${car.x}`)
				assert.ok(car.z >= rect[1] + P.PHYS.RADIUS - 1e-9 && car.z <= rect[3] - P.PHYS.RADIUS + 1e-9, `z ${car.z}`)
			}
		}
	})

	it('steering sign: positive steer = LEFT (yaw increases, heading −Z turns towards −X)', () => {
		const T = TM.prepareTrack(straightTrack(200, 400))
		const env = P.createEnv(T, BIG_RECT, [])
		const car = P.createCar({ x: 0, z: 0, yaw: 0 }, 0)
		drive(car, env, { throttle: 1 }, 0.5)
		drive(car, env, { throttle: 1, steer: 1 }, 0.4)
		assert.ok(car.yaw > 0.3, `yaw grew: ${car.yaw}`)
		assert.ok(car.x < -0.2, `moved left (−X): ${car.x}`)
		assert.ok(car.st > 0.9)
		const right = P.createCar({ x: 0, z: 0, yaw: 0 }, 0)
		drive(right, env, { throttle: 1 }, 0.5)
		drive(right, env, { throttle: 1, steer: -1 }, 0.4)
		assert.ok(right.yaw < -0.3 && right.x > 0.2)
		/* speed-dependent: less steering angle at speed */
		assert.ok(P.maxSteerAngle(9) < P.maxSteerAngle(1) / 2)
	})

	it('handbrake at speed lets the car slide (sideways velocity survives longer)', () => {
		const T = TM.prepareTrack(straightTrack(200, 400))
		const env = P.createEnv(T, BIG_RECT, [])
		const slip = (hand) => {
			const car = P.createCar({ x: 0, z: 0, yaw: 0 }, 0)
			drive(car, env, { throttle: 1 }, 1)
			drive(car, env, { throttle: 1, steer: 1, hand }, 0.3)
			const [rx, rz] = P.rightOf(car.yaw)
			return Math.abs(car.vx * rx + car.vz * rz)
		}
		assert.ok(slip(true) > slip(false) * 1.5, `drift ${slip(true)} vs grip ${slip(false)}`)
	})

	it('soft push from another car', () => {
		const T = TM.prepareTrack(straightTrack())
		const env = P.createEnv(T, BIG_RECT, [])
		const car = P.createCar({ x: 0, z: 0, yaw: 0 }, 0)
		const other = { x: 0.1, z: -0.1 }
		for (let i = 0; i < 30; i++) P.stepCar(car, {}, env, [other])
		assert.ok(Math.hypot(car.x - other.x, car.z - other.z) > 0.4, 'pushed apart')
	})

	it('is deterministic: the same inputs give bit-identical states', () => {
		const run = () => {
			const T = TM.prepareTrack(ovalTrack())
			const env = P.createEnv(T, [-12, -9, 12, 9], [{ min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }])
			const car = P.createCar(TM.gridPose(T, 3), T.y)
			const trace = []
			for (let i = 0; i < 1200; i++) {
				const input = { throttle: i % 300 < 250 ? 1 : 0, brake: i % 300 >= 280 ? 1 : 0, steer: Math.sin(i / 37), hand: i % 200 > 190 }
				P.stepCar(car, input, env, [{ x: 7, z: 1 }])
				if (i % 100 === 0) trace.push({ ...car })
			}
			return trace
		}
		assert.deepEqual(run(), run())
	})

	it('fixed 60 Hz stepper with accumulator', () => {
		const s = P.createStepper()
		let n = 0
		const a = s.advance(0.1, () => n++)
		assert.equal(n, 6)
		assert.ok(a >= 0 && a < 1)
		n = 0
		s.advance(1 / 120, () => n++)
		s.advance(1 / 120, () => n++)
		assert.ok(n >= 1 && n <= 2)
		n = 0
		s.advance(5, () => n++) // tab was in the background: capped, no spiral
		assert.ok(n <= 8)
	})
})

describe('WO-1074 track maths', () => {
	it('prepares an oval: length, tangents, nearest point and on-track test', () => {
		const T = TM.prepareTrack(ovalTrack())
		const a = 8
		const b = 5
		const ramanujan = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))
		assert.ok(Math.abs(T.total - ramanujan) / ramanujan < 0.01, `${T.total} vs ${ramanujan}`)
		const on = TM.nearestOnTrack(T, 8, 0)
		assert.ok(on.dist < 1e-6 && on.s < 1e-6)
		assert.ok(TM.isOnTrack(T, 9, 0), '1 m off the centre is on a 2.2 m track')
		assert.ok(!TM.isOnTrack(T, 9.3, 0))
		assert.ok(!TM.isOnTrack(T, 0, 0), 'the infield is not track')
		/* hinted (windowed) search agrees near the hint */
		const p = TM.pointAt(T, 10)
		assert.equal(TM.nearestOnTrack(T, p.x, p.z, p.seg).seg, TM.nearestOnTrack(T, p.x, p.z).seg)
	})

	it('yaw convention: yaw 0 faces −Z; yawFromDir inverts forward', () => {
		for (const [ux, uz] of [
			[0, -1],
			[1, 0],
			[-0.6, 0.8],
		]) {
			const yaw = TM.yawFromDir(ux, uz)
			assert.ok(Math.abs(-Math.sin(yaw) - ux) < 1e-9 && Math.abs(-Math.cos(yaw) - uz) < 1e-9)
		}
		assert.equal(TM.yawFromDir(0, -1), -0)
	})

	it('respawn pose sits on a checkpoint and faces along the track; grid falls back behind the line', () => {
		const T = TM.prepareTrack(ovalTrack())
		for (let k = 0; k < 4; k++) {
			const r = TM.respawnPose(T, k)
			const g = TM.gateOf(T, k)
			assert.ok(Math.hypot(r.x - g.x, r.z - g.z) < 1e-9)
			const f = [-Math.sin(r.yaw), -Math.cos(r.yaw)]
			assert.ok(f[0] * g.tx + f[1] * g.tz > 0.99)
		}
		const slot = TM.gridPose(T, 0)
		const n = TM.nearestOnTrack(T, slot.x, slot.z)
		assert.ok(n.dist <= T.half, 'grid slot on the asphalt')
		assert.ok(TM.progressOf(T, 0, 0, n.s) < 0, 'grid slot is behind the start line')
		const withGrid = TM.prepareTrack({ ...ovalTrack(), grid: [{ x: 1, z: 2, yaw: 0.5 }] })
		assert.deepEqual(TM.gridPose(withGrid, 0), { x: 1, z: 2, yaw: 0.5 })
	})

	it('gate crossing: forward, backwards, beside the gate', () => {
		const T = TM.prepareTrack(ovalTrack())
		const g = TM.gateOf(T, 1) // top of the oval, direction −X
		assert.equal(TM.gateCrossing(T, 1, g.x - g.tx * 0.2, g.z - g.tz * 0.2, g.x + g.tx * 0.2, g.z + g.tz * 0.2), 1)
		assert.equal(TM.gateCrossing(T, 1, g.x + g.tx * 0.2, g.z + g.tz * 0.2, g.x - g.tx * 0.2, g.z - g.tz * 0.2), -1)
		const far = g.halfLen + 0.5
		assert.equal(TM.gateCrossing(T, 1, g.x - g.tx * 0.2 + g.tz * far, g.z - g.tz * 0.2 - g.tx * far, g.x + g.tx * 0.2 + g.tz * far, g.z + g.tz * 0.2 - g.tx * far), 0)
		assert.equal(TM.gateCrossing(T, 1, g.x + 1, g.z, g.x + 1, g.z), 0)
	})

	it('figure-eight: both branches cross at the origin; the other branch does not trigger a gate there', () => {
		const T = TM.prepareTrack(eightTrack())
		assert.ok(Math.hypot(...T.pts[40]) < 1e-9 && Math.hypot(...T.pts[120]) < 1e-9)
		/* moving along branch 120 through the gate of checkpoint 1 (which sits at point 40) */
		const t120 = T.tangents[120]
		assert.equal(TM.gateCrossing(T, 1, -t120[0] * 0.2, -t120[1] * 0.2, t120[0] * 0.2, t120[1] * 0.2), 0)
		const t40 = T.tangents[40]
		assert.equal(TM.gateCrossing(T, 1, -t40[0] * 0.2, -t40[1] * 0.2, t40[0] * 0.2, t40[1] * 0.2), 1)
	})
})

/** Drive the centre line from s0 to s1 in small steps, feeding lapStep. */
function driveLine(T, st, s0, s1, ds = 0.1, t0 = 0) {
	const evs = []
	let p = TM.pointAt(T, s0)
	const dir = Math.sign(s1 - s0)
	let t = t0
	for (let s = s0 + ds * dir; dir > 0 ? s <= s1 : s >= s1; s += ds * dir) {
		const q = TM.pointAt(T, s)
		t += 100
		const ev = L.lapStep(T, st, p.x, p.z, q.x, q.z, t)
		if (ev) evs.push(ev)
		p = q
	}
	return evs
}

describe('WO-1074 lap logic', () => {
	it('counts checkpoints in order and laps on the oval (start behind the line)', () => {
		const T = TM.prepareTrack(ovalTrack())
		const st = L.createLapState(0)
		const evs = driveLine(T, st, -1, 2 * T.total + 1)
		assert.deepEqual(
			evs.map((e) => (e.type === 'cp' ? `cp${e.cp}` : `lap${e.lap}`)),
			['cp1', 'cp2', 'cp3', 'lap1', 'cp1', 'cp2', 'cp3', 'lap2']
		)
		assert.equal(st.lap, 2)
		assert.equal(st.cp, 0)
		assert.equal(st.times.length, 2)
		assert.ok(st.bestMs > 0)
	})

	it('figure-eight: a full lap gives cp1..cp3 then the lap, crossing the middle twice', () => {
		const T = TM.prepareTrack(eightTrack())
		const st = L.createLapState(0)
		const evs = driveLine(T, st, -0.5, T.total + 0.5)
		assert.deepEqual(
			evs.map((e) => (e.type === 'cp' ? `cp${e.cp}` : `lap${e.lap}`)),
			['cp1', 'cp2', 'cp3', 'lap1']
		)
	})

	it('figure-eight: crossing the middle on the other branch does not count a checkpoint out of order', () => {
		const T = TM.prepareTrack(eightTrack())
		const st = L.createLapState(0)
		/* jump straight onto branch 120 (skipping cp1, cp2) and drive through the crossing */
		const s120 = T.cumS[120]
		const evs = driveLine(T, st, s120 - 2, s120 + 2)
		assert.deepEqual(evs, [])
		assert.equal(st.cp, 0)
		/* skipping ahead and crossing the finish does not give a lap either */
		const evs2 = driveLine(T, st, T.total - 2, T.total + 2)
		assert.deepEqual(evs2, [])
		assert.equal(st.lap, 0)
	})

	it('driving backwards over the line never counts; neither does wiggling across it', () => {
		const T = TM.prepareTrack(ovalTrack())
		const st = L.createLapState(0)
		const back = driveLine(T, st, 2, -2 * T.total - 2)
		assert.deepEqual(back, [], 'two full laps backwards: nothing')
		assert.equal(st.lap, 0)
		const st2 = L.createLapState(0)
		for (let i = 0; i < 5; i++) {
			driveLine(T, st2, -0.5, 0.5)
			driveLine(T, st2, 0.5, -0.5)
		}
		assert.equal(st2.lap, 0)
		assert.equal(st2.cp, 0)
		/* a lap that turns back after cp3 and re-crosses forward still needs every checkpoint again afterwards */
		const st3 = L.createLapState(0)
		driveLine(T, st3, -0.5, T.total + 0.5)
		assert.equal(st3.lap, 1)
		driveLine(T, st3, T.total + 0.5, T.total - 0.5)
		driveLine(T, st3, T.total - 0.5, T.total + 0.5)
		assert.equal(st3.lap, 1, 'back and forth over the line right after a lap: still lap 1')
	})

	it('cutting across the infield skips a checkpoint → no lap', () => {
		const T = TM.prepareTrack(ovalTrack())
		const st = L.createLapState(0)
		driveLine(T, st, -0.5, T.cpS[1] + 0.5)
		assert.equal(st.cp, 1)
		/* straight across the oval to just before cp3, then on to the line */
		const a = TM.pointAt(T, T.cpS[1] + 0.5)
		const b = TM.pointAt(T, T.cpS[3] - 0.5)
		for (let k = 1; k <= 50; k++) {
			const x0 = a.x + ((b.x - a.x) * (k - 1)) / 50
			const z0 = a.z + ((b.z - a.z) * (k - 1)) / 50
			L.lapStep(T, st, x0, z0, a.x + ((b.x - a.x) * k) / 50, a.z + ((b.z - a.z) * k) / 50, k)
		}
		driveLine(T, st, T.cpS[3] - 0.5, T.total + 0.5)
		assert.equal(st.lap, 0)
		assert.equal(st.cp, 1)
	})

	it('formats times', () => {
		assert.equal(L.fmtTime(23456), '23.4')
		assert.equal(L.fmtTime(71234), '1:11.2')
		assert.equal(L.fmtTime(null), '–')
	})
})
