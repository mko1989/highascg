'use strict'

/**
 * WO-1074 — RC car game: track geometry helpers + `validateTrack` (pure). The generator (rc-tracks.js) and the smokes
 * use the same check, so an emitted track is always one this function accepts. Frame: Godot / three.js, metres,
 * a track lives on its floor plane: points are [x, z].
 */

const CAR_HEIGHT = 0.6 // obstacles matter between floor.y + FLOOR_EPS and floor.y + CAR_HEIGHT
const FLOOR_EPS = 0.02
const MIN_RADIUS = 1.2
const MIN_POINTS = 60
const MAX_POINTS = 200
const GRID_SLOTS = 10
const CAR_CLEAR = 0.26 // half the car's diagonal (0.45 × 0.25 m)

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
const finite = (v) => typeof v === 'number' && Number.isFinite(v)

/** Length of a polyline; closed adds the last → first segment. */
function polyLength(pts, closed = true) {
	let L = 0
	for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i])
	if (closed && pts.length > 1) L += dist(pts[pts.length - 1], pts[0])
	return L
}

/** `n` points evenly spaced by arc length along the closed polyline `dense`, starting at dense[0]. */
function resampleClosed(dense, n) {
	const m = dense.length
	const cum = [0]
	for (let i = 1; i <= m; i++) cum.push(cum[i - 1] + dist(dense[i - 1], dense[i % m]))
	const L = cum[m]
	const out = []
	let seg = 0
	for (let k = 0; k < n; k++) {
		const s = (k * L) / n
		while (seg < m - 1 && cum[seg + 1] < s) seg++
		const a = dense[seg]
		const b = dense[(seg + 1) % m]
		const len = cum[seg + 1] - cum[seg] || 1
		const f = (s - cum[seg]) / len
		out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f])
	}
	return out
}

/** Circumradius of a triangle (Infinity when collinear). */
function circumradius(a, b, c) {
	const ab = dist(a, b), bc = dist(b, c), ca = dist(c, a)
	const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
	return cross < 1e-12 ? Infinity : (ab * bc * ca) / (2 * cross)
}

function pointSegDist(p, a, b) {
	const dx = b[0] - a[0], dz = b[1] - a[1]
	const l2 = dx * dx + dz * dz
	const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2)) : 0
	return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz)
}

const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

/** Proper crossing of segments ab and cd (shared endpoints / touching do not count). */
function segsCross(a, b, c, d) {
	const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b)
	return o1 * o2 < 0 && o3 * o4 < 0
}

function segSegDist(a, b, c, d) {
	if (segsCross(a, b, c, d)) return 0
	return Math.min(pointSegDist(a, c, d), pointSegDist(b, c, d), pointSegDist(c, a, b), pointSegDist(d, a, b))
}

/** Distance from a point to an axis-aligned rect [minX, minZ, maxX, maxZ] (0 inside). */
function pointRectDist(p, r) {
	const dx = Math.max(r[0] - p[0], 0, p[0] - r[2])
	const dz = Math.max(r[1] - p[1], 0, p[1] - r[3])
	return Math.hypot(dx, dz)
}

/** Distance from segment ab to rect r (0 when it touches or crosses it). */
function segRectDist(a, b, r) {
	if (pointRectDist(a, r) === 0 || pointRectDist(b, r) === 0) return 0
	const c = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]
	let best = Math.min(pointRectDist(a, r), pointRectDist(b, r))
	for (let i = 0; i < 4; i++) best = Math.min(best, segSegDist(a, b, c[i], c[(i + 1) % 4]))
	return best
}

/** Obstacles (3D AABBs) a car on a floor at `y` can hit, as XZ rects. */
function obstacleRectsAt(obstacles, y) {
	const out = []
	for (const o of obstacles || []) {
		if (!o || !Array.isArray(o.min) || !Array.isArray(o.max)) continue
		if (o.max[1] > y + FLOOR_EPS && o.min[1] < y + CAR_HEIGHT) out.push([o.min[0], o.min[2], o.max[0], o.max[2]])
	}
	return out
}

