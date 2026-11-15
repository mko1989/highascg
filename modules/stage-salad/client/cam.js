/**
 * Cameras of Stage Salad (WO-1089 §11) — pure. Poses are { eye: [x, y, z], target: [x, y, z] } in world metres (real
 * scale). Player: behind and above the own slingshot (BACK m back, UP m above the hall floor) looking at the stage
 * front, turning with half the aim; after a shot it follows the vegetable for ≤ FOLLOW_S, then eases back. Spectator: a
 * wide stage camera from the back of the room.
 */

export const BACK = 2.6
export const UP = 1.9
export const FOLLOW_S = 1.6
export const LOOK_H = 1.0 // m above the stage floor: the presenter's middle
export const PAN = 0.5 // share of the aim's yaw offset the camera turns with

/** Behind the own slingshot. slot { p, yaw }, venue { front, stage }, yawOff (rad). */
export function slingCam(slot, venue, yawOff = 0) {
	const yaw = slot.yaw + yawOff * PAN
	const fx = -Math.sin(yaw), fz = -Math.cos(yaw)
	const p = slot.p
	const fc = venue.front.c
	const d = Math.max(4, Math.hypot(fc[0] - p[0], fc[2] - p[2]))
	return {
		eye: [p[0] - fx * BACK, p[1] + UP, p[2] - fz * BACK],
		target: [p[0] + fx * d, venue.stage.y + LOOK_H, p[2] + fz * d],
	}
}

/** Chasing a vegetable at pos with velocity vel (from behind, a little above). */
export function followCam(pos, vel) {
	let hx = vel[0], hz = vel[2]
	const L = Math.hypot(hx, hz)
	if (L < 0.2) (hx = 0), (hz = -1)
	else (hx /= L), (hz /= L)
	return {
		eye: [pos[0] - hx * 3.2, pos[1] + 1.1, pos[2] - hz * 3.2],
		target: [pos[0] + vel[0] * 0.15, pos[1] + vel[1] * 0.1, pos[2] + vel[2] * 0.15],
	}
}

/** How far the hall reaches from the stage front's centre along f (the room's back), m. */
export function roomDepth(venue) {
	const [x0, z0, x1, z1] = venue.hall.rect
	const c = venue.front.c, f = venue.front.f
	let t = Infinity
	if (f[0] > 1e-6) t = Math.min(t, (x1 - c[0]) / f[0])
	if (f[0] < -1e-6) t = Math.min(t, (x0 - c[0]) / f[0])
	if (f[1] > 1e-6) t = Math.min(t, (z1 - c[2]) / f[1])
	if (f[1] < -1e-6) t = Math.min(t, (z0 - c[2]) / f[1])
	return Number.isFinite(t) && t > 0 ? t : 15
}

/** The spectators' wide stage shot: from the back of the room (or as far as needed to frame the stage front). */
export function stageCam(venue, aspect = 16 / 9, fovDeg = 50) {
	const f = venue.front
	const tv = Math.tan((fovDeg * Math.PI) / 360) * Math.max(0.5, aspect)
	const need = (f.half * 1.25) / tv
	const d = Math.max(7, Math.min(roomDepth(venue) - 0.8, Math.max(need, 11)))
	const y = venue.stage.y + LOOK_H
	return {
		eye: [f.c[0] + f.f[0] * d, venue.hall.y + Math.min(5.5, Math.max(3.2, d * 0.28)), f.c[2] + f.f[1] * d],
		target: [f.c[0] - f.f[0] * 0.8, y, f.c[2] - f.f[1] * 0.8],
	}
}

/** Ease a pose towards another (exponential, time constant tau seconds); a far jump snaps. */
export function easePose(cur, want, dt, tau = 0.12, snap = Infinity) {
	if (!cur) return { eye: want.eye.slice(), target: want.target.slice() }
	const far = Math.hypot(cur.eye[0] - want.eye[0], cur.eye[2] - want.eye[2]) > snap
	const k = far ? 1 : 1 - Math.exp(-Math.max(0, dt) / tau)
	const mix = (a, b) => a.map((v, i) => v + (b[i] - v) * k)
	return { eye: mix(cur.eye, want.eye), target: mix(cur.target, want.target) }
}
