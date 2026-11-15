/**
 * Shots (WO-1081 §5/§7) — pure: the spread of a shot from its `seed`, hitscan traces through the solid grid and
 * against the soldiers as drawn, and the Thumper rocket that every client flies identically from the server's `shot`.
 *
 *  - Spread: `mulberry32(seed)`, ONE draw per pellet, uniform in ± spread/2 around the shot's yaw (§7).
 *  - Hitscan: from the shooter's plan position along each pellet's yaw; a ray stops at the first solid cell, at the
 *    weapon's range or at the first soldier (disc of SOLDIER.R) other than the shooter — the Longshot too (it "passes
 *    through nothing").
 *  - Rocket: straight at ROCKET.SPEED from `p` along `yaw` starting at `ts`; it ends at the first solid cell / the
 *    arena edge (precomputed once per rocket), a soldier other than its owner (ROCKET.HIT_R) or after ROCKET.LIFE.
 * Positions are world metres, sizes in u × the scene scale `s`.
 */
import { WEAPONS, SOLDIER, ROCKET, fwd } from './sk-const.js'
import { rayCast } from './grid.js'

/** The classic 32-bit generator: seed → () => [0, 1). */
export function mulberry32(seed) {
	let a = seed >>> 0
	return function next() {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/** The yaws of a shot's pellets (length = the weapon's pellets). Unknown weapon → [yaw]. */
export function pelletYaws(w, yaw, seed) {
	const W = WEAPONS[w]
	if (!W) return [yaw]
	const rnd = mulberry32(seed)
	const half = (W.spread * Math.PI) / 360 // the server's exact expression (bit-identical yaws)
	const out = []
	for (let k = 0; k < W.pellets; k++) out.push(yaw + (rnd() * 2 - 1) * half)
	return out
}

/** Distance along the unit ray (ox, oz) + t·(dx, dz) to a disc (cx, cz, r), or Infinity. */
export function rayDisc(ox, oz, dx, dz, cx, cz, r) {
	const fx = cx - ox
	const fz = cz - oz
	const t = fx * dx + fz * dz
	const px = fx - t * dx
	const pz = fz - t * dz
	const d2 = px * px + pz * pz
	if (d2 > r * r) return Infinity
	const back = Math.sqrt(r * r - d2)
	const t0 = t - back
	if (t0 >= 0) return t0
	return t + back >= 0 ? 0 : Infinity // starts inside the disc
}

/**
 * Trace one shot. @param {{ w: string, p: number[], yaw: number, seed: number, id?: any }} shot
 * @param {object|null} g solid grid @param {{ id: any, x: number, z: number }[]} soldiers the ones that can be hit
 * @param {number} s scale
 * @returns {{ rays: { yaw: number, len: number, hit: any }[], hits: Map<any, number> }} len in metres, hit = soldier id or null
 */
export function traceShot(shot, g, soldiers, s = 1) {
	const W = WEAPONS[shot.w]
	const range = (W ? W.range : 0) * s
	const R = SOLDIER.R * s
	const [ox, oz] = shot.p
	const rays = []
	const hits = new Map()
	for (const yaw of pelletYaws(shot.w, shot.yaw, shot.seed)) {
		const [dx, dz] = fwd(yaw)
		let len = g ? rayCast(g, ox, oz, dx, dz, range) : range
		let hit = null
		for (const v of soldiers || []) {
			if (v.id === shot.id) continue
			const t = rayDisc(ox, oz, dx, dz, v.x, v.z, R)
			if (t < len) {
				len = t
				hit = v.id
			}
		}
		rays.push({ yaw, len, hit })
		if (hit != null) hits.set(hit, (hits.get(hit) || 0) + 1)
	}
	return { rays, hits }
}

/** A rocket from a `shot` (or the own fire): its fixed path and where it meets a wall. */
export function createRocket(shot, g, s = 1) {
	const [dx, dz] = fwd(shot.yaw)
	const maxLen = ROCKET.SPEED * ROCKET.LIFE * s
	const wall = g ? rayCast(g, shot.p[0], shot.p[1], dx, dz, maxLen) : maxLen
	return {
		owner: shot.id,
		n: shot.n,
		ts: shot.ts,
		ox: shot.p[0],
		oz: shot.p[1],
		dx,
		dz,
		wall, // distance (m) to the solid / edge, or the life's end
		hitWall: wall < maxLen,
		d: 0, // distance flown so far
		done: false,
		end: null, // { x, z, hit: id|null, wall: boolean, expired: boolean }
	}
}

/** Where a rocket is `t` seconds after its start (never past its wall). */
export function rocketAt(r, t, s = 1) {
	const d = Math.min(r.wall, Math.max(0, t) * ROCKET.SPEED * s)
	return [r.ox + r.dx * d, r.oz + r.dz * d, d]
}

/**
 * Advance a rocket to `t` seconds after its start; soldiers are swept along the travelled stretch (other than the
 * owner, radius ROCKET.HIT_R). Sets r.done / r.end on impact. @returns {object|null} the end when it ended now
 */
export function stepRocket(r, t, soldiers, s = 1) {
	if (r.done) return null
	const [, , d1] = rocketAt(r, t, s)
	const d0 = r.d
	const HR = ROCKET.HIT_R * s
	let best = Infinity
	let hit = null
	for (const v of soldiers || []) {
		if (v.id === r.owner) continue
		const tt = rayDisc(r.ox + r.dx * d0, r.oz + r.dz * d0, r.dx, r.dz, v.x, v.z, HR)
		if (tt <= d1 - d0 && tt < best) {
			best = tt
			hit = v.id
		}
	}
	if (hit != null) {
		const d = d0 + best
		r.d = d
		r.done = true
		r.end = { x: r.ox + r.dx * d, z: r.oz + r.dz * d, hit, wall: false, expired: false }
		return r.end
	}
	r.d = d1
	if (d1 >= r.wall - 1e-9) {
		r.done = true
		r.end = { x: r.ox + r.dx * d1, z: r.oz + r.dz * d1, hit: null, wall: r.hitWall, expired: !r.hitWall }
		return r.end
	}
	return null
}

/** Splash damage at distance d (m) from the centre: linear 90 → 0 over SPLASH_R (× SELF_K on the owner). */
export function splashDamage(d, s = 1, self = false) {
	const k = Math.max(0, 1 - d / (ROCKET.SPLASH_R * s))
	return WEAPONS.thumper.dmg * k * (self ? ROCKET.SELF_K : 1)
}

/** A shot counter that is unique per player and session (`n` in fire / hit / boom). */
export function createShotCounter(start = 0) {
	let n = start
	return () => ++n
}
