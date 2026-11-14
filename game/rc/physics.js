/**
 * RC car physics (WO-1074) — pure and deterministic (no DOM, no three.js, no clocks, no randomness): the same inputs
 * always give the same states, so node tests can drive it.
 *
 * Arcade bicycle model in the contract's frame (metres, Y up, yaw 0 faces −Z, forward = (−sin yaw, −cos yaw)).
 * STEERING SIGN: input `steer` / state `st` in −1…1, POSITIVE = LEFT (yaw increases = counter-clockwise seen from above).
 * The world velocity (vx, vz) is kept separately from the heading so the car can slide a little (drift feel):
 * each step the heading turns first, then the sideways part of the velocity decays with the grip.
 */
import { nearestOnTrack } from './track-math.js'

export const PHYS = Object.freeze({
	DT: 1 / 60,
	TOP_ON: 9, // m/s on the asphalt (contract)
	TOP_OFF: 4, // m/s off the track surface (contract)
	CAP: 12, // hard cap, never exceeded (contract)
	REV_TOP: 3,
	ACCEL_ON: 11,
	ACCEL_OFF: 7,
	ACCEL_REV: 6,
	BRAKE: 20,
	COAST: 2.5,
	OFF_DECEL: 9, // too fast for the surface (left the track at speed)
	WHEELBASE: 0.3,
	STEER_RATE: 5, // input units per second
	STEER_MAX: 0.6, // rad at walking pace
	STEER_FALL: 0.3, // max angle = STEER_MAX / (1 + STEER_FALL·|v|)
	GRIP: 14,
	GRIP_OFF: 9,
	GRIP_HAND: 2.5, // handbrake (space) at speed → slide
	RADIUS: 0.22, // collision circle of the 0.45 × 0.25 m car
	CAR_GAP: 0.46, // centre distance where two cars touch
	SCRAPE: 0.985, // tangential speed kept per step while touching a wall
})

/** A fresh car at a pose. */
export function createCar(pose = {}, y = 0) {
	return { x: pose.x || 0, y, z: pose.z || 0, yaw: pose.yaw || 0, vx: 0, vz: 0, st: 0, onTrack: true, hit: false }
}

export function forwardOf(yaw) {
	return [-Math.sin(yaw), -Math.cos(yaw)]
}

export function rightOf(yaw) {
	return [Math.cos(yaw), -Math.sin(yaw)]
}

/** Signed forward speed (m/s, negative when reversing). */
export function forwardSpeed(car) {
	const [fx, fz] = forwardOf(car.yaw)
	return car.vx * fx + car.vz * fz
}

export function maxSteerAngle(speed) {
	return PHYS.STEER_MAX / (1 + PHYS.STEER_FALL * Math.abs(speed))
}

/**
 * The static environment of a race: the prepared track, its floor rect and the obstacles at car height on that floor.
 * @param {object|null} T prepared track (null = free arena, everything counts as on-track)
 * @param {number[]|null} rect [minX, minZ, maxX, maxZ] of the track's floor
 * @param {{min:number[],max:number[]}[]} obstacles scene obstacles (3D AABBs)
 */
export function createEnv(T, rect, obstacles = []) {
	const y = T ? T.y : 0
	const boxes = []
	for (const o of obstacles || []) {
		if (!o || !Array.isArray(o.min) || !Array.isArray(o.max)) continue
		/* only what a car can hit at 0–0.6 m above this floor */
		if (!(o.min[1] < y + 0.6 && o.max[1] > y + 0.02)) continue
		boxes.push([o.min[0], o.min[2], o.max[0], o.max[2]])
	}
	return { T, rect: Array.isArray(rect) && rect.length === 4 ? rect : null, boxes, y }
}

function clamp(v, lo, hi) {
	return v < lo ? lo : v > hi ? hi : v
}

/** Remove the velocity component going into a wall with outward normal (nx, nz); scrape the rest. */
function slideOff(car, nx, nz) {
	const vn = car.vx * nx + car.vz * nz
	if (vn < 0) {
		car.vx -= vn * nx
		car.vz -= vn * nz
	}
	car.vx *= PHYS.SCRAPE
	car.vz *= PHYS.SCRAPE
	car.hit = true
}

function collideBoxes(car, boxes) {
	const r = PHYS.RADIUS
	for (const b of boxes) {
		if (car.x < b[0] - r || car.x > b[2] + r || car.z < b[1] - r || car.z > b[3] + r) continue
		const cx = clamp(car.x, b[0], b[2])
		const cz = clamp(car.z, b[1], b[3])
		let dx = car.x - cx
		let dz = car.z - cz
		let d = Math.hypot(dx, dz)
		if (d >= r) continue
		let nx
		let nz
		if (d > 1e-9) {
			nx = dx / d
			nz = dz / d
			car.x = cx + nx * r
			car.z = cz + nz * r
		} else {
			/* centre inside the box: leave by the nearest face */
			const pen = [car.x - b[0], b[2] - car.x, car.z - b[1], b[3] - car.z]
			const k = pen.indexOf(Math.min(...pen))
			nx = k === 0 ? -1 : k === 1 ? 1 : 0
			nz = k === 2 ? -1 : k === 3 ? 1 : 0
			if (k === 0) car.x = b[0] - r
			else if (k === 1) car.x = b[2] + r
			else if (k === 2) car.z = b[1] - r
			else car.z = b[3] + r
		}
		slideOff(car, nx, nz)
	}
}

