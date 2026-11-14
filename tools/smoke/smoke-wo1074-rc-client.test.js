'use strict'

/**
 * WO-1074 — RC car game, browser client: the pure modules (modules/rc-game/client/physics.js, drive-rules.js, track-math.js,
 * lap-logic.js). Contract v2 §2.2 (work/notes/rc-game-contract.md): 13 m/s on the ribbon, 7 off it, 18 boosting, hard
 * cap 24, 0 → top ≈ 1.6 s; drift hop + two charge stages (0.7 s / 1.6 s) → mini-boost 0.6 s / 1.3 s; pads 1.0 s; start
 * boost within the last 0.35 s, earlier = 1 s stall; spin-out 1.2 s, speed × 0.3, then 2 s immunity; catch-up 0…8 %
 * by position, never for the leader; walls / obstacles bounce. Ground model + 3D in smoke-wo1074-rc-client-ground.
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const F = require('./lib/rc-client-fixtures.js')

let P, TM, L, R

before(async () => {
	P = await F.load('physics.js')
	TM = await F.load('track-math.js')
	L = await F.load('lap-logic.js')
	R = await F.load('drive-rules.js')
})

function drive(car, env, input, seconds, others = []) {
	const steps = Math.round(seconds * 60)
	for (let i = 0; i < steps; i++) P.stepCar(car, input, env, others)
	return car
}

function straightEnv(width = 4) {
	const T = TM.prepareTrack(F.straightTrack(300, width))
	return { T, env: P.createEnv(T, F.BIG_FLOORS, []) }
}

/** Seconds of full throttle until forward speed ≥ v. */
function timeTo(env, v, start = { x: 0, z: 0, yaw: 0 }) {
	const car = P.createCar(start, 0)
	for (let i = 1; i < 600; i++) {
		P.stepCar(car, { throttle: 1 }, env)
		if (P.forwardSpeed(car) >= v) return i / 60
	}
	return Infinity
}

