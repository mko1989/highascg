'use strict'

/**
 * WO-1074 §3 (toy scale) — the occupancy grid of one floor at toy height (pure). What blocks a toy car is only what
 * crosses the band floor.y + lo … floor.y + hi (live: 5 mm … 6 cm above the floor): legs, bases, walls, the stage side,
 * risers. A table top is a roof, not an obstacle. The grid covers the floor rect at `cell` (≈ 3 cm); a cell is blocked
 * when a drawn triangle crosses it inside the band (exact: the triangle is clipped to the band slab and its plan shadow
 * rasterised conservatively row by row — a long thin wall leaves no gaps), dilated by nothing.
 *
 * JSON (contract §3): { floor, y, x0, z0, cell, w, h, rle } — row-major, z rows from z0, x from x0; `rle` = run lengths
 * alternating FREE, BLOCKED, FREE … (starts with free, a leading 0 when the first cell is blocked); cell (i, j) covers
 * x0 + i·cell … +cell, z0 + j·cell … +cell.
 *
 * Queries (world metres): `blocked(x, z)`, `segNear(ax, az, bx, bz, r)` — the distance from the segment to the nearest
 * blocked cell when it is < r, else Infinity — and `clearance()` (the exact Euclidean distance transform, in metres from
 * each cell centre to the nearest blocked cell centre; the generator's map).
 */

/** An empty grid over `floor.rect` at `cell`; band [floor.y + lo, floor.y + hi]. */
function createOcc(floor, opts = {}) {
	const cell = opts.cell || 0.03
	const r = floor.rect
	const w = Math.max(1, Math.ceil((r[2] - r[0]) / cell - 1e-9)), h = Math.max(1, Math.ceil((r[3] - r[1]) / cell - 1e-9))
	const g = wrap({ floor: floor.id, y: floor.y, x0: r[0], z0: r[1], cell, w, h, bits: new Uint8Array(w * h) })
	g.lo = floor.y + (opts.lo ?? 0.005)
	g.hi = floor.y + (opts.hi ?? 0.06)
	return g
}

/** Sutherland–Hodgman: keep the part of polygon `P` ([[x, y, z]]) where sign · (p[k] − v) ≥ 0. */
function clip(P, k, v, sign) {
	const out = []
	for (let i = 0; i < P.length; i++) {
		const a = P[i], b = P[(i + 1) % P.length]
		const da = sign * (a[k] - v), db = sign * (b[k] - v)
		if (da >= 0) out.push(a)
		if ((da >= 0) !== (db >= 0)) {
			const t = da / (da - db)
			out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])
		}
	}
	return out
}

