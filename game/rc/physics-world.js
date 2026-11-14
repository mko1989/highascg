/**
 * The world a car collides with (WO-1074, contract v2 §2.1 / §2.2) — pure: the ground model (floors + the active
 * track's ramps and §2.7 decks, at the car's height), walls where the ground steps up more than 0.3 m, the rails along
 * decks and slab ramps, obstacle boxes when their heights overlap the car, other cars (springy), boost pads, and the
 * auto-unstick nudge back towards the ribbon.
 */
import { PHYS } from './phys-const.js'
import { createGround, groundAt, blockedAt, railClamp, ceilingAt, STEP_UP, GROUND_EPS } from './ground.js'
import { nearestHinted, yawFromDir } from './track-math.js'

/**
 * The static environment of a race.
 * @param {object|null} T prepared track (null = free arena)
 * @param {object[]} floors scene floors ({ id, y, rect }); none → a floor around the track
 * @param {{min:number[],max:number[]}[]} obstacles scene obstacles (3D AABBs)
 */
export function createEnv(T, floors = [], obstacles = []) {
	let fl = Array.isArray(floors) ? floors : []
	const groundProbe = createGround(fl, null)
	if (!groundProbe.floors.length) {
		const b = T ? T.box : { minX: -15, maxX: 15, minZ: -10, maxZ: 10, minY: 0 }
		const m = (T ? T.half : 0) + 4
		fl = [{ id: 'hall', y: b.minY || 0, rect: [b.minX - m, b.minZ - m, b.maxX + m, b.maxZ + m] }]
	}
	const boxes = []
	for (const o of obstacles || []) {
		if (!o || !Array.isArray(o.min) || !Array.isArray(o.max)) continue
		if (![...o.min, ...o.max].every(Number.isFinite)) continue
		boxes.push({ x0: o.min[0], y0: o.min[1], z0: o.min[2], x1: o.max[0], y1: o.max[1], z1: o.max[2] })
	}
	const pads = T
		? T.pads.map((p) => ({ ...p, fx: -Math.sin(p.yaw), fz: -Math.cos(p.yaw), hw: Math.min(PHYS.PAD_HALF_W, T.half) }))
		: []
	const ground = createGround(fl, T)
	ground.boxes = boxes // the deck pillars stand clear of them (track-decks.js)
	return { T, ground, boxes, pads }
}

/** Ground under (x, z) for a car at height y (a deck more than REACH above it is overhead); no y: every surface. */
export function groundOf(env, x, z, y = Infinity) {
	return groundAt(env.ground, x, z, y)
}

/** Underside of a deck overhead a car at height y (a bridge), or Infinity — the chase camera stays under it. */
export function ceilingOf(env, x, z, y) {
	return env?.ground ? ceilingAt(env.ground, x, z, y) : Infinity
}

/** Blocked for a car at height y: the centre or the point RADIUS ahead along the motion has no / too high ground. */
function blockedMove(env, x, z, y, mx, mz) {
	if (blockedAt(env.ground, x, z, y)) return true
	const m = Math.hypot(mx, mz)
	if (m < 1e-9) return false
	return blockedAt(env.ground, x + (mx / m) * PHYS.RADIUS, z + (mz / m) * PHYS.RADIUS, y)
}

/** Outward wall normal at (x, z): away from the blocked directions around it. */
function wallNormal(env, x, z, y, vx, vz) {
	let sx = 0
	let sz = 0
	for (let k = 0; k < 16; k++) {
		const a = (k / 16) * Math.PI * 2
		const dx = Math.cos(a)
		const dz = Math.sin(a)
		if (blockedAt(env.ground, x + dx * PHYS.PROBE, z + dz * PHYS.PROBE, y)) {
			sx -= dx
			sz -= dz
		}
	}
	let l = Math.hypot(sx, sz)
	if (l < 1e-6) {
		sx = -vx
		sz = -vz
		l = Math.hypot(sx, sz) || 1
	}
	return [sx / l, sz / l]
}

function bounce(car, nx, nz) {
	const vn = car.vx * nx + car.vz * nz
	if (vn < 0) {
		car.vx -= (1 + PHYS.RESTITUTION) * vn * nx
		car.vz -= (1 + PHYS.RESTITUTION) * vn * nz
		const tx = -nz
		const tz = nx
		const vt = car.vx * tx + car.vz * tz
		const keep = vt * (1 - PHYS.SCRAPE)
		car.vx -= keep * tx
		car.vz -= keep * tz
		car.hit = true
		car.ev?.push({ k: 'wall', v: -vn })
	}
}

/**
 * Horizontal move (ox, oz) → (nx, nz) at the car's height: walls stop it and bounce it (restitution 0.4); the move
 * slides along the wall where it can. Never leaves the car on blocked ground.
 */
export function moveHorizontal(env, car, nx, nz) {
	const ox = car.x
	const oz = car.z
	const hit = moveFree(env, car, nx, nz)
	/* §2.7 rails: on a deck / slab ramp the car stays on the ribbon (bounces off its edge like a wall) */
	const c = railClamp(env.ground, ox, oz, car.x, car.z, car.y, PHYS.RADIUS)
	if (!c) return hit
	car.x = c.x
	car.z = c.z
	bounce(car, c.nx, c.nz)
	return true
}

