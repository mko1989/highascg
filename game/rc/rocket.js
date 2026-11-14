/**
 * Rocket path (WO-1074, contract v2 §2.3 / §2.4) — pure and closed-form, so every client draws and hit-tests the same
 * rocket at the same server time whatever its frame timing.
 *
 * The rule (from the hazard's `p`, `yaw`, `ts` and the prepared track only):
 *  1. s0 = arc length of the centre-line point nearest to p (3D-aware: p's height picks the hall or the stage part).
 *  2. dir = +1 when the car's forward (−sin yaw, −cos yaw) points along the track's direction there, else −1.
 *  3. At t = (serverMs − ts) / 1000 s (t < 0 → 0): s = s0 + dir · 26 · t; the point is the centre line at s (x, y, z
 *     linearly interpolated along its segment), shifted sideways by p's lateral offset from the centre line and up by
 *     p's height above it, both fading linearly to 0 over the first 0.5 s; then raised by HOVER (0.35 m).
 *     So it follows the centre line's height everywhere: up / down ramps, and over a drop it follows the line's step
 *     down (the line's own segment from the ledge to the next point).
 *  4. It lives while t ≤ 5 s and serverMs < `until` (when given); on an open track it ends at either end of the line.
 *  §3 toy scale: the speed and the hover height are × T.scale (26 · s m/s, 0.35 · s m); times stay.
 *     After that it is gone (null) — the server's `hazgone` removes it for good.
 */
import { nearestOnTrack, pointAt, leftNormal, yawFromDir } from './track-math.js'

export const ROCKET_SPEED = 26
export const ROCKET_LIFE_MS = 5000
export const ROCKET_HOVER = 0.35
export const ROCKET_BLEND_S = 0.5

/** Launch parameters of a rocket hazard on track T (cache them per hazard). */
export function rocketPath(T, haz) {
	const p = haz.p
	const n = nearestOnTrack(T, p[0], p[2], -1, 6, p[1])
	const g = T.segs[n.seg] || { ux: 0, uz: -1 }
	const fx = -Math.sin(haz.yaw || 0)
	const fz = -Math.cos(haz.yaw || 0)
	const dir = g.ux * fx + g.uz * fz >= 0 ? 1 : -1
	const [lx, lz] = leftNormal(g.ux, g.uz)
	return { s0: n.s, dir, lat: (p[0] - n.px) * lx + (p[2] - n.pz) * lz, up: p[1] - n.py }
}

/**
 * Rocket pose at a server time, or null when it does not (or no longer) fly.
 * @returns {{ x: number, y: number, z: number, yaw: number, t: number } | null}
 */
export function rocketPose(T, haz, serverMs, path = null) {
	if (!T || !T.segs.length || !haz || !Array.isArray(haz.p)) return null
	const P = path || rocketPath(T, haz)
	const ms = Math.max(0, serverMs - haz.ts)
	if (ms > ROCKET_LIFE_MS) return null
	if (Number.isFinite(haz.until) && haz.until !== null && serverMs >= haz.until) return null
	const t = ms / 1000
	const k = T.scale ?? 1
	const s = P.s0 + P.dir * ROCKET_SPEED * k * t
	if (!T.closed && (s < 0 || s > T.total)) return null
	const c = pointAt(T, s)
	const fade = Math.max(0, 1 - t / ROCKET_BLEND_S)
	const [lx, lz] = leftNormal(c.ux, c.uz)
	return {
		x: c.x + lx * P.lat * fade,
		y: c.y + P.up * fade + ROCKET_HOVER * k,
		z: c.z + lz * P.lat * fade,
		yaw: yawFromDir(c.ux * P.dir, c.uz * P.dir),
		t,
	}
}
