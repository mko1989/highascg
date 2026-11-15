/**
 * Cameras of Stage Skirmish (WO-1081 §9) — pure. Players: above the own soldier, looking down at PITCH_DEG from
 * HEIGHT_U up, from the audience side (+Z) towards upstage, so screen-up is −Z and screen-right is +X (the controls
 * are screen-relative in this frame). Spectators: the whole arena framed, or one player followed from a little higher.
 * Poses are { eye: [x, y, z], target: [x, y, z] } in world metres.
 */

export const PITCH_DEG = 64
export const HEIGHT_U = 9 // contract said 14: a soldier was 30 px at 720p; 9 gives about 47 px (lead, 15.11)
export const FOV_DEG = 40
/** How far the view leans towards the aim (u). */
export const LEAD_U = 1.6

/** Follow pose over (x, y, z) at scale s; `aim` = optional unit plan vector [dx, dz] to lean towards. */
export function followCam(x, y, z, s = 1, aim = null, heightU = HEIGHT_U, pitchDeg = PITCH_DEG) {
	const h = heightU * s
	const back = h / Math.tan((pitchDeg * Math.PI) / 180)
	const lx = aim ? aim[0] * LEAD_U * s : 0
	const lz = aim ? aim[1] * LEAD_U * s : 0
	const tx = x + lx
	const tz = z + lz
	return { eye: [tx, y + h, tz + back], target: [tx, y, tz] }
}

/** Frame the whole arena rect at floor height y for a viewport aspect (w / h) and vertical fov. */
export function arenaCam(rect, y, aspect = 16 / 9, fovDeg = FOV_DEG, pitchDeg = 70) {
	const [x0, z0, x1, z1] = rect
	const cx = (x0 + x1) / 2
	const cz = (z0 + z1) / 2
	const p = (pitchDeg * Math.PI) / 180
	const tv = Math.tan((fovDeg * Math.PI) / 360)
	const th = tv * Math.max(0.2, aspect)
	const dW = (x1 - x0) / 2 / th
	const dD = ((z1 - z0) * Math.sin(p)) / 2 / tv
	const d = Math.max(dW, dD) * 1.08
	return { eye: [cx, y + d * Math.sin(p), cz + d * Math.cos(p)], target: [cx, y, cz] }
}

/** Ease a pose towards another (exponential, time constant tau seconds); a far jump snaps. */
export function easePose(cur, want, dt, tau = 0.12, snap = Infinity) {
	if (!cur) return { eye: want.eye.slice(), target: want.target.slice() }
	const far = Math.hypot(cur.target[0] - want.target[0], cur.target[2] - want.target[2]) > snap
	const k = far ? 1 : 1 - Math.exp(-Math.max(0, dt) / tau)
	const mix = (a, b) => a.map((v, i) => v + (b[i] - v) * k)
	return { eye: mix(cur.eye, want.eye), target: mix(cur.target, want.target) }
}

/**
 * Screen point → plan point on the plane y = planeY for a pose (the mouse aim). ndc = [−1…1, −1…1] (y up).
 * @returns {[number, number]|null}
 */
export function screenToPlane(pose, ndc, aspect, fovDeg, planeY) {
	const [ex, ey, ez] = pose.eye
	let fx = pose.target[0] - ex
	let fy = pose.target[1] - ey
	let fz = pose.target[2] - ez
	const fl = Math.hypot(fx, fy, fz) || 1
	fx /= fl
	fy /= fl
	fz /= fl
	/* right = forward × up(0,1,0); up' = right × forward */
	let rx = -fz
	let rz = fx
	const rl = Math.hypot(rx, rz) || 1
	rx /= rl
	rz /= rl
	const ux = -rz * fy
	const uy = rz * fx - rx * fz
	const uz = rx * fy
	const tv = Math.tan((fovDeg * Math.PI) / 360)
	const dx = fx + rx * ndc[0] * tv * aspect + ux * ndc[1] * tv
	const dy = fy + uy * ndc[1] * tv
	const dz = fz + rz * ndc[0] * tv * aspect + uz * ndc[1] * tv
	if (dy > -1e-6) return null
	const t = (planeY - ey) / dy
	return [ex + dx * t, ez + dz * t]
}