/** Driving direction → yaw (rotation about +Y; yaw 0 faces −Z). */
const yawOf = (dx, dz) => Math.atan2(-dx, -dz)

function angleDiff(a, b) {
	let d = (a - b) % (2 * Math.PI)
	if (d > Math.PI) d -= 2 * Math.PI
	if (d < -Math.PI) d += 2 * Math.PI
	return Math.abs(d)
}

/** Overlap zones of the road with itself (pairs of non-neighbouring segments closer than the width), grouped. */
function selfContacts(pts, width, maxZones = 1) {
	const n = pts.length
	const L = polyLength(pts)
	const window = Math.max(3, Math.ceil((Math.PI * width) / (L / n)))
	const pairs = []
	let crossings = 0
	for (let i = 0; i < n; i++) {
		const a = pts[i], b = pts[(i + 1) % n]
		for (let j = i + 1; j < n; j++) {
			const sep = Math.min(j - i, n - (j - i))
			if (sep <= window) continue
			const c = pts[j], d = pts[(j + 1) % n]
			if (segsCross(a, b, c, d)) crossings++
			if (segSegDist(a, b, c, d) < width - 1e-9) pairs.push([i, j])
			if ((maxZones === 0 && pairs.length) || pairs.length > 2000) return { zones: Infinity, crossings }
		}
	}
	const cyc = (x, y) => Math.min(Math.abs(x - y), n - Math.abs(x - y))
	const zone = pairs.map((_, k) => k)
	const root = (k) => (zone[k] === k ? k : (zone[k] = root(zone[k])))
	for (let p = 0; p < pairs.length; p++) {
		for (let q = p + 1; q < pairs.length; q++) {
			const [i, j] = pairs[p], [k, l] = pairs[q]
			const near = (cyc(i, k) <= window && cyc(j, l) <= window) || (cyc(i, l) <= window && cyc(j, k) <= window)
			if (near) zone[root(p)] = root(q)
		}
	}
	return { zones: new Set(pairs.map((_, k) => root(k))).size, crossings }
}

/**
 * Is `track` drivable on `scene` ({ floors, obstacles })? → { ok, errors[] }. `opts.maxCrossings` defaults to 1 for a
 * figure-eight (id contains "eight") and 0 otherwise.
 */