function collideRect(car, rect) {
	const r = PHYS.RADIUS
	if (car.x < rect[0] + r) {
		car.x = rect[0] + r
		slideOff(car, 1, 0)
	} else if (car.x > rect[2] - r) {
		car.x = rect[2] - r
		slideOff(car, -1, 0)
	}
	if (car.z < rect[1] + r) {
		car.z = rect[1] + r
		slideOff(car, 0, 1)
	} else if (car.z > rect[3] - r) {
		car.z = rect[3] - r
		slideOff(car, 0, -1)
	}
}

/** Soft push away from other cars (only this car moves; the others do the same on their own phones). */
function collideCars(car, others) {
	for (const o of others || []) {
		const dx = car.x - o.x
		const dz = car.z - o.z
		const d = Math.hypot(dx, dz)
		if (d >= PHYS.CAR_GAP || d < 1e-6) continue
		const nx = dx / d
		const nz = dz / d
		const push = (PHYS.CAR_GAP - d) * 0.5
		car.x += nx * push
		car.z += nz * push
		const vn = car.vx * nx + car.vz * nz
		if (vn < 0) {
			car.vx -= vn * nx * 0.8
			car.vz -= vn * nz * 0.8
		}
		car.vx += nx * 0.6
		car.vz += nz * 0.6
	}
}

/**
 * One fixed physics step (mutates and returns `car`).
 * @param {object} car from createCar
 * @param {{ throttle?: number, brake?: number, steer?: number, hand?: boolean }} input throttle/brake 0…1, steer −1…1 (+ = left)
 * @param {object} env from createEnv
 * @param {{x:number,z:number}[]} [others] other cars' (interpolated) positions
 * @param {number} [dt]
 */
export function stepCar(car, input, env, others, dt = PHYS.DT) {
	const throttle = clamp(Number(input?.throttle) || 0, 0, 1)
	const brake = clamp(Number(input?.brake) || 0, 0, 1)
	const steerIn = clamp(Number(input?.steer) || 0, -1, 1)
	const hand = !!input?.hand

	const near = env.T ? nearestOnTrack(env.T, car.x, car.z) : null
	const onTrack = near ? near.dist <= env.T.half : true
	car.onTrack = onTrack
	car.hit = false
	const top = onTrack ? PHYS.TOP_ON : PHYS.TOP_OFF

	/* steering: smoothed input, speed-dependent max angle, bicycle yaw rate */
	const dSt = clamp(steerIn - car.st, -PHYS.STEER_RATE * dt, PHYS.STEER_RATE * dt)
	car.st = clamp(car.st + dSt, -1, 1)
	let f = forwardSpeed(car)
	const angle = car.st * maxSteerAngle(f)
	car.yaw += ((f * Math.tan(angle)) / PHYS.WHEELBASE) * dt
	if (car.yaw > Math.PI) car.yaw -= 2 * Math.PI
	else if (car.yaw < -Math.PI) car.yaw += 2 * Math.PI

	/* velocity in the NEW heading frame: what is now sideways is slip */
	const [fx, fz] = forwardOf(car.yaw)
	const [rx, rz] = rightOf(car.yaw)
	f = car.vx * fx + car.vz * fz
	let l = car.vx * rx + car.vz * rz

	if (throttle > 0 && f < -0.1) f = Math.min(0, f + PHYS.BRAKE * throttle * dt)
	else if (throttle > 0 && f < top) f = Math.min(top, f + (onTrack ? PHYS.ACCEL_ON : PHYS.ACCEL_OFF) * throttle * dt)
	if (brake > 0) {
		if (f > 0.1) f = Math.max(0, f - PHYS.BRAKE * brake * dt)
		else if (throttle === 0) f = Math.max(-PHYS.REV_TOP, f - PHYS.ACCEL_REV * brake * dt)
	}
	if (hand) f = f > 0 ? Math.max(0, f - PHYS.BRAKE * 0.5 * dt) : Math.min(0, f + PHYS.BRAKE * 0.5 * dt)
	if (throttle === 0 && brake === 0) f = f > 0 ? Math.max(0, f - PHYS.COAST * dt) : Math.min(0, f + PHYS.COAST * dt)
	if (f > top) f = Math.max(top, f - PHYS.OFF_DECEL * dt)
	if (f < -PHYS.REV_TOP) f = -PHYS.REV_TOP

	const grip = hand && Math.abs(f) > 2 ? PHYS.GRIP_HAND : onTrack ? PHYS.GRIP : PHYS.GRIP_OFF
	l *= Math.exp(-grip * dt)

	car.vx = f * fx + l * rx
	car.vz = f * fz + l * rz
	capSpeed(car)

	car.x += car.vx * dt
	car.z += car.vz * dt
	car.y = env.y

	collideCars(car, others)
	collideBoxes(car, env.boxes)
	if (env.rect) collideRect(car, env.rect)
	capSpeed(car)
	return car
}

function capSpeed(car) {
	const sp = Math.hypot(car.vx, car.vz)
	if (sp > PHYS.CAP) {
		car.vx *= PHYS.CAP / sp
		car.vz *= PHYS.CAP / sp
	}
}

/** Put the car at a pose, stopped. */
export function placeCar(car, pose, y) {
	car.x = pose.x
	car.z = pose.z
	car.yaw = pose.yaw
	car.y = y
	car.vx = 0
	car.vz = 0
	car.st = 0
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
