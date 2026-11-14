/**
 * RC car physics (WO-1074, contract v2 §2.2) — pure and deterministic (no DOM, no three.js, no clocks, no
 * randomness): the same inputs always give the same states, so node tests can drive it. Fixed 60 Hz steps.
 *
 * Arcade kart model in the contract's frame (metres, Y up, yaw 0 faces −Z, forward = (−sin yaw, −cos yaw)).
 * STEERING SIGN: input `steer` / state `st` in −1…1, POSITIVE = LEFT (yaw increases = counter-clockwise from above).
 * The horizontal velocity (vx, vz) is kept apart from the nose (`yaw`): each step the nose turns, then the velocity is
 * split along the travel frame (the nose minus the drift slide angle) and the sideways part decays with the grip.
 * Vertical: gravity 20 m/s², the ground model of ground.js (floors + the active track's ramps and decks, at the car's
 * height: a car drives under a bridge), ballistic flight off ramps and ledges, landing with a squash, walls where the
 * ground steps up > 0.3 m, rails along decks (§2.7).
 * §3 toy scale: every length / speed / acceleration comes from the env's `P` (scale.js physFor(env.s)), so a car at
 * scale s drives exactly like the scale-1 car, s times smaller (no bare literal lengths in this file).
 */
import { PHYS } from './phys-const.js'
import { nearestHinted } from './track-math.js'
import { groundOf, moveHorizontal, collideObstacles, collideCars, padUnder, unstick } from './physics-world.js'
import { giveBoost, miniBoostFor, spinAngle, driftStage } from './drive-rules.js'

export { PHYS }
export { createEnv, groundOf, ceilingOf, eyeBlockedOf, tunnelOf } from './physics-world.js'

/** A fresh car at a pose (y: the pose's, else the argument). */
export function createCar(pose = {}, y = 0) {
	const car = {
		x: 0,
		y: 0,
		z: 0,
		yaw: 0,
		vx: 0,
		vy: 0,
		vz: 0,
		st: 0,
		onTrack: true,
		grounded: true,
		hit: false,
		bumped: false,
		seg: -1,
		slip: 0,
		drift: 0,
		driftT: 0,
		driftHeld: false,
		boost: 0,
		boostKind: '',
		spin: 0,
		spinYaw: 0,
		immune: 0,
		shield: 0,
		stall: 0,
		squash: 0,
		air: 0,
		stuckT: 0,
		pad: -1,
		catchup: 0,
		ev: [],
	}
	return placeCar(car, pose, y)
}

export function forwardOf(yaw) {
	return [-Math.sin(yaw), -Math.cos(yaw)]
}

export function rightOf(yaw) {
	return [Math.cos(yaw), -Math.sin(yaw)]
}

/** Signed speed along the direction of travel's frame (m/s, negative when reversing). */
export function forwardSpeed(car) {
	const [fx, fz] = forwardOf(frameYaw(car))
	return car.vx * fx + car.vz * fz
}

/** Heading of the velocity frame: the nose minus the drift slide angle (the pre-spin heading while spinning). */
export function frameYaw(car) {
	return car.spin > 0 ? car.spinYaw : car.yaw - (car.slip || 0)
}

/** Max yaw rate (rad/s) at a speed (low speed: a 1.4 m turning circle; at speed: TURN_MAX). P: the env's PHYS. */
export function turnRate(speed, P = PHYS) {
	return Math.min(Math.abs(speed) / P.TURN_R, P.TURN_MAX)
}

/** Steering angle for drawing the front wheels (s: the toy scale — the angle follows speed ÷ s). */
export function maxSteerAngle(speed, s = 1) {
	return 0.55 / (1 + 0.06 * Math.abs(speed / s))
}

function clamp(v, lo, hi) {
	return v < lo ? lo : v > hi ? hi : v
}

function wrap(a) {
	if (a > Math.PI) return a - 2 * Math.PI
	if (a < -Math.PI) return a + 2 * Math.PI
	return a
}

/** Current top speed (boost / ribbon / off), with the catch-up bonus. P: the env's PHYS (toy scale). */
export function topSpeed(car, P = PHYS) {
	const base = car.boost > 0 ? P.TOP_BOOST : car.onTrack ? P.TOP_ON : P.TOP_OFF
	return base * (1 + (car.catchup || 0))
}

function timers(car, dt) {
	car.boost = Math.max(0, car.boost - dt)
	car.immune = Math.max(0, car.immune - dt)
	car.shield = Math.max(0, car.shield - dt)
	car.stall = Math.max(0, car.stall - dt)
	car.squash = Math.max(0, car.squash - dt * 3)
	if (car.spin > 0) {
		car.spin = Math.max(0, car.spin - dt)
		if (car.spin === 0) {
			car.yaw = wrap(car.spinYaw)
			car.immune = PHYS.IMMUNE
		} else car.yaw = wrap(car.spinYaw + spinAngle(car.spin))
	}
}

