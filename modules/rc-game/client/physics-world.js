/**
 * The world a car collides with (WO-1074, contract v2 §2.1 / §2.2) — pure: the ground model (floors + the active
 * track's ramps and §2.7 decks, at the car's height), walls where the ground steps up more than 0.3 m, the rails along
 * decks and slab ramps, obstacle boxes when their heights overlap the car, other cars (springy), boost pads, and the
 * auto-unstick nudge back towards the ribbon.
 * §3 toy scale: the env carries `s` and `P` (scale.js physFor(s)); every length here comes from P or the ground's
 * scaled tolerances. §3 occupancy grids (occ.js): blocked cells of the floor band are walls for a car in that band
 * (pushed out along the nearest-blocked-point normal, the same bounce as a wall).
 */
import { createGround, groundAt, blockedAt, railClamp, ceilingAt } from './ground.js'
import { nearestHinted, yawFromDir } from './track-math.js'
import { physFor, validScale } from './scale.js'
import { prepareOcc, occNearest, occPointBlocked, carveTracks } from './occ.js'
import { tubesOf, tubeAt } from './tunnel.js'

/**
 * The static environment of a race.
 * @param {object|null} T prepared track (null = free arena)
 * @param {object[]} floors scene floors ({ id, y, rect }); none → a floor around the track
 * @param {{min:number[],max:number[]}[]} obstacles scene obstacles (3D AABBs)
 * @param {{ scale?: number, occ?: object[] }} [opts] §3: the toy scale (default T.scale, else 1) and the scene's
 *   occupancy grids (raw or from occ.js prepareOcc — decode once per scene and pass the decoded list)
 */
export function createEnv(T, floors = [], obstacles = [], opts = {}) {
	const s = validScale(opts.scale ?? T?.scale)
	const P = physFor(s)
	let fl = Array.isArray(floors) ? floors : []
	const groundProbe = createGround(fl, null)
	if (!groundProbe.floors.length) {
		const b = T ? T.box : { minX: -15, maxX: 15, minZ: -10, maxZ: 10, minY: 0 }
		const m = (T ? T.half : 0) + 4 * s
		fl = [{ id: 'hall', y: b.minY || 0, rect: [b.minX - m, b.minZ - m, b.maxX + m, b.maxZ + m] }]
	}
	const boxes = []
	for (const o of obstacles || []) {
		if (!o || !Array.isArray(o.min) || !Array.isArray(o.max)) continue
		if (![...o.min, ...o.max].every(Number.isFinite)) continue
		boxes.push({ x0: o.min[0], y0: o.min[1], z0: o.min[2], x1: o.max[0], y1: o.max[1], z1: o.max[2] })
	}
	const pads = T
		? T.pads.map((p) => ({ ...p, fx: -Math.sin(p.yaw), fz: -Math.cos(p.yaw), hw: Math.min(P.PAD_HALF_W, T.half) }))
		: []
	const ground = createGround(fl, T, s)
	ground.boxes = boxes // the deck pillars stand clear of them (track-decks.js)
	/* §3.1: the active track's tunnels carved out (copies — the decoded scene grids are shared between tracks) */
	ground.occ = carveTracks(prepareOcc(opts.occ), T, s)
	return { T, ground, boxes, pads, s, P, tubes: tubesOf(T) }
}

/** Ground under (x, z) for a car at height y (a deck more than REACH above it is overhead); no y: every surface. */
export function groundOf(env, x, z, y = Infinity) {
	return groundAt(env.ground, x, z, y)
}

/**
 * Underside of a deck overhead a car at height y (a bridge) or of a §3.1 tunnel's ceiling (inside its span), or
 * Infinity — the chase camera stays under it.
 */
export function ceilingOf(env, x, z, y) {
	const c = env?.ground ? ceilingAt(env.ground, x, z, y) : Infinity
	const t = env?.tubes?.length ? tubeAt(env.tubes, x, z, y) : null
	return t ? Math.min(c, t.top) : c
}

/** §3.1: the tunnel a car at (x, y, z) is in → { tube, d, t, top } or null (the director's portal shot). */
export function tunnelOf(env, x, z, y) {
	return env?.tubes?.length ? tubeAt(env.tubes, x, z, y) : null
}