function moveFree(env, car, nx, nz) {
	const ox = car.x
	const oz = car.z
	const mx = nx - ox
	const mz = nz - oz
	if (!blockedMove(env, nx, nz, car.y, mx, mz)) {
		car.x = nx
		car.z = nz
		return false
	}
	const [wx, wz] = wallNormal(env, ox, oz, car.y, mx, mz)
	bounce(car, wx, wz)
	/* slide: keep the part of the move along the wall */
	const d = mx * wx + mz * wz
	const sx = ox + mx - d * wx
	const sz = oz + mz - d * wz
	if (!blockedMove(env, sx, sz, car.y, sx - ox, sz - oz)) {
		car.x = sx
		car.z = sz
	} else if (blockedAt(env.ground, ox, oz, car.y)) {
		/* already inside (spawned / pushed there): step out along the normal */
		car.x = ox + wx * 0.05
		car.z = oz + wz * 0.05
	}
	return true
}

/** Obstacle boxes overlapping [y, y + CAR_H] in height: circle-vs-rect push out + bounce. */
export function collideObstacles(env, car) {
	const r = PHYS.RADIUS
	for (const b of env.boxes) {
		if (!(b.y0 < car.y + PHYS.CAR_H && b.y1 > car.y + GROUND_EPS)) continue
		if (car.x < b.x0 - r || car.x > b.x1 + r || car.z < b.z0 - r || car.z > b.z1 + r) continue
		const cx = Math.max(b.x0, Math.min(b.x1, car.x))
		const cz = Math.max(b.z0, Math.min(b.z1, car.z))
		const dx = car.x - cx
		const dz = car.z - cz
		const d = Math.hypot(dx, dz)
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
			const pen = [car.x - b.x0, b.x1 - car.x, car.z - b.z0, b.z1 - car.z]
			const k = pen.indexOf(Math.min(...pen))
			nx = k === 0 ? -1 : k === 1 ? 1 : 0
			nz = k === 2 ? -1 : k === 3 ? 1 : 0
			if (k === 0) car.x = b.x0 - r
			else if (k === 1) car.x = b.x1 + r
			else if (k === 2) car.z = b.z0 - r
			else car.z = b.z1 + r
		}
		bounce(car, nx, nz)
	}
}

const BUMP_KICK = 1.4 // m/s, once per contact

/** Springy push away from other cars at about the same height (only this car moves; the others do the same). */
export function collideCars(env, car, others) {
	for (const o of others || []) {
		if (Math.abs((o.y ?? car.y) - car.y) > 0.4) continue
		const dx = car.x - o.x
		const dz = car.z - o.z
		const d = Math.hypot(dx, dz)
		if (d >= PHYS.CAR_GAP || d < 1e-6) continue
		const nx = dx / d
		const nz = dz / d
		const push = (PHYS.CAR_GAP - d) * 0.5
		const px = car.x + nx * push
		const pz = car.z + nz * push
		if (!blockedAt(env.ground, px, pz, car.y)) {
			car.x = px
			car.z = pz
		}
		/* a bump only while closing in (relative speed, the other car's from its pose): equal masses, restitution
		 * 0.5 → 0.75 of the closing speed, plus a fixed kick; staying in contact never stacks kicks */
		const ov = Number.isFinite(o.v) && Number.isFinite(o.yaw) ? o.v : 0
		const ovx = ov ? -Math.sin(o.yaw) * ov : 0
		const ovz = ov ? -Math.cos(o.yaw) * ov : 0
		const vn = (car.vx - ovx) * nx + (car.vz - ovz) * nz
		if (vn < 0) {
			car.vx += (-vn * 0.75 + BUMP_KICK) * nx
			car.vz += (-vn * 0.75 + BUMP_KICK) * nz
			car.bumped = true
		}
	}
}

/** Index of the boost pad under a grounded car, or −1. */
export function padUnder(env, car) {
	for (let i = 0; i < env.pads.length; i++) {
		const p = env.pads[i]
		if (Math.abs(car.y - p.y) > 0.5) continue
		const dx = car.x - p.x
		const dz = car.z - p.z
		const along = dx * p.fx + dz * p.fz
		const across = dx * p.fz - dz * p.fx
		if (Math.abs(along) <= PHYS.PAD_LEN / 2 && Math.abs(across) <= p.hw) return i
	}
	return -1
}

/**
 * Auto-unstick: move the car up to UNSTICK_STEP towards the nearest ribbon point (onto it when the way is blocked),
 * on the ground there, facing along the track, stopped.
 */
export function unstick(env, car) {
	const T = env.T
	if (!T) return false
	const n = nearestHinted(T, car.x, car.z, car.seg ?? -1, car.y)
	const dx = n.px - car.x
	const dz = n.pz - car.z
	const d = Math.hypot(dx, dz)
	const g0 = T.segs[n.seg]
	let tx
	let tz
	if (d > 0.3) {
		const k = Math.min(PHYS.UNSTICK_STEP, d) / d
		tx = car.x + dx * k
		tz = car.z + dz * k
	} else {
		tx = car.x + g0.ux * 0.8
		tz = car.z + g0.uz * 0.8
	}
	let gy = groundOf(env, tx, tz, car.y)
	if (gy === null || gy > car.y + STEP_UP) {
		tx = n.px
		tz = n.pz
		gy = groundOf(env, tx, tz, n.py)
	}
	if (gy === null) return false
	car.x = tx
	car.z = tz
	car.y = gy
	car.vx = 0
	car.vz = 0
	car.vy = 0
	car.grounded = true
	car.yaw = yawFromDir(g0.ux, g0.uz)
	car.slip = 0
	car.drift = 0
	car.ev?.push({ k: 'unstick' })
	return true
}