/** Drift state machine: hop on the press, slide while held + steering, mini-boost on release. */
function driftLogic(car, drift, f, P) {
	const pressed = drift && !car.driftHeld
	car.driftHeld = drift
	if (car.spin > 0) return
	if (pressed && car.grounded && f > P.HOP_MIN_V) {
		car.vy = P.HOP_V
		car.grounded = false
		car.ev.push({ k: 'hop' })
	}
	if (!car.drift && drift && Math.abs(car.st) > 0.2 && f > P.DRIFT_MIN_V) {
		car.drift = Math.sign(car.st)
		car.driftT = 0
	}
	if (car.drift && (!drift || f < P.DRIFT_KEEP_V)) {
		const mini = drift ? 0 : miniBoostFor(car.driftT)
		if (mini > 0 && giveBoost(car, mini, 'mini')) car.ev.push({ k: 'mini', stage: driftStage(car.driftT) })
		car.drift = 0
		car.driftT = 0
	}
}

/**
 * One fixed physics step (mutates and returns `car`; events are pushed to car.ev for the caller to drain).
 * @param {object} car from createCar
 * @param {{ throttle?: number, brake?: number, steer?: number, drift?: boolean, hand?: boolean }} input
 *   throttle / brake 0…1, steer −1…1 (+ = left), drift (v1 `hand` is an alias)
 * @param {object} env from createEnv
 * @param {{x:number,y?:number,z:number}[]} [others] other cars' (interpolated) positions
 * @param {number} [dt]
 */
export function stepCar(car, input, env, others, dt = PHYS.DT) {
	const P = env.P || PHYS
	const ctl = car.spin <= 0
	let throttle = ctl ? clamp(Number(input?.throttle) || 0, 0, 1) : 0
	const brake = ctl ? clamp(Number(input?.brake) || 0, 0, 1) : 0
	const steerIn = ctl ? clamp(Number(input?.steer) || 0, -1, 1) : 0
	const drift = ctl && !!(input?.drift || input?.hand)
	if (car.stall > 0) throttle = 0
	const old = { x: car.x, y: car.y, z: car.z, yaw: car.yaw, vx: car.vx, vy: car.vy, vz: car.vz }
	car.hit = false
	car.bumped = false
	timers(car, dt)

	/* ribbon (3D-aware: the hall part is not the stage part above it) */
	const T = env.T
	if (T) {
		const n = nearestHinted(T, car.x, car.z, car.seg, car.y)
		car.seg = n.seg
		car.onTrack = n.dist <= T.half && n.vmiss === 0
	} else car.onTrack = true
	const top = topSpeed(car, P)

	/* steering input (smoothed) */
	const dSt = clamp(steerIn - car.st, -PHYS.STEER_RATE * dt, PHYS.STEER_RATE * dt)
	car.st = clamp(car.st + dSt, -1, 1)
	let f = forwardSpeed(car)
	driftLogic(car, drift, f, P)
	if (car.drift) car.driftT += dt

	/* nose turn */
	if (car.spin <= 0) {
		let w
		if (car.drift)
			w = car.drift * P.TURN_DRIFT * (0.55 + 0.5 * clamp(car.st * car.drift, -1, 1)) * Math.min(1, f / P.DRIFT_MIN_V)
		else w = car.st * turnRate(f, P) * Math.sign(f || 1)
		if (!car.grounded) w *= car.drift ? 0.7 : PHYS.AIR_STEER
		car.yaw = wrap(car.yaw + w * dt)
		const want = car.drift * PHYS.DRIFT_SLIP
		car.slip += clamp(want - car.slip, -PHYS.SLIP_RATE * dt, PHYS.SLIP_RATE * dt)
	}

	/* velocity in the travel frame */
	const [fx, fz] = forwardOf(frameYaw(car))
	const [rx, rz] = rightOf(frameYaw(car))
	f = car.vx * fx + car.vz * fz
	let l = car.vx * rx + car.vz * rz
	if (car.grounded && car.spin <= 0) {
		if (throttle > 0 && f < -P.CREEP_V) f = Math.min(0, f + P.BRAKE * throttle * dt)
		else if (throttle > 0 && f < top && car.boost <= 0) {
			const a = P.ACCEL * (1 - (P.ACCEL_FALL * Math.max(0, f)) / top)
			f = Math.min(top, f + a * throttle * dt)
		}
		if (car.boost > 0 && f < top && brake === 0) f = Math.min(top, Math.max(f, 0) + P.BOOST_ACCEL * dt)
		if (brake > 0) {
			if (f > P.CREEP_V) f = Math.max(0, f - P.BRAKE * brake * dt)
			else if (throttle === 0) f = Math.max(-P.REV_TOP, f - P.ACCEL_REV * brake * dt)
		}
		if (throttle === 0 && brake === 0 && car.boost <= 0)
			f = f > 0 ? Math.max(0, f - P.COAST * dt) : Math.min(0, f + P.COAST * dt)
		if (f > top) f = Math.max(top, f - P.OVER_DECEL * dt)
		if (f < -P.REV_TOP) f = Math.min(-P.REV_TOP, f + P.OVER_DECEL * dt)
		/* grip: the sideways slide decays, and most of it turns into forward speed (arcade: corners and drifts
		 * barely scrub speed) */
		const grip = car.drift ? P.GRIP_DRIFT : car.onTrack ? P.GRIP : P.GRIP_OFF
		const l2 = l * Math.exp(-grip * dt)
		if (f > 0)
			f = Math.min(Math.max(f, top), Math.sqrt(f * f + (l * l - l2 * l2) * (car.drift ? 0.95 : car.onTrack ? 0.85 : 0.6)))
		l = l2
	} else if (car.spin > 0) {
		f = f > 0 ? Math.max(0, f - P.SPIN_DECEL * dt) : Math.min(0, f + P.SPIN_DECEL * dt)
		l *= Math.exp(-P.GRIP_OFF * dt)
	} else l *= Math.exp(-P.GRIP_AIR * dt)
	car.vx = f * fx + l * rx
	car.vz = f * fz + l * rz
	capSpeed(car, P)

	/* horizontal move (walls), obstacles + the §3 occupancy grid, other cars */
	moveHorizontal(env, car, car.x + car.vx * dt, car.z + car.vz * dt)
	collideObstacles(env, car)
	collideCars(env, car, others)
	capSpeed(car, P)

	/* vertical: follow the ground, fly, land */
	verticalStep(env, car, dt)

	/* pads (on entering one) */
	const pad = car.grounded ? padUnder(env, car) : -1
	if (pad >= 0 && pad !== car.pad && giveBoost(car, P.PAD_BOOST, 'pad')) car.ev.push({ k: 'pad', i: pad })
	car.pad = pad

	/* auto-unstick: throttle held but going nowhere for UNSTICK_T */
	const hs = Math.hypot(car.vx, car.vz)
	if (throttle > 0.5 && hs < P.UNSTICK_V && car.grounded && car.spin <= 0) car.stuckT += dt
	else car.stuckT = 0
	if (car.stuckT >= P.UNSTICK_T) {
		car.stuckT = 0
		unstick(env, car)
	}

	/* never NaN: a broken step is undone */
	if (![car.x, car.y, car.z, car.yaw, car.vx, car.vy, car.vz].every(Number.isFinite)) Object.assign(car, old)
	return car
}

