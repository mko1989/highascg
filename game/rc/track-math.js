/**
 * Track maths for the RC game (WO-1074) — pure, no DOM, no three.js (node-testable).
 *
 * Frame: metres, X = stage left, Z = towards the audience, Y up. A track is the contract's `Track`
 * ({ points: [[x, z], …], width, y, closed, checkpoints: [point indices], grid }).
 * `prepareTrack()` adds segment tables once; every other function takes the prepared track.
 */

/** Gate half-length beyond the asphalt edge — a car cutting the corner slightly off the surface still counts. */
export const GATE_MARGIN = 1.5
/** A crossing counts only if the motion is within ~60° of the track direction at the gate. */
const GATE_MIN_ALIGN = 0.5

/**
 * @param {object} track contract Track
 * @returns {object} prepared track (the original fields plus tables)
 */
export function prepareTrack(track) {
	const pts = (track.points || []).map((p) => [Number(p[0]) || 0, Number(p[1]) || 0])
	const n = pts.length
	const closed = track.closed !== false
	const segCount = closed ? n : Math.max(0, n - 1)
	const segs = []
	let s = 0
	for (let i = 0; i < segCount; i++) {
		const a = pts[i]
		const b = pts[(i + 1) % n]
		const dx = b[0] - a[0]
		const dz = b[1] - a[1]
		const len = Math.hypot(dx, dz) || 1e-9
		segs.push({ ax: a[0], az: a[1], dx, dz, len, ux: dx / len, uz: dz / len, s0: s })
		s += len
	}
	const total = s || 1e-9
	const tangents = pts.map((_, i) => {
		const sOut = segs[Math.min(i, segs.length - 1)]
		const sIn = closed ? segs[(i - 1 + segCount) % segCount] : segs[Math.max(0, i - 1)]
		if (!sOut || !sIn) return [0, -1]
		const tx = sOut.ux + sIn.ux
		const tz = sOut.uz + sIn.uz
		const l = Math.hypot(tx, tz)
		return l > 1e-6 ? [tx / l, tz / l] : [sOut.ux, sOut.uz]
	})
	const cumS = pts.map((_, i) => (i < segs.length ? segs[i].s0 : total))
	const width = Number(track.width) > 0 ? Number(track.width) : 2
	let checkpoints = Array.isArray(track.checkpoints) ? track.checkpoints.filter((i) => i >= 0 && i < n) : []
	if (!checkpoints.length) checkpoints = [0]
	const minX = Math.min(...pts.map((p) => p[0]))
	const maxX = Math.max(...pts.map((p) => p[0]))
	const minZ = Math.min(...pts.map((p) => p[1]))
	const maxZ = Math.max(...pts.map((p) => p[1]))
	return {
		...track,
		y: Number(track.y) || 0,
		width,
		half: width / 2,
		closed,
		pts,
		n,
		segs,
		total,
		tangents,
		cumS,
		checkpoints,
		cpS: checkpoints.map((i) => cumS[i]),
		box: { minX, maxX, minZ, maxZ },
		grid: Array.isArray(track.grid) ? track.grid : [],
	}
}

/**
 * Closest point on the centre line.
 * @param {object} T prepared track
 * @param {number} x
 * @param {number} z
 * @param {number} [hint] segment to search around (−1 = whole track)
 * @param {number} [win] segments either side of the hint
 * @returns {{ seg: number, t: number, px: number, pz: number, dist: number, s: number, side: number }}
 */
export function nearestOnTrack(T, x, z, hint = -1, win = 6) {
	const m = T.segs.length
	let best = { seg: 0, t: 0, px: x, pz: z, dist: Infinity, s: 0, side: 0 }
	if (!m) return best
	const scanAll = !(hint >= 0) || win * 2 + 1 >= m
	const count = scanAll ? m : win * 2 + 1
	const start = scanAll ? 0 : hint - win
	for (let k = 0; k < count; k++) {
		let i = start + k
		if (!scanAll) {
			if (T.closed) i = ((i % m) + m) % m
			else if (i < 0 || i >= m) continue
		}
		const g = T.segs[i]
		let t = ((x - g.ax) * g.dx + (z - g.az) * g.dz) / (g.len * g.len)
		t = t < 0 ? 0 : t > 1 ? 1 : t
		const px = g.ax + g.dx * t
		const pz = g.az + g.dz * t
		const d = Math.hypot(x - px, z - pz)
		if (d < best.dist) {
			/* side: + = left of the driving direction (direction (ux,uz), left normal (uz,−ux)… see leftNormal) */
			const side = Math.sign((x - px) * g.uz - (z - pz) * g.ux) || 0
			best = { seg: i, t, px, pz, dist: d, s: g.s0 + g.len * t, side }
		}
	}
	return best
}