function validateTrack(track, scene, opts = {}) {
	const errors = []
	const fail = (m) => (errors.push(m), { ok: false, errors })
	if (!track || typeof track !== 'object') return fail('no track')
	if (typeof track.id !== 'string' || !track.id) return fail('no id')
	const pts = track.points
	if (!Array.isArray(pts) || pts.length < MIN_POINTS || pts.length > MAX_POINTS) return fail(`points: ${pts?.length} (60–200)`)
	if (!pts.every((p) => Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]))) return fail('non-finite point')
	if (track.closed !== true) return fail('not closed')
	if (dist(pts[0], pts[pts.length - 1]) < 1e-6) return fail('last point repeats the first')
	const width = track.width
	if (!finite(width) || width < 1 || width > 5) return fail(`width ${width}`)
	const floor = (scene?.floors || []).find((f) => f && f.id === track.floor)
	if (!floor) return fail(`no floor "${track.floor}"`)
	if (!finite(track.y) || Math.abs(track.y - floor.y) > 1e-6) return fail('track.y is not its floor\'s y')
	const n = pts.length
	const L = polyLength(pts)
	if (!finite(track.length) || Math.abs(track.length - L) > Math.max(0.05, L * 0.01)) return fail(`length ${track.length} ≠ ${L.toFixed(2)}`)
	const mean = L / n
	for (let i = 0; i < n; i++) {
		const s = dist(pts[i], pts[(i + 1) % n])
		if (s < mean * 0.9 || s > mean * 1.1) return fail(`uneven spacing at ${i}`)
	}
	const half = width / 2
	const r = floor.rect
	for (const p of pts) {
		if (p[0] < r[0] + half || p[0] > r[2] - half || p[1] < r[1] + half || p[1] > r[3] - half) return fail('outside its floor')
	}
	const obs = obstacleRectsAt(scene.obstacles, floor.y)
	const box = [Infinity, Infinity, -Infinity, -Infinity]
	for (const p of pts) {
		box[0] = Math.min(box[0], p[0] - half); box[1] = Math.min(box[1], p[1] - half)
		box[2] = Math.max(box[2], p[0] + half); box[3] = Math.max(box[3], p[1] + half)
	}
	const near = obs.filter((o) => o[2] >= box[0] && o[0] <= box[2] && o[3] >= box[1] && o[1] <= box[3])
	for (let i = 0; i < n && near.length; i++) {
		const a = pts[i], b = pts[(i + 1) % n]
		for (const o of near) if (segRectDist(a, b, o) < half - 1e-9) return fail(`obstacle within width/2 at ${i}`)
	}
	for (const k of [1, 2]) {
		for (let i = 0; i < n; i++) {
			if (circumradius(pts[(i - k + n) % n], pts[i], pts[(i + k) % n]) < MIN_RADIUS - 1e-6) return fail(`turn radius < 1.2 m at ${i}`)
		}
	}
	const maxX = opts.maxCrossings ?? (/eight/.test(track.id) ? 1 : 0)
	const sc = selfContacts(pts, width, maxX)
	if (sc.zones > maxX || sc.crossings > maxX) return fail(`self-intersection (${sc.zones} zones, ${sc.crossings} crossings)`)
	const cp = track.checkpoints
	if (!Array.isArray(cp) || cp.length < 3 || cp[0] !== 0) return fail('checkpoints must start at 0 (≥ 3)')
	for (let i = 0; i < cp.length; i++) {
		if (!Number.isInteger(cp[i]) || cp[i] < 0 || cp[i] >= n || (i && cp[i] - cp[i - 1] < 2)) return fail('checkpoints not increasing indices')
	}
	const g = track.grid
	if (!Array.isArray(g) || g.length !== GRID_SLOTS) return fail('grid must have 10 slots')
	const t0 = [pts[1][0] - pts[n - 1][0], pts[1][1] - pts[n - 1][1]]
	for (let k = 0; k < g.length; k++) {
		const s = g[k]
		if (!s || !finite(s.x) || !finite(s.z) || !finite(s.yaw)) return fail(`grid ${k} not finite`)
		const p = [s.x, s.z]
		if (s.x < r[0] + CAR_CLEAR || s.x > r[2] - CAR_CLEAR || s.z < r[1] + CAR_CLEAR || s.z > r[3] - CAR_CLEAR) return fail(`grid ${k} off the floor`)
		if (obs.some((o) => pointRectDist(p, o) < CAR_CLEAR)) return fail(`grid ${k} in an obstacle`)
		if ((p[0] - pts[0][0]) * t0[0] + (p[1] - pts[0][1]) * t0[1] >= 0) return fail(`grid ${k} not behind the start line`)
		let facing = false
		for (let i = 0; i < n && !facing; i++) {
			const a = pts[i], b = pts[(i + 1) % n]
			facing = pointSegDist(p, a, b) <= half + 0.05 && angleDiff(s.yaw, yawOf(b[0] - a[0], b[1] - a[1])) <= 0.35
		}
		if (!facing) return fail(`grid ${k} not on the road facing the driving direction`)
		for (let j = 0; j < k; j++) if (dist(p, [g[j].x, g[j].z]) < 0.5) return fail(`grid ${k} overlaps ${j}`)
	}
	return { ok: true, errors }
}

module.exports = {
	CAR_HEIGHT,
	GRID_SLOTS,
	validateTrack,
	polyLength,
	resampleClosed,
	obstacleRectsAt,
	yawOf,
}
