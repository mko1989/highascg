'use strict'

/**
 * WO-1074 — RC car game: plan (x, z) geometry helpers shared by the track generator and `validateTrack` (pure). Plan
 * points are [x, z]; 3D track points [x, y, z] go through `plan()` first.
 */

const TAU = Math.PI * 2

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** 3D track points → plan points [x, z]. */
const plan = (pts) => pts.map((p) => [p[0], p[2]])

/** Length of a plan polyline; closed adds the last → first segment. */
function polyLength(pts, closed = true) {
	let L = 0
	for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i])
	if (closed && pts.length > 1) L += dist(pts[pts.length - 1], pts[0])
	return L
}

/** Cumulative plan arc length at each point (s[0] = 0) of a closed polyline, plus the total. */
function arcLengths(pts) {
	const s = [0]
	for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + dist(pts[i - 1], pts[i]))
	return { s, total: s[s.length - 1] + dist(pts[pts.length - 1], pts[0]) }
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

/** Projection of p on segment ab → { t (clamped 0…1), u (unclamped), d (distance to the clamped point) }. */
function project(p, a, b) {
	const dx = b[0] - a[0], dz = b[1] - a[1]
	const l2 = dx * dx + dz * dz
	const u = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2 : 0
	const t = Math.max(0, Math.min(1, u))
	return { t, u, d: Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz) }
}

const pointSegDist = (p, a, b) => project(p, a, b).d

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

const inRect = (x, z, r) => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]

/** Distance from segment ab to rect r (0 when it touches or crosses it). */
function segRectDist(a, b, r) {
	if (pointRectDist(a, r) === 0 || pointRectDist(b, r) === 0) return 0
	const c = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]
	let best = Math.min(pointRectDist(a, r), pointRectDist(b, r))
	for (let i = 0; i < 4; i++) best = Math.min(best, segSegDist(a, b, c[i], c[(i + 1) % 4]))
	return best
}

/** Rect r minus rect h → up to four rects (r unchanged when they do not overlap). */
function rectMinus(r, h) {
	if (h[0] >= r[2] || h[2] <= r[0] || h[1] >= r[3] || h[3] <= r[1]) return [r]
	const out = []
	if (h[0] > r[0]) out.push([r[0], r[1], h[0], r[3]])
	if (h[2] < r[2]) out.push([h[2], r[1], r[2], r[3]])
	const x0 = Math.max(r[0], h[0]), x1 = Math.min(r[2], h[2])
	if (h[1] > r[1]) out.push([x0, r[1], x1, h[1]])
	if (h[3] < r[3]) out.push([x0, h[3], x1, r[3]])
	return out
}

/** Driving direction → yaw (rotation about +Y; yaw 0 faces −Z). */
const yawOf = (dx, dz) => Math.atan2(-dx, -dz)

function angleDiff(a, b) {
	let d = (a - b) % TAU
	if (d > Math.PI) d -= TAU
	if (d < -Math.PI) d += TAU
	return Math.abs(d)
}

function bbox(pts) {
	const b = [Infinity, Infinity, -Infinity, -Infinity]
	for (const [x, z] of pts) {
		if (x < b[0]) b[0] = x
		if (z < b[1]) b[1] = z
		if (x > b[2]) b[2] = x
		if (z > b[3]) b[3] = z
	}
	return b
}

/**
 * Overlap zones of the road with itself (pairs of non-neighbouring segments closer than the width), grouped. `skip(i, j)`
 * drops a pair (a bridge: one ribbon well above the other).
 */
function selfContacts(pts, width, maxZones = 1, skip = null) {
	const n = pts.length
	const L = polyLength(pts)
	const window = Math.max(3, Math.ceil((Math.PI * width) / (L / n)))
	const pairs = []
	let crossings = 0
	const bx = pts.map((a, i) => {
		const b = pts[(i + 1) % n]
		return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]
	})
	for (let i = 0; i < n; i++) {
		const a = pts[i], b = pts[(i + 1) % n]
		for (let j = i + 1; j < n; j++) {
			const sep = Math.min(j - i, n - (j - i))
			if (sep <= window) continue
			const q = bx[j], p = bx[i]
			if (q[0] > p[2] + width || q[2] < p[0] - width || q[1] > p[3] + width || q[3] < p[1] - width) continue
			const c = pts[j], d = pts[(j + 1) % n]
			if (skip && segSegDist(a, b, c, d) < width - 1e-9 && skip(i, j)) continue
			if (segsCross(a, b, c, d)) crossings++
			if (segSegDist(a, b, c, d) < width - 1e-9) pairs.push([i, j])
			if ((maxZones === 0 && pairs.length) || pairs.length > 2000) return { zones: Infinity, crossings, pairs }
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
	return { zones: new Set(pairs.map((_, k) => root(k))).size, crossings, pairs }
}

module.exports = {
	TAU,
	dist,
	plan,
	polyLength,
	arcLengths,
	resampleClosed,
	circumradius,
	project,
	segRectDist,
	pointRectDist,
	inRect,
	rectMinus,
	yawOf,
	angleDiff,
	bbox,
	selfContacts,
}