function verticalStep(env, car, dt) {
	const P = env.P || PHYS
	const g = groundOf(env, car.x, car.z, car.y)
	if (g === null) {
		/* outside every floor (only reachable by teleport): fall back to where we were */
		car.vy -= P.GRAVITY * dt
		return
	}
	const G = P.GRAVITY
	if (car.grounded) {
		const yb = car.y + car.vy * dt - 0.5 * G * dt * dt
		if (g >= yb - P.STICK) {
			car.vy = Math.min(P.VY_MAX, Math.max(-P.VY_MAX, (g - car.y) / dt))
			car.y = g
			car.air = 0
			return
		}
		car.grounded = false
		car.y = yb
		car.vy -= G * dt
		car.air = dt
		return
	}
	car.vy -= G * dt
	car.y += car.vy * dt
	car.air += dt
	if (car.y <= g + env.ground.eps && car.vy <= 0) {
		const impact = -car.vy
		car.y = g
		car.vy = 0
		car.grounded = true
		car.squash = Math.min(1, impact / P.LAND_V)
		if (car.air > 0.12) car.ev.push({ k: 'land', v: impact, air: car.air })
		car.air = 0
	} else if (car.y < g) {
		/* rising through a slope (a hop that started on a ramp): stay on top of it */
		car.y = g
	}
}

function capSpeed(car, P) {
	const sp = Math.hypot(car.vx, car.vz)
	if (sp > P.CAP) {
		car.vx *= P.CAP / sp
		car.vz *= P.CAP / sp
	}
}

/** Put the car at a pose (on the ground at `pose.y`, else `y`), stopped, all effects cleared. */
export function placeCar(car, pose, y = 0) {
	car.x = Number(pose?.x) || 0
	car.z = Number(pose?.z) || 0
	car.yaw = Number(pose?.yaw) || 0
	car.y = Number.isFinite(pose?.y) && pose.y !== null ? pose.y : Number(y) || 0
	car.vx = 0
	car.vy = 0
	car.vz = 0
	car.st = 0
	car.grounded = true
	car.slip = 0
	car.drift = 0
	car.driftT = 0
	car.boost = 0
	car.spin = 0
	car.stall = 0
	car.stuckT = 0
	car.seg = -1
	car.pad = -1
	car.air = 0
	return car
}

/**
 * Fixed-step accumulator: advance(realDtSeconds, stepFn) runs stepFn(DT) as often as needed (max `maxSteps` per call,
 * the backlog is dropped after a long stall) and returns the render alpha (0…1) between the last two steps.
 */
export function createStepper(dt = PHYS.DT, maxSteps = 8) {
	let acc = 0
	return {
		dt,
		advance(realDt, stepFn) {
			acc += Math.min(Math.max(0, realDt), 0.25)
			let n = 0
			while (acc >= dt && n < maxSteps) {
				stepFn(dt)
				acc -= dt
				n++
			}
			if (n === maxSteps && acc >= dt) acc = 0
			return acc / dt
		},
		reset() {
			acc = 0
		},
	}
}