function wrap(O) {
	const { x0, z0, cell, w, h, bits } = O
	let edt = null
	/** Mark the plan shadow of polygon P (≥ 1 point) conservatively: per row, the x-extent of P ∩ that row's strip. */
	const fill = (P) => {
		let zmin = Infinity, zmax = -Infinity
		for (const p of P) (zmin = Math.min(zmin, p[2])), (zmax = Math.max(zmax, p[2]))
		const k0 = Math.max(0, Math.floor((zmin - z0) / cell)), k1 = Math.min(h - 1, Math.floor((zmax - z0) / cell))
		for (let k = k0; k <= k1; k++) {
			const za = z0 + k * cell, zb = za + cell
			const S = P.length < 3 ? P.filter((p) => p[2] >= za && p[2] <= zb) : clip(clip(P, 2, za, 1), 2, zb, -1)
			if (!S.length) continue
			let xmin = Infinity, xmax = -Infinity
			for (const p of S) (xmin = Math.min(xmin, p[0])), (xmax = Math.max(xmax, p[0]))
			const i0 = Math.max(0, Math.floor((xmin - x0) / cell)), i1 = Math.min(w - 1, Math.floor((xmax - x0) / cell))
			if (i1 >= i0) bits.fill(1, k * w + i0, k * w + i1 + 1)
		}
	}
	const g = {
		floor: O.floor, y: O.y, x0, z0, cell, w, h, bits,
		/** One world triangle (9 floats): its part inside the band, shadowed onto the grid. */
		tri(ax, ay, az, bx, by, bz, cx, cy, cz) {
			if (Math.max(ay, by, cy) < g.lo || Math.min(ay, by, cy) > g.hi) return
			if (Math.max(ax, bx, cx) < x0 || Math.min(ax, bx, cx) > x0 + w * cell) return
			if (Math.max(az, bz, cz) < z0 || Math.min(az, bz, cz) > z0 + h * cell) return
			let P = [[ax, ay, az], [bx, by, bz], [cx, cy, cz]]
			if (Math.min(ay, by, cy) < g.lo) P = clip(P, 1, g.lo, 1)
			if (P.length && Math.max(...P.map((p) => p[1])) > g.hi) P = clip(P, 1, g.hi, -1)
			if (P.length) fill(P)
			edt = null
		},
		/** A solid world box (synthetic scenes, tests) — blocked where it overlaps the band. */
		box(min, max) {
			if (max[1] < g.lo || min[1] > g.hi) return
			fill([[min[0], 0, min[2]], [max[0], 0, min[2]], [max[0], 0, max[2]], [min[0], 0, max[2]]])
			edt = null
		},
		/** Free every cell overlapping `rect` grown by `pad` (a higher floor standing on this one is a wall, not an obstacle). */
		clear(rect, pad = 0) {
			const i0 = Math.max(0, Math.floor((rect[0] - pad - x0) / cell)), i1 = Math.min(w - 1, Math.ceil((rect[2] + pad - x0) / cell) - 1)
			const k0 = Math.max(0, Math.floor((rect[1] - pad - z0) / cell)), k1 = Math.min(h - 1, Math.ceil((rect[3] + pad - z0) / cell) - 1)
			if (i1 >= i0) for (let k = k0; k <= k1; k++) bits.fill(0, k * w + i0, k * w + i1 + 1)
			edt = null
		},
		/** Is the cell under (x, z) blocked? (outside the grid: false — the floor's edge is the ground model's wall) */
		blocked(x, z) {
			const i = Math.floor((x - x0) / cell), k = Math.floor((z - z0) / cell)
			return i >= 0 && k >= 0 && i < w && k < h && bits[k * w + i] === 1
		},
		/** Distance from segment a→b to the nearest blocked cell (its square) when < r, else Infinity. */
		segNear(ax, az, bx, bz, r) {
			const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - x0) / cell)), i1 = Math.min(w - 1, Math.floor((Math.max(ax, bx) + r - x0) / cell))
			const k0 = Math.max(0, Math.floor((Math.min(az, bz) - r - z0) / cell)), k1 = Math.min(h - 1, Math.floor((Math.max(az, bz) + r - z0) / cell))
			let best = Infinity
			for (let k = k0; k <= k1; k++) {
				for (let i = i0; i <= i1; i++) {
					if (!bits[k * w + i]) continue
					const d = segSquare(ax, az, bx, bz, x0 + i * cell, z0 + k * cell, cell)
					if (d < r && d < best) best = d
				}
			}
			return best
		},
		/** Exact Euclidean distance (m) from every cell centre to the nearest blocked cell centre (Float32Array; cached). */
		clearance() {
			if (!edt) edt = distanceTransform(bits, w, h, cell)
			return edt
		},
		/** Blocked cells count. */
		count() {
			let n = 0
			for (let i = 0; i < bits.length; i++) n += bits[i]
			return n
		},
		toJSON() {
			return { floor: O.floor, y: O.y, x0: round6(x0), z0: round6(z0), cell, w, h, rle: encodeRle(bits) }
		},
	}
	return g
}

const round6 = (v) => Math.round(v * 1e6) / 1e6