describe('WO-1074 v2 physics: speeds', () => {
	it('on the ribbon: top 13 m/s, 0 → 95 % in ≈ 1.6 s, straight along −Z', () => {
		const { env } = straightEnv()
		const t95 = timeTo(env, 13 * 0.95)
		assert.ok(t95 > 1.0 && t95 < 1.8, `0 → 12.35 m/s in ${t95} s`)
		const car = drive(P.createCar({ x: 0, z: 0, yaw: 0 }, 0), env, { throttle: 1 }, 4)
		const v = P.forwardSpeed(car)
		assert.ok(v > 12.9 && v <= 13 + 1e-9, `top on the ribbon ≈ 13, got ${v}`)
		assert.ok(car.onTrack && car.z < -20 && Math.abs(car.x) < 1e-6)
	})

	it('off the ribbon: top 7 m/s; leaving the ribbon at speed slows down towards 7', () => {
		const { env } = straightEnv()
		const off = drive(P.createCar({ x: 10, z: 0, yaw: 0 }, 0), env, { throttle: 1 }, 3)
		assert.equal(off.onTrack, false)
		const v = P.forwardSpeed(off)
		assert.ok(v > 6.9 && v <= 7 + 1e-9, `off top ≈ 7, got ${v}`)
		const fast = drive(P.createCar({ x: 0, z: 0, yaw: 0 }, 0), env, { throttle: 1 }, 3)
		fast.x = 10
		drive(fast, env, { throttle: 1 }, 0.2)
		const v2 = P.forwardSpeed(fast)
		assert.ok(v2 < 12 && v2 > 7, `decelerating towards 7, got ${v2}`)
		drive(fast, env, { throttle: 1 }, 2)
		assert.ok(P.forwardSpeed(fast) <= 7 + 1e-9)
	})

	it('boosting: 18 m/s anywhere; drops back to 13 after the boost', () => {
		const { env } = straightEnv()
		const car = drive(P.createCar({ x: 0, z: 0, yaw: 0 }, 0), env, { throttle: 1 }, 3)
		for (let i = 0; i < 4 * 60; i++) {
			R.giveBoost(car, 0.5)
			P.stepCar(car, { throttle: 1 }, env)
		}
		const v = P.forwardSpeed(car)
		assert.ok(v > 17.9 && v <= 18 + 1e-9, `boost top ≈ 18, got ${v}`)
		drive(car, env, { throttle: 1 }, 2)
		assert.ok(Math.abs(P.forwardSpeed(car) - 13) < 0.05, 'back to 13')
		const off = P.createCar({ x: 20, z: 0, yaw: 0 }, 0)
		for (let i = 0; i < 3 * 60; i++) {
			R.giveBoost(off, 0.5)
			P.stepCar(off, {}, env)
		}
		assert.ok(P.forwardSpeed(off) > 17.9, 'a boost pushes without throttle, off the ribbon too')
	})

	it('catch-up adds up to 8 % to the top speed; never for the leader', () => {
		assert.equal(R.catchupFor(1, 8), 0, 'leader')
		assert.equal(R.catchupFor(1, 1), 0, 'alone')
		assert.equal(R.catchupFor(0, 5), 0, 'unknown position')
		assert.ok(Math.abs(R.catchupFor(8, 8) - 0.08) < 1e-12, 'last')
		assert.ok(Math.abs(R.catchupFor(2, 2) - 0.08) < 1e-12)
		assert.ok(R.catchupFor(3, 8) > 0 && R.catchupFor(3, 8) < R.catchupFor(6, 8))
		const { env } = straightEnv()
		const car = P.createCar({ x: 0, z: 0, yaw: 0 }, 0)
		car.catchup = R.catchupFor(8, 8)
		drive(car, env, { throttle: 1 }, 4)
		const v = P.forwardSpeed(car)
		assert.ok(v > 13.9 && v <= 13 * 1.08 + 1e-9, `last place top ≈ 14.04, got ${v}`)
	})

	it('never exceeds the 24 m/s hard cap, never NaN, whatever happens', () => {
		const T = TM.prepareTrack(F.ovalTrack())
		const env = P.createEnv(T, [{ id: 'hall', y: 0, rect: [-16, -11, 16, 11] }], [{ min: [-1, 0, -1], max: [1, 1, 1] }])
		const car = P.createCar({ x: 12, y: 0, z: 0, yaw: 0 })
		car.vx = 60
		car.vz = -45
		P.stepCar(car, { throttle: 1 }, env)
		assert.ok(Math.hypot(car.vx, car.vz) <= 24 + 1e-9)
		let seed = 12345
		const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
		const others = [{ x: 11.8, y: 0, z: 0.2 }]
		for (let i = 0; i < 5000; i++) {
			if (i % 400 === 0) R.giveBoost(car, 2)
			if (i % 700 === 0) R.spinOut(car)
			const input = { throttle: rnd() > 0.3 ? 1 : 0, brake: rnd() > 0.8 ? 1 : 0, steer: rnd() * 2 - 1, drift: rnd() > 0.7 }
			P.stepCar(car, input, env, others)
			car.ev.length = 0
			assert.ok(Math.hypot(car.vx, car.vz) <= 24 + 1e-9, `step ${i}`)
			assert.ok([car.x, car.y, car.z, car.yaw, car.vx, car.vy, car.vz].every(Number.isFinite))
			assert.ok(car.y >= -1e-9 && car.y < 3, `y ${car.y}`)
		}
	})

	it('reverses (≤ 5 m/s) and brakes before reversing', () => {
		const { env } = straightEnv()
		const car = drive(P.createCar({ x: 0, z: -100, yaw: 0 }, 0), env, { throttle: 1 }, 1)
		drive(car, env, { brake: 1 }, 0.1)
		assert.ok(P.forwardSpeed(car) > 0, 'brake first')
		drive(car, env, { brake: 1 }, 3)
		const v = P.forwardSpeed(car)
		assert.ok(v < -4.5 && v >= -5 - 1e-9, `reverse top 5, got ${v}`)
	})

	it('steering sign: positive steer = LEFT; wide lock at speed (turn radius ≈ 4 m at 13 m/s)', () => {
		const { env } = straightEnv(400)
		const car = drive(P.createCar({ x: 0, z: 0, yaw: 0 }, 0), env, { throttle: 1 }, 0.5)
		drive(car, env, { throttle: 1, steer: 1 }, 0.3)
		assert.ok(car.yaw > 0.3 && car.x < -0.2 && car.st > 0.9, `yaw ${car.yaw} x ${car.x}`)
		const right = drive(P.createCar({ x: 0, z: 0, yaw: 0 }, 0), env, { throttle: 1 }, 0.5)
		drive(right, env, { throttle: 1, steer: -1 }, 0.3)
		assert.ok(right.yaw < -0.3 && right.x > 0.2)
		const r13 = 13 / P.turnRate(13)
		assert.ok(r13 > 3 && r13 < 5, `turn radius at 13 m/s: ${r13}`)
		assert.ok(P.turnRate(1) < P.turnRate(13), 'a crawling car turns slower (no spinning on the spot)')
	})
})

