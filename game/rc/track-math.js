/**
 * Track maths for the RC game (WO-1074, contract v2 §2.1) — pure, no DOM, no three.js (node-testable).
 *
 * Frame: metres, X = stage left, Z = towards the audience, Y up. A v2 track has a 3D centre line
 * `points: [[x, y, z], …]` (y = driving surface height) plus `ramps`, `drops`, `pads`, `boxes`. v1 tracks
 * (`[[x, z], …]` + `track.y`) are converted on load by `normalizeTrack()`.
 *
 * `prepareTrack()` adds segment tables once; every other function takes the prepared track. The prepared track keeps
 * `pts` as PLAN points [x, z] (what every 2D consumer wants) and the heights in `ys`.
 * Ribbon parts that overlap in plan (a ramp beside / above another part, a ledge above its landing) are told apart by
 * height: pass the car's y to `nearestOnTrack()` / `gateCrossing()`.
 * §3 toy scale: `prepareTrack(track, scale)` stores `T.scale`; every length tolerance here (gate window, height slack,
 * cliff, grid fallback) is its scale-1 value × T.scale. Tracks of up to 2500 points: whole-track nearest searches go
 * through a plan segment grid (seg-grid.js, same answer as the full scan).
 */
import { buildSegGrid, ringSearch } from './seg-grid.js'
import { validScale } from './scale.js'

/** Gate half-length beyond the asphalt edge — a car cutting the corner slightly off the surface still counts.
 * (These are the scale-1 values; a prepared track applies them × T.scale.) */
export const GATE_MARGIN = 1.5
/** A crossing counts only if the motion is within ~60° of the track direction at the gate. */
const GATE_MIN_ALIGN = 0.5
/** A gate counts for a car between GATE_BELOW under and GATE_ABOVE over the centre line there (airborne landings). */
export const GATE_BELOW = 1.0
export const GATE_ABOVE = 1.3
/** Nearest-point search: vertical slack before the height difference starts to count, and its weight per metre. */
export const Y_SLACK = 0.6
const Y_WEIGHT = 4
/** Whole-track searches use the segment grid from this many segments on (below it the plain scan is as fast). */
export const GRID_MIN_SEGS = 160

const num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d)
const optNum = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/**
 * Contract v2 shape for any server track (v1 or v2): 3D points, grid slots with y (null = take the ribbon's), and
 * `ramps` / `decks` (§2.7) / `drops` / `pads` / `boxes` (missing = none, malformed entries dropped).
 */
export function normalizeTrack(track) {
	const t = track && typeof track === 'object' ? track : {}
	const baseY = num(t.y)
	const points = (Array.isArray(t.points) ? t.points : [])
		.filter((p) => Array.isArray(p) && p.length >= 2)
		.map((p) => (p.length >= 3 ? [num(p[0]), num(p[1]), num(p[2])] : [num(p[0]), baseY, num(p[1])]))
	const n = points.length
	const idx = (v) => Number.isInteger(v) && v >= 0 && v < n
	const objs = (a) => (Array.isArray(a) ? a.filter((o) => o && typeof o === 'object') : [])
	return {
		...t,
		points,
		grid: objs(t.grid).map((g) => ({ x: num(g.x), y: optNum(g.y), z: num(g.z), yaw: num(g.yaw) })),
		ramps: objs(t.ramps)
			.filter((r) => idx(r.from) && idx(r.to) && r.from !== r.to)
			.map((r) => ({ from: r.from, to: r.to })),
		decks: objs(t.decks)
			.filter((r) => idx(r.from) && idx(r.to) && r.from !== r.to)
			.map((r) => ({ from: r.from, to: r.to })),
		drops: objs(t.drops)
			.filter((d) => idx(d.at) && idx(d.land) && d.at !== d.land)
			.map((d) => ({ at: d.at, land: d.land })),
		pads: objs(t.pads)
			.filter((p) => Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.z)))
			.map((p) => ({ x: num(p.x), y: optNum(p.y), z: num(p.z), yaw: num(p.yaw) })),
		boxes: objs(t.boxes)
			.filter((b) => b.id != null && Number.isFinite(Number(b.x)) && Number.isFinite(Number(b.z)))
			.map((b) => ({ id: b.id, x: num(b.x), y: optNum(b.y), z: num(b.z) })),
	}
}