/** Blocked for a car at height y: the centre or the point RADIUS ahead along the motion has no / too high ground. */
function blockedMove(env, x, z, y, mx, mz) {
	if (blockedAt(env.ground, x, z, y)) return true
	const m = Math.hypot(mx, mz)
	if (m < 1e-9) return false
	return blockedAt(env.ground, x + (mx / m) * env.P.RADIUS, z + (mz / m) * env.P.RADIUS, y)
}

/** §3: is the plan point (x, z) in a blocked cell of the floor band a car at height y is in? (the chase camera) */
export function eyeBlockedOf(env, x, z, y) {
	const G = env?.ground
	return !!G?.occ?.length && occPointBlocked(G.occ, x, z, y, G.eps, env.P.CAR_H)
}

/** Outward wall normal at (x, z): away from the blocked directions around it. */
function wallNormal(env, x, z, y, vx, vz) {
	let sx = 0
	let sz = 0
	for (let k = 0; k < 16; k++) {
		const a = (k / 16) * Math.PI * 2
		const dx = Math.cos(a)
		const dz = Math.sin(a)
		if (blockedAt(env.ground, x + dx * env.P.PROBE, z + dz * env.P.PROBE, y)) {
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

function bounce(car, nx, nz, P) {
	const vn = car.vx * nx + car.vz * nz
	if (vn < 0) {
		car.vx -= (1 + P.RESTITUTION) * vn * nx
		car.vz -= (1 + P.RESTITUTION) * vn * nz
		const tx = -nz
		const tz = nx
		const vt = car.vx * tx + car.vz * tz
		const keep = vt * (1 - P.SCRAPE)
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
	const c = railClamp(env.ground, ox, oz, car.x, car.z, car.y, env.P.RADIUS)
	if (c) {
		car.x = c.x
		car.z = c.z
		bounce(car, c.nx, c.nz, env.P)
	}
	/* §3 occupancy grid of the floor band (table legs, truss bases …) */
	const o = env.ground.occ?.length ? collideOcc(env, car, ox, oz) : false
	return hit || !!c || o
}

/**
 * §3: push the car's disc (RADIUS) out of the blocked cells of its floor band and bounce like off a wall. A long move is
 * walked in half-radius steps first (the first overlapping point is resolved: no tunnelling through a one-cell leg).
 */
export function collideOcc(env, car, ox, oz) {
	const G = env.ground
	const P = env.P
	const r = P.RADIUS
	const near = (x, z) => occNearest(G.occ, x, z, car.y, r, G.eps, P.CAR_H)
	const len = Math.hypot(car.x - ox, car.z - oz)
	if (len > r * 0.5) {
		const n = Math.ceil(len / (r * 0.5))
		for (let k = 1; k < n; k++) {
			const x = ox + ((car.x - ox) * k) / n
			const z = oz + ((car.z - oz) * k) / n
			if (near(x, z)) {
				car.x = x
				car.z = z
				break
			}
		}
	}
	let hit = false
	for (let it = 0; it < 4; it++) {
		const h = near(car.x, car.z)
		if (!h) break
		hit = true
		let nx
		let nz
		if (h.d > r * 1e-6) {
			nx = (car.x - h.px) / h.d
			nz = (car.z - h.pz) / h.d
			car.x = h.px + nx * r * 1.0001
			car.z = h.pz + nz * r * 1.0001
		} else {
			/* centre inside a blocked cell: the nearest free spot around it, else back where the step started */
			const out = freeAround(car.x, car.z, near, r)
			if (out) {
				nx = out.nx
				nz = out.nz
				car.x = out.x
				car.z = out.z
			} else {
				const l = Math.hypot(ox - car.x, oz - car.z) || 1
				nx = (ox - car.x) / l
				nz = (oz - car.z) / l
				car.x = ox
				car.z = oz
			}
		}
		bounce(car, nx, nz, P)
	}
	return hit
}

/** Nearest free disc position around (x, z) in 16 directions, up to 4 radii out → { x, z, nx, nz } or null. */
function freeAround(x, z, near, r) {
	for (let ring = 1; ring <= 8; ring++) {
		const d = (ring * r) / 2
		for (let k = 0; k < 16; k++) {
			const a = (k / 16) * Math.PI * 2
			const nx = Math.cos(a)
			const nz = Math.sin(a)
			if (!near(x + nx * d, z + nz * d)) return { x: x + nx * d, z: z + nz * d, nx, nz }
		}
	}
	return null
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
	bounce(car, wx, wz, env.P)
	/* slide: keep the part of the move along the wall */
	const d = mx * wx + mz * wz
	const sx = ox + mx - d * wx
	const sz = oz + mz - d * wz
	if (!blockedMove(env, sx, sz, car.y, sx - ox, sz - oz)) {
		car.x = sx
		car.z = sz
	} else if (blockedAt(env.ground, ox, oz, car.y)) {
		/* already inside (spawned / pushed there): step out along the normal */
		car.x = ox + wx * env.P.STEP_OUT
		car.z = oz + wz * env.P.STEP_OUT
	}
	return true
}

/** Obstacle boxes overlapping [y, y + CAR_H] in height: circle-vs-rect push out + bounce. */
export function collideObstacles(env, car) {
	const P = env.P
	const r = P.RADIUS
	for (const b of env.boxes) {
		if (!(b.y0 < car.y + P.CAR_H && b.y1 > car.y + env.ground.eps)) continue
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
		bounce(car, nx, nz, P)
	}
}

/** Springy push away from other cars at about the same height (only this car moves; the others do the same). */
export function collideCars(env, car, others) {
	const P = env.P
	for (const o of others || []) {
		if (Math.abs((o.y ?? car.y) - car.y) > P.CAR_DY) continue
		const dx = car.x - o.x
		const dz = car.z - o.z
		const d = Math.hypot(dx, dz)
		if (d >= P.CAR_GAP || d < 1e-6 * env.s) continue
		const nx = dx / d
		const nz = dz / d
		const push = (P.CAR_GAP - d) * 0.5
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
			car.vx += (-vn * 0.75 + P.BUMP_KICK) * nx
			car.vz += (-vn * 0.75 + P.BUMP_KICK) * nz
			car.bumped = true
		}
	}
}

/** Index of the boost pad under a grounded car, or −1. */
export function padUnder(env, car) {
	for (let i = 0; i < env.pads.length; i++) {
		const p = env.pads[i]
		if (Math.abs(car.y - p.y) > env.P.PAD_DY) continue
		const dx = car.x - p.x
		const dz = car.z - p.z
		const along = dx * p.fx + dz * p.fz
		const across = dx * p.fz - dz * p.fx
		if (Math.abs(along) <= env.P.PAD_LEN / 2 && Math.abs(across) <= p.hw) return i
	}
	return -1
}

/**
 * Auto-unstick: move the car up to UNSTICK_STEP towards the nearest ribbon point (onto it when the way is blocked),
 * on the ground there, facing along the track, stopped. §3: never into a blocked occupancy cell — a spot in one moves
 * on along the track (up to 3 more nudges), else the unstick is skipped.
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
	const P = env.P
	if (d > P.UNSTICK_NEAR) {
		const k = Math.min(P.UNSTICK_STEP, d) / d
		tx = car.x + dx * k
		tz = car.z + dz * k
	} else {
		tx = car.x + g0.ux * P.UNSTICK_FWD
		tz = car.z + g0.uz * P.UNSTICK_FWD
	}
	let gy = groundOf(env, tx, tz, car.y)
	if (gy === null || gy > car.y + env.ground.stepUp) {
		tx = n.px
		tz = n.pz
		gy = groundOf(env, tx, tz, n.py)
	}
	if (gy === null) return false
	const occ = env.ground.occ
	if (occ?.length) {
		const hit = (x, z, y) => occNearest(occ, x, z, y, P.RADIUS, env.ground.eps, P.CAR_H)
		let tries = 0
		while (hit(tx, tz, gy) && tries++ < 3) {
			tx += g0.ux * P.UNSTICK_FWD
			tz += g0.uz * P.UNSTICK_FWD
			gy = groundOf(env, tx, tz, gy)
			if (gy === null) return false
		}
		if (hit(tx, tz, gy)) return false
	}
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