describe('WO-1074 v2 physics: drift, pads, start, spin-out', () => {
	/** Drift for `sec` at full speed steering left, then release; returns { car, boostAfter }. */
	function driftFor(sec) {
		const { env } = straightEnv(400)
		const car = drive(P.createCar({ x: 0, z: 0, yaw: 0 }, 0), env, { throttle: 1 }, 2)
		car.ev.length = 0
		P.stepCar(car, { throttle: 1, steer: 1, drift: true }, env)
		const hopped = car.ev.some((e) => e.k === 'hop') && car.vy > 0
		const steps = Math.round(sec * 60) - 1
		for (let i = 0; i < steps; i++) P.stepCar(car, { throttle: 1, steer: 1, drift: true }, env)
		const drifting = car.drift
		const tHeld = car.driftT
		car.ev.length = 0
		P.stepCar(car, { throttle: 1, steer: 0, drift: false }, env)
		return { car, hopped, drifting, tHeld, mini: car.ev.find((e) => e.k === 'mini') || null, boostAfter: car.boost }
	}

	it('drift: hop on the press, slides left with the nose into the turn, charge stages at 0.7 s / 1.6 s', () => {
		const short = driftFor(0.5)
		assert.ok(short.hopped, 'a small hop')
		assert.equal(short.drifting, 1, 'drifting left')
		assert.equal(short.mini, null, 'released before 0.7 s: no mini-boost')
		assert.equal(short.boostAfter, 0)
		const one = driftFor(1.0)
		assert.equal(one.mini?.stage, 1)
		assert.ok(Math.abs(one.boostAfter - 0.6) < 1e-9, `stage 1 → 0.6 s, got ${one.boostAfter}`)
		const two = driftFor(2.0)
		assert.equal(two.mini?.stage, 2)
		assert.ok(Math.abs(two.boostAfter - 1.3) < 1e-9, `stage 2 → 1.3 s, got ${two.boostAfter}`)
		assert.equal(R.driftStage(0.69), 0)
		assert.equal(R.driftStage(0.7), 1)
		assert.equal(R.driftStage(1.6), 2)
		assert.equal(R.miniBoostFor(1.0), 0.6)
		assert.equal(R.miniBoostFor(3), 1.3)
	})

	it('drift turns tighter than grip driving and keeps a slide angle', () => {
		const { env } = straightEnv(400)
		const grip = drive(P.createCar({ x: 0, z: 0, yaw: 0 }, 0), env, { throttle: 1 }, 2)
		const dr = drive(P.createCar({ x: 0, z: 0, yaw: 0 }, 0), env, { throttle: 1 }, 2)
		drive(grip, env, { throttle: 1, steer: 1 }, 0.8)
		drive(dr, env, { throttle: 1, steer: 1, drift: true }, 0.8)
		assert.ok(dr.yaw > grip.yaw, `drift yaw ${dr.yaw} vs grip ${grip.yaw}`)
		assert.ok(dr.slip > 0.3, `slide angle ${dr.slip}`)
		assert.ok(P.forwardSpeed(dr) > 9, 'keeps its speed through the drift')
	})

	it('no drift below 6 m/s (a hop only)', () => {
		const { env } = straightEnv(400)
		const car = drive(P.createCar({ x: 0, z: 0, yaw: 0 }, 0), env, { throttle: 1 }, 0.35)
		assert.ok(P.forwardSpeed(car) < 6)
		drive(car, env, { throttle: 0.2, steer: 1, drift: true }, 0.3)
		assert.equal(car.drift, 0)
	})

	it('boost pad: 1.0 s boost on entering it, once per pass', () => {
		const raw = F.straightTrack(300, 4)
		raw.pads = [{ x: 0, y: 0, z: -20, yaw: 0 }]
		const T = TM.prepareTrack(raw)
		const env = P.createEnv(T, F.BIG_FLOORS, [])
		const car = P.createCar({ x: 0, z: 0, yaw: 0 }, 0)
		let pads = 0
		let maxBoost = 0
		for (let i = 0; i < 4 * 60; i++) {
			P.stepCar(car, { throttle: 1 }, env)
			pads += car.ev.filter((e) => e.k === 'pad').length
			car.ev.length = 0
			maxBoost = Math.max(maxBoost, car.boost)
		}
		assert.equal(pads, 1)
		assert.ok(Math.abs(maxBoost - 1.0) < 1e-9)
		assert.ok(car.z < -40)
	})

	it('start boost within the last 0.35 s; earlier = 1 s stall; after GO = nothing', () => {
		assert.equal(R.launchResult(9700, 10000), 'boost')
		assert.equal(R.launchResult(9650, 10000), 'boost')
		assert.equal(R.launchResult(9649, 10000), 'stall')
		assert.equal(R.launchResult(7000, 10000), 'stall')
		assert.equal(R.launchResult(null, 10000), 'none')
		assert.equal(R.launchResult(10010, 10000), 'none')
		const { env } = straightEnv()
		const b = P.createCar({ x: 0, z: 0, yaw: 0 }, 0)
		R.applyLaunch(b, 'boost')
		const s = P.createCar({ x: 0, z: 0, yaw: 0 }, 0)
		R.applyLaunch(s, 'stall')
		const n = P.createCar({ x: 0, z: 0, yaw: 0 }, 0)
		drive(b, env, { throttle: 1 }, 0.9)
		drive(s, env, { throttle: 1 }, 0.9)
		drive(n, env, { throttle: 1 }, 0.9)
		assert.ok(P.forwardSpeed(b) > P.forwardSpeed(n) + 3, `start boost ${P.forwardSpeed(b)} vs ${P.forwardSpeed(n)}`)
		assert.ok(Math.abs(P.forwardSpeed(s)) < 0.01, 'stalled: not moving yet')
		drive(s, env, { throttle: 1 }, 0.5)
		assert.ok(P.forwardSpeed(s) > 2, 'the stall ends after 1 s')
	})

	it('spin-out: 1.2 s, speed × 0.3, no control, two turns back to the same heading, then 2 s immunity; shield absorbs', () => {
		const { env } = straightEnv(400)
		const car = drive(P.createCar({ x: 0, z: 0, yaw: 0 }, 0), env, { throttle: 1 }, 3)
		const v0 = Math.hypot(car.vx, car.vz)
		const yaw0 = car.yaw
		assert.equal(R.spinOut(car), 'spin')
		assert.ok(Math.abs(Math.hypot(car.vx, car.vz) - v0 * 0.3) < 1e-9)
		assert.ok(R.fxFlags(car) & R.FX.SPIN)
		drive(car, env, { throttle: 1, steer: 1 }, 0.6)
		assert.ok(car.spin > 0 && P.forwardSpeed(car) < v0 * 0.3, 'no throttle while spinning')
		assert.equal(R.spinOut(car), 'immune', 'not hit twice')
		drive(car, env, { throttle: 1, steer: 1 }, 0.6)
		assert.equal(car.spin, 0)
		assert.ok(Math.abs(car.yaw - yaw0) < 1e-6, `same heading after the spin (${car.yaw} vs ${yaw0})`)
		assert.ok(car.immune > 1.9)
		assert.equal(R.spinOut(car), 'immune', 'blinking immunity')
		drive(car, env, { throttle: 1 }, 2.1)
		assert.equal(car.immune, 0)
		R.giveShield(car)
		assert.ok(R.fxFlags(car) & R.FX.SHIELD)
		assert.equal(R.spinOut(car), 'shield', 'the shield takes the hit')
		assert.equal(car.shield, 0)
		assert.equal(car.spin, 0)
		drive(car, env, {}, 0.6)
		assert.equal(R.spinOut(car), 'spin')
	})

	it('is deterministic: the same inputs give bit-identical states', () => {
		const run = () => {
			const T = TM.prepareTrack(F.roomTrack())
			const env = P.createEnv(T, F.ROOM_FLOORS, [{ min: [13, 0, -2], max: [13.5, 1, -1.5] }])
			const car = P.createCar(TM.gridPose(T, 3))
			const trace = []
			for (let i = 0; i < 1500; i++) {
				const input = {
					throttle: i % 300 < 250 ? 1 : 0,
					brake: i % 300 >= 280 ? 1 : 0,
					steer: Math.sin(i / 37),
					drift: i % 200 > 150,
				}
				P.stepCar(car, input, env, [{ x: 0, y: 0, z: 3 }])
				car.ev.length = 0
				if (i % 100 === 0) trace.push({ ...car, ev: null })
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
		s.advance(5, () => n++)
		assert.ok(n <= 8)
	})
})

/** Drive the centre line from s0 to s1 in small steps, feeding lapStep (with heights). */
function driveLine(T, st, s0, s1, ds = 0.1, t0 = 0, dy = 0) {
	const evs = []
	let p = TM.pointAt(T, s0)
	const dir = Math.sign(s1 - s0)
	let t = t0
	for (let s = s0 + ds * dir; dir > 0 ? s <= s1 : s >= s1; s += ds * dir) {
		const q = TM.pointAt(T, s)
		t += 100
		const ev = L.lapStep(T, st, p.x, p.z, q.x, q.z, t, p.y + dy, q.y + dy)
		if (ev) evs.push(ev)
		p = q
	}
	return evs
}
const names = (evs) => evs.map((e) => (e.type === 'cp' ? `cp${e.cp}` : `lap${e.lap}`))

describe('WO-1074 v2 lap logic (3D gates)', () => {
	it('counts checkpoints in order and laps on the oval (start behind the line)', () => {
		const T = TM.prepareTrack(F.ovalTrack())
		const st = L.createLapState(0)
		assert.deepEqual(names(driveLine(T, st, -1, 2 * T.total + 1)), [
			'cp1',
			'cp2',
			'cp3',
			'lap1',
			'cp1',
			'cp2',
			'cp3',
			'lap2',
		])
		assert.equal(st.times.length, 2)
		assert.ok(st.bestMs > 0)
	})

	it('room track: a lap over the ramp, the stage and the drop; a car 1.4 m above a gate does not pass it', () => {
		const T = TM.prepareTrack(F.roomTrack())
		const st = L.createLapState(0)
		assert.deepEqual(names(driveLine(T, st, -0.5, T.total + 0.5)), ['cp1', 'cp2', 'cp3', 'cp4', 'lap1'])
		const high = L.createLapState(0)
		assert.deepEqual(driveLine(T, high, -0.5, T.cpS[1] + 0.5, 0.1, 0, 1.45), [], 'stage-high over every gate')
		const air = L.createLapState(0)
		air.cp = 1
		const s2 = T.cpS[2]
		assert.deepEqual(
			names(driveLine(T, air, s2 - 1, s2 + 1, 0.1, 0, 0.9)),
			['cp2'],
			'airborne 0.9 m over the landing gate'
		)
	})

	it('figure-eight: a lap crosses the middle twice; the other branch never triggers a gate', () => {
		const T = TM.prepareTrack(F.eightTrack())
		const st = L.createLapState(0)
		assert.deepEqual(names(driveLine(T, st, -0.5, T.total + 0.5)), ['cp1', 'cp2', 'cp3', 'lap1'])
		const st2 = L.createLapState(0)
		const s120 = T.cumS[120]
		assert.deepEqual(driveLine(T, st2, s120 - 2, s120 + 2), [])
		assert.deepEqual(driveLine(T, st2, T.total - 2, T.total + 2), [])
		assert.equal(st2.lap, 0)
	})

	it('driving backwards over the line never counts; neither does wiggling across it', () => {
		const T = TM.prepareTrack(F.ovalTrack())
		const st = L.createLapState(0)
		assert.deepEqual(driveLine(T, st, 2, -2 * T.total - 2), [])
		const st2 = L.createLapState(0)
		for (let i = 0; i < 5; i++) {
			driveLine(T, st2, -0.5, 0.5)
			driveLine(T, st2, 0.5, -0.5)
		}
		assert.equal(st2.lap, 0)
		assert.equal(st2.cp, 0)
	})

	it('formats times', () => {
		assert.equal(L.fmtTime(23456), '23.4')
		assert.equal(L.fmtTime(71234), '1:11.2')
		assert.equal(L.fmtTime(null), '–')
	})
})