/** Left-hand normal of a direction (driving along (ux, uz), the left side is (uz, −ux) in this Y-up frame). */
export function leftNormal(ux, uz) {
	return [uz, -ux]
}

/** True when (x, z) is on the asphalt (within width/2 of the centre line). */
export function isOnTrack(T, x, z, hint = -1) {
	return nearestOnTrack(T, x, z, hint).dist <= T.half
}

/** Point + direction at arc length s (wraps on closed tracks). */
export function pointAt(T, s) {
	const m = T.segs.length
	if (!m) return { x: 0, z: 0, ux: 0, uz: -1, seg: 0 }
	let ss = T.closed ? ((s % T.total) + T.total) % T.total : Math.max(0, Math.min(T.total, s))
	let lo = 0
	let hi = m - 1
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1
		if (T.segs[mid].s0 <= ss) lo = mid
		else hi = mid - 1
	}
	const g = T.segs[lo]
	const t = Math.max(0, Math.min(1, (ss - g.s0) / g.len))
	return { x: g.ax + g.dx * t, z: g.az + g.dz * t, ux: g.ux, uz: g.uz, seg: lo }
}

/** Yaw (contract convention: yaw 0 faces −Z, forward = (−sin yaw, −cos yaw)) that faces along direction (ux, uz). */
export function yawFromDir(ux, uz) {
	return Math.atan2(-ux, -uz)
}

/**
 * Gate of checkpoint k: centre, track direction and half-length.
 * @returns {{ x: number, z: number, tx: number, tz: number, halfLen: number }}
 */
export function gateOf(T, k) {
	const idx = T.checkpoints[k]
	const p = T.pts[idx]
	const tg = T.tangents[idx]
	return { x: p[0], z: p[1], tx: tg[0], tz: tg[1], halfLen: T.half + GATE_MARGIN }
}

/**
 * Did the move A → B cross checkpoint k's gate?
 * @returns {number} +1 forward (driving direction), −1 backwards, 0 no crossing
 */
export function gateCrossing(T, k, ax, az, bx, bz) {
	const g = gateOf(T, k)
	const da = (ax - g.x) * g.tx + (az - g.z) * g.tz
	const db = (bx - g.x) * g.tx + (bz - g.z) * g.tz
	let dir = 0
	if (da < 0 && db >= 0) dir = 1
	else if (da >= 0 && db < 0) dir = -1
	if (!dir) return 0
	const u = da / (da - db)
	const cx = ax + (bx - ax) * u
	const cz = az + (bz - az) * u
	const lateral = Math.abs((cx - g.x) * -g.tz + (cz - g.z) * g.tx)
	if (lateral > g.halfLen) return 0
	const len = Math.hypot(bx - ax, bz - az)
	if (len < 1e-9) return 0
	const align = (db - da) / len
	if (dir === 1 && align < GATE_MIN_ALIGN) return 0
	if (dir === -1 && -align < GATE_MIN_ALIGN) return 0
	return dir
}

/** Respawn pose at checkpoint k: on the centre line, facing along the track. */
export function respawnPose(T, k) {
	const g = gateOf(T, Math.max(0, Math.min(T.checkpoints.length - 1, k | 0)))
	return { x: g.x, z: g.z, yaw: yawFromDir(g.tx, g.tz) }
}

/** Grid slot pose (falls back to staggered slots behind the start line when the track has no grid). */
export function gridPose(T, slot) {
	const i = Math.max(0, slot | 0)
	const g = T.grid[i % Math.max(1, T.grid.length)]
	if (g && T.grid.length) return { x: Number(g.x) || 0, z: Number(g.z) || 0, yaw: Number(g.yaw) || 0 }
	const start = gateOf(T, 0)
	const back = 1.2 + Math.floor(i / 2) * 0.9
	const lat = (i % 2 ? -1 : 1) * Math.min(T.half * 0.5, 0.5)
	const [lx, lz] = leftNormal(start.tx, start.tz)
	return {
		x: start.x - start.tx * back + lx * lat,
		z: start.z - start.tz * back + lz * lat,
		yaw: yawFromDir(start.tx, start.tz),
	}
}

/**
 * Race progress in metres: completed laps × length + distance along the lap, kept consistent with the last checkpoint
 * (a car still behind the start line at lap 0 is slightly negative, not almost a full lap ahead).
 */
export function progressOf(T, lap, cp, s) {
	const ref = T.cpS[Math.max(0, Math.min(T.cpS.length - 1, cp | 0))] || 0
	let along = s
	if (T.closed) {
		while (along < ref - T.total / 2) along += T.total
		while (along >= ref + T.total / 2) along -= T.total
	}
	return (lap | 0) * T.total + along
}