/** Point indices i..j (forward, wrapping on closed tracks), segment indices i..j−1. */
function forEachSeg(from, to, n, closed, fn) {
	if (to > from) for (let i = from; i < to; i++) fn(i)
	else if (closed) for (let i = from; i !== to; i = (i + 1) % n) fn(i)
}

/**
 * @param {object} track contract Track (v1 or v2)
 * @param {number} [scale] §3 toy scale (the scene's `scale`; default: the track's own `scale` field, else 1)
 * @returns {object} prepared track (the normalized fields plus tables)
 */
export function prepareTrack(track, scale) {
	const k = validScale(scale ?? track?.scale)
	const N = normalizeTrack(track)
	const pts = N.points.map((p) => [p[0], p[2]])
	const ys = N.points.map((p) => p[1])
	const n = pts.length
	const closed = N.closed !== false
	const segCount = closed ? n : Math.max(0, n - 1)
	const segs = []
	let s = 0
	for (let i = 0; i < segCount; i++) {
		const j = (i + 1) % n
		const dx = pts[j][0] - pts[i][0]
		const dz = pts[j][1] - pts[i][1]
		const len = Math.hypot(dx, dz) || 1e-9
		segs.push({
			ax: pts[i][0],
			az: pts[i][1],
			ay: ys[i],
			dx,
			dz,
			dy: ys[j] - ys[i],
			len,
			ux: dx / len,
			uz: dz / len,
			s0: s,
		})
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
	/* per-segment kinds: ramp (built wedge), gap (between a ledge and its landing), step (the ledge itself) */
	const segRamp = new Uint8Array(segCount)
	const segGap = new Uint8Array(segCount)
	const segStep = new Uint8Array(segCount)
	for (const r of N.ramps) forEachSeg(r.from, r.to, n, closed, (i) => (segRamp[i] = 1))
	/* §2.7: deck segments, and slab ramps (a ramp joining two decks: on pillars, no skirts) */
	const segDeck = new Uint8Array(segCount)
	const segSlab = new Uint8Array(segCount)
	for (const d of N.decks) forEachSeg(d.from, d.to, n, closed, (i) => (segDeck[i] = 1))
	for (const r of N.ramps) {
		if (N.decks.some((d) => d.to === r.from) && N.decks.some((d) => d.from === r.to))
			forEachSeg(r.from, r.to, n, closed, (i) => (segSlab[i] = 1))
	}
	for (const d of N.drops) {
		forEachSeg(d.at, d.land, n, closed, (i) => (segGap[i] = 1))
		if (d.at < segCount) segStep[d.at] = 1
	}
	segs.forEach((g, i) => {
		if (Math.abs(g.dy) > 0.5 * k && Math.abs(g.dy) > g.len * 0.7) segStep[i] = 1 // a cliff in the centre line
	})
	const width = Number(N.width) > 0 ? Number(N.width) : 3 * k
	let checkpoints = Array.isArray(N.checkpoints)
		? N.checkpoints.filter((i) => Number.isInteger(i) && i >= 0 && i < n)
		: []
	if (!checkpoints.length) checkpoints = [0]
	const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, minY: Infinity, maxY: -Infinity }
	pts.forEach((p, i) => {
		box.minX = Math.min(box.minX, p[0])
		box.maxX = Math.max(box.maxX, p[0])
		box.minZ = Math.min(box.minZ, p[1])
		box.maxZ = Math.max(box.maxZ, p[1])
		box.minY = Math.min(box.minY, ys[i])
		box.maxY = Math.max(box.maxY, ys[i])
	})
	const T = {
		...N,
		scale: k,
		gateMargin: GATE_MARGIN * k,
		gateBelow: GATE_BELOW * k,
		gateAbove: GATE_ABOVE * k,
		ySlack: Y_SLACK * k,
		y: ys[checkpoints[0]] ?? 0, // height of the start line (v1 consumers)
		width,
		half: width / 2,
		closed,
		pts,
		ys,
		n,
		segs,
		segRamp,
		segDeck,
		segSlab,
		segGap,
		segStep,
		total,
		tangents,
		cumS,
		checkpoints,
		cpS: checkpoints.map((i) => cumS[i]),
		box,
		/* plan segment grid for whole-track searches (long §3 tracks); null on short tracks */
		sgrid: segCount >= GRID_MIN_SEGS ? buildSegGrid(segs, width) : null,
	}
	/* pads / boxes / grid without a y sit on the ribbon */
	const yAt = (x, z) => nearestOnTrack(T, x, z).py
	T.pads = N.pads.map((p) => ({ ...p, y: p.y ?? yAt(p.x, p.z) }))
	T.boxes = N.boxes.map((b) => ({ ...b, y: b.y ?? yAt(b.x, b.z) + 0.5 * k }))
	T.grid = N.grid
	return T
}