/** Distance from segment a→b to the axis-aligned square [sx, sz] … + c (0 when they touch). */
function segSquare(ax, az, bx, bz, sx, sz, c) {
	const x1 = sx + c, z1 = sz + c
	// Liang–Barsky: does the segment enter the square?
	let t0 = 0, t1 = 1
	const dx = bx - ax, dz = bz - az
	const edge = (p, q) => {
		if (p === 0) return q >= 0
		const t = q / p
		if (p < 0) {
			if (t > t1) return false
			if (t > t0) t0 = t
		} else {
			if (t < t0) return false
			if (t < t1) t1 = t
		}
		return true
	}
	if (edge(-dx, ax - sx) && edge(dx, x1 - ax) && edge(-dz, az - sz) && edge(dz, z1 - az)) return 0
	// disjoint convex sets: the minimum is at an endpoint of the segment or a corner of the square
	const pr = (x, z) => Math.hypot(Math.max(sx - x, 0, x - x1), Math.max(sz - z, 0, z - z1))
	const l2 = dx * dx + dz * dz
	const ps = (x, z) => {
		const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0
		return Math.hypot(x - ax - t * dx, z - az - t * dz)
	}
	return Math.min(pr(ax, az), pr(bx, bz), ps(sx, sz), ps(x1, sz), ps(x1, z1), ps(sx, z1))
}

/** 0/1 cells → run lengths alternating free, blocked, … (starts with free). */
function encodeRle(bits) {
	const out = []
	let cur = 0, run = 0
	for (let i = 0; i < bits.length; i++) {
		if (bits[i] === cur) run++
		else {
			out.push(run)
			cur = bits[i]
			run = 1
		}
	}
	out.push(run)
	return out
}

/** The scene JSON's occ entry → a grid (null when malformed). Decoded once, cached on the object. */
function fromJSON(o) {
	if (!o || typeof o !== 'object') return null
	if (o.__grid) return o.__grid
	const ok = [o.x0, o.z0, o.cell, o.y].every(Number.isFinite) && o.cell > 0 && Number.isInteger(o.w) && Number.isInteger(o.h) && o.w > 0 && o.h > 0 && Array.isArray(o.rle)
	if (!ok) return null
	const bits = new Uint8Array(o.w * o.h)
	let at = 0, cur = 0
	for (const n of o.rle) {
		if (!Number.isInteger(n) || n < 0 || at + n > bits.length) return null
		if (cur) bits.fill(1, at, at + n)
		at += n
		cur ^= 1
	}
	if (at !== bits.length) return null
	const g = wrap({ floor: o.floor, y: o.y, x0: o.x0, z0: o.z0, cell: o.cell, w: o.w, h: o.h, bits })
	Object.defineProperty(o, '__grid', { value: g, enumerable: false })
	return g
}

/** The occupancy grid of floor `id` a scene carries (`scene.occ`, JSON or live), or null. */
function occOf(scene, id) {
	for (const o of Array.isArray(scene?.occ) ? scene.occ : []) {
		if (o && o.floor === id) return typeof o.segNear === 'function' ? o : fromJSON(o)
	}
	return null
}

/** Felzenszwalb–Huttenlocher squared EDT, separable (columns then rows) → distances in metres. */
function distanceTransform(bits, w, h, cell) {
	const INF = 1e20
	const d = new Float64Array(w * h)
	for (let i = 0; i < d.length; i++) d[i] = bits[i] ? 0 : INF
	const n = Math.max(w, h)
	const f = new Float64Array(n), out = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1)
	const pass = (len) => {
		let k = 0
		v[0] = 0
		z[0] = -INF
		z[1] = INF
		for (let q = 1; q < len; q++) {
			let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
			while (s <= z[k]) {
				k--
				s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
			}
			k++
			v[k] = q
			z[k] = s
			z[k + 1] = INF
		}
		k = 0
		for (let q = 0; q < len; q++) {
			while (z[k + 1] < q) k++
			out[q] = (q - v[k]) * (q - v[k]) + f[v[k]]
		}
	}
	for (let i = 0; i < w; i++) {
		for (let k = 0; k < h; k++) f[k] = d[k * w + i]
		pass(h)
		for (let k = 0; k < h; k++) d[k * w + i] = out[k]
	}
	for (let k = 0; k < h; k++) {
		for (let i = 0; i < w; i++) f[i] = d[k * w + i]
		pass(w)
		for (let i = 0; i < w; i++) d[k * w + i] = out[i]
	}
	const res = new Float32Array(w * h)
	for (let i = 0; i < res.length; i++) res[i] = d[i] >= INF / 2 ? Infinity : Math.sqrt(d[i]) * cell
	return res
}

module.exports = { createOcc, fromJSON, occOf, encodeRle, segSquare, distanceTransform }
