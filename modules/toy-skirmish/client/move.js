/**
 * Own soldier movement (WO-1081 §3/§5) — pure, fixed 60 Hz steps. A soldier runs at SOLDIER.SPEED u/s (no sprint, no
 * jump), reaching it in SOLDIER.ACCEL_T s and stopping as quickly; the wish direction is screen-relative input already
 * turned into the plan (x, z). Collision: the disc (SOLDIER.R) against the arena's solid grid, sliding along walls
 * (grid.js moveCircle). Positions are world metres; `s` = the scene scale (u → m).
 */
import { SOLDIER } from './sk-const.js'
import { moveCircle } from './grid.js'

export const STEP = 1 / 60

/** A soldier at (x, z) facing yaw. */
export function createSoldier(x = 0, z = 0, yaw = 0) {
	return { x, z, yaw, vx: 0, vz: 0 }
}

/** Put a soldier at a pose and stop it. */
export function placeSoldier(st, x, z, yaw = st.yaw) {
	st.x = x
	st.z = z
	st.yaw = yaw
	st.vx = 0
	st.vz = 0
	return st
}

/**
 * One step. @param {{ x, z, vx, vz }} st @param {{ mx: number, mz: number }} wish plan direction, length ≤ 1
 * @param {number} dt seconds @param {object|null} g solid grid (null = no collision) @param {number} s scale
 */
export function stepSoldier(st, wish, dt, g, s = 1) {
	let mx = Number(wish?.mx) || 0
	let mz = Number(wish?.mz) || 0
	const m = Math.hypot(mx, mz)
	if (m > 1) {
		mx /= m
		mz /= m
	}
	const top = SOLDIER.SPEED * s
	const acc = top / SOLDIER.ACCEL_T
	const tx = mx * top
	const tz = mz * top
	const ex = tx - st.vx
	const ez = tz - st.vz
	const e = Math.hypot(ex, ez)
	const k = e > acc * dt ? (acc * dt) / e : 1
	st.vx += ex * k
	st.vz += ez * k
	const v = Math.hypot(st.vx, st.vz)
	const cap = SOLDIER.SPEED * s
	if (v > cap) {
		st.vx *= cap / v
		st.vz *= cap / v
	}
	const nx = st.x + st.vx * dt
	const nz = st.z + st.vz * dt
	if (!g) {
		st.x = nx
		st.z = nz
		return st
	}
	const p = moveCircle(g, st.x, st.z, nx, nz, SOLDIER.R * s)
	/* what the wall took away is not kept as speed (no sticking, no bounce) */
	if (dt > 0) {
		st.vx = (p[0] - st.x) / dt
		st.vz = (p[1] - st.z) / dt
	}
	st.x = p[0]
	st.z = p[1]
	return st
}

/** Moving for the `mv` flag: above 5 % of the run speed. */
export function isMoving(st, s = 1) {
	return Math.hypot(st.vx, st.vz) > SOLDIER.SPEED * s * 0.05
}

/** Fixed-step accumulator: advance(dt, fn) calls fn(STEP) as often as due (at most 8 per frame). */
export function createStepper(step = STEP) {
	let acc = 0
	return {
		advance(dt, fn) {
			acc = Math.min(acc + Math.max(0, dt), step * 8)
			let n = 0
			while (acc >= step) {
				fn(step)
				acc -= step
				n++
			}
			return n
		},
		reset() {
			acc = 0
		},
	}
}