/** Vertical mismatch (m) of a car at height y against segment i at parameter t (0 inside the slack). */
function vMiss(T, i, t, y) {
	const g = T.segs[i]
	const py = g.ay + g.dy * t
	let d
	if (T.segGap[i]) {
		/* between a ledge and its landing: anywhere from just under the lower end up to the higher end */
		const lo = Math.min(g.ay, g.ay + g.dy) - 0.3 * (T.scale ?? 1)
		const hi = Math.max(g.ay, g.ay + g.dy)
		d = y < lo ? lo - y : y > hi ? y - hi : 0
	} else d = Math.abs(y - py)
	return Math.max(0, d - (T.ySlack ?? Y_SLACK))
}

/**
 * Closest point on the centre line (3D-aware when `y` is given: plan distance + a penalty for height mismatch, so a car
 * in the hall is matched to the hall part, not to the stage part right above it in plan).
 * @param {object} T prepared track
 * @param {number} x
 * @param {number} z
 * @param {number} [hint] segment to search around (−1 = whole track)
 * @param {number} [win] segments either side of the hint
 * @param {number|null} [y] car height (null = plan only)
 * @returns {{ seg: number, t: number, px: number, py: number, pz: number, dist: number, vmiss: number, score: number, s: number, side: number }}
 */
export function nearestOnTrack(T, x, z, hint = -1, win = 6, y = null) {
	const m = T.segs.length
	let best = { seg: 0, t: 0, px: x, py: T.ys?.[0] ?? 0, pz: z, dist: Infinity, vmiss: 0, score: Infinity, s: 0, side: 0 }
	if (!m) return best
	const scanAll = !(hint >= 0) || win * 2 + 1 >= m
	const count = scanAll ? m : win * 2 + 1
	const start = scanAll ? 0 : hint - win
	const hasY = y !== null && y !== undefined && Number.isFinite(y)
	const grid = scanAll && T.sgrid
	const visit = (i) => {
		const g = T.segs[i]
		let t = ((x - g.ax) * g.dx + (z - g.az) * g.dz) / (g.len * g.len)
		t = t < 0 ? 0 : t > 1 ? 1 : t
		const px = g.ax + g.dx * t
		const pz = g.az + g.dz * t
		const d = Math.hypot(x - px, z - pz)
		const vm = hasY ? vMiss(T, i, t, y) : 0
		const score = d + vm * Y_WEIGHT
		if (score < best.score || (grid && score === best.score && i < best.seg)) {
			/* side: + = left of the driving direction (left normal of (ux, uz) is (uz, −ux), see leftNormal) */
			const side = Math.sign((x - px) * g.uz - (z - pz) * g.ux) || 0
			best = { seg: i, t, px, py: g.ay + g.dy * t, pz, dist: d, vmiss: vm, score, s: g.s0 + g.len * t, side }
		}
	}
	/* whole track: the segment grid gives the full scan's answer without reading every segment */
	if (grid) {
		ringSearch(grid, x, z, visit, () => best.score)
		return best
	}
	for (let k = 0; k < count; k++) {
		let i = start + k
		if (!scanAll) {
			if (T.closed) i = ((i % m) + m) % m
			else if (i < 0 || i >= m) continue
		}
		visit(i)
	}
	return best
}

/** Nearest with a hint, falling back to a whole-track scan when the windowed answer is poor. */
export function nearestHinted(T, x, z, hint, y = null) {
	const a = nearestOnTrack(T, x, z, hint, 8, y)
	if (hint >= 0 && a.score > T.half + 1.5 * (T.scale ?? 1)) {
		const b = nearestOnTrack(T, x, z, -1, 6, y)
		if (b.score < a.score) return b
	}
	return a
}

/** Left-hand normal of a direction (driving along (ux, uz), the left side is (uz, −ux) in this Y-up frame). */
export function leftNormal(ux, uz) {
	return [uz, -ux]
}

/** True when (x, z[, y]) is on the ribbon (within width/2 of the centre line, at its height when y is given). */
export function isOnTrack(T, x, z, hint = -1, y = null) {
	const n = nearestOnTrack(T, x, z, hint, 6, y)
	return n.dist <= T.half && n.vmiss === 0
}

/** Point (with height) + plan direction at arc length s (wraps on closed tracks). */
export function pointAt(T, s) {
	const m = T.segs.length
	if (!m) return { x: 0, y: 0, z: 0, ux: 0, uz: -1, seg: 0 }
	const ss = T.closed ? ((s % T.total) + T.total) % T.total : Math.max(0, Math.min(T.total, s))
	let lo = 0
	let hi = m - 1
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1
		if (T.segs[mid].s0 <= ss) lo = mid
		else hi = mid - 1
	}
	const g = T.segs[lo]
	const t = Math.max(0, Math.min(1, (ss - g.s0) / g.len))
	return { x: g.ax + g.dx * t, y: g.ay + g.dy * t, z: g.az + g.dz * t, ux: g.ux, uz: g.uz, seg: lo }
}

/** Yaw (contract convention: yaw 0 faces −Z, forward = (−sin yaw, −cos yaw)) that faces along direction (ux, uz). */
export function yawFromDir(ux, uz) {
	return Math.atan2(-ux, -uz)
}

/**
 * Gate of checkpoint k: centre (with height), track direction and half-length.
 * @returns {{ x: number, y: number, z: number, tx: number, tz: number, halfLen: number }}
 */
export function gateOf(T, k) {
	const idx = T.checkpoints[k]
	const p = T.pts[idx]
	const tg = T.tangents[idx]
	return { x: p[0], y: T.ys[idx], z: p[1], tx: tg[0], tz: tg[1], halfLen: T.half + (T.gateMargin ?? GATE_MARGIN) }
}

/**
 * Did the move A → B cross checkpoint k's gate? With heights (ay, by) a crossing far above / below the gate (the stage
 * part of the track over a hall gate) does not count.
 * @returns {number} +1 forward (driving direction), −1 backwards, 0 no crossing
 */
export function gateCrossing(T, k, ax, az, bx, bz, ay = null, by = null) {
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
	if (Number.isFinite(ay) && Number.isFinite(by) && ay !== null && by !== null) {
		const cy = ay + (by - ay) * u
		if (cy < g.y - (T.gateBelow ?? GATE_BELOW) || cy > g.y + (T.gateAbove ?? GATE_ABOVE)) return 0
	}
	const len = Math.hypot(bx - ax, bz - az)
	if (len < 1e-9) return 0
	const align = (db - da) / len
	if (dir === 1 && align < GATE_MIN_ALIGN) return 0
	if (dir === -1 && -align < GATE_MIN_ALIGN) return 0
	return dir
}

/** Respawn pose at checkpoint k: on the centre line, at its height, facing along the track. */
export function respawnPose(T, k) {
	const g = gateOf(T, Math.max(0, Math.min(T.checkpoints.length - 1, k | 0)))
	return { x: g.x, y: g.y, z: g.z, yaw: yawFromDir(g.tx, g.tz) }
}

/** Grid slot pose (falls back to staggered slots behind the start line when the track has no grid). */
export function gridPose(T, slot) {
	const i = Math.max(0, slot | 0)
	const g = T.grid[i % Math.max(1, T.grid.length)]
	if (g && T.grid.length) {
		const x = Number(g.x) || 0
		const z = Number(g.z) || 0
		const y = Number.isFinite(g.y) && g.y !== null ? g.y : nearestOnTrack(T, x, z).py
		return { x, y, z, yaw: Number(g.yaw) || 0 }
	}
	const start = gateOf(T, 0)
	const k = T.scale ?? 1
	const back = (1.4 + Math.floor(i / 2) * 1.1) * k
	const lat = (i % 2 ? -1 : 1) * Math.min(T.half * 0.5, 0.9 * k)
	const [lx, lz] = leftNormal(start.tx, start.tz)
	const x = start.x - start.tx * back + lx * lat
	const z = start.z - start.tz * back + lz * lat
	return { x, y: nearestOnTrack(T, x, z, -1, 6, start.y).py, z, yaw: yawFromDir(start.tx, start.tz) }
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
