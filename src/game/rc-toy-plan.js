'use strict'

/**
 * WO-1074 §3 — toy-scale route planning on a floor's occupancy grid (pure, deterministic; unit frame — rc-scale.js).
 *
 *   planGrid(floor, occ, s, opts) — a planning grid of 2 × 2 occupancy cells. Each cell holds a LOWER BOUND of the
 *     distance (unit) from any point in it to the nearest blocked cell, the floor rect's edge and the `walls` (higher
 *     floors standing on this one: the stage seen from the hall). Built from the grid's exact distance transform;
 *     below zero it is minus the distance to the nearest cell that is not (a signed field: its gradient leads out).
 *   route(pg, from, to, need, opts) — A* (8-connected) from point to point through cells with clearance ≥ need; the
 *     step cost grows where the clearance is below need + PREFER (it keeps to the middle of an aisle); opts.forbid
 *     (cells) are not entered. → [[x, z]] (cell centres) or null.
 *   pg.lerp(x, z) — the clearance interpolated between cell centres (smooth; the smoothing's gradient).
 *   chaikin(poly, rounds, closed, d) — bounded corner cutting before the smoothing (it converges much faster then).
 *   reach(pg, p, need) / extreme(pg, seen, need, score) — the cells a road can reach from p, and the one of them
 *     that scores highest (a tour's far corners: what is actually reachable, not the hall rect's corners).
 *   pull(pg, path, need) — string pulling: the fewest vertices whose straight legs keep ≥ need everywhere.
 *   smooth(loop, pinned, pg, need, R) — rounds a closed dense loop (≈ STEP spacing) until every free point's turn
 *     radius (neighbours ±1 and ±2, the validator's measure) is ≥ R while keeping ≥ need of clearance; pinned points
 *     (ramp / drop straights, stage parts) do not move. → the loop or null.
 */

const G = require('./rc-track-geo')
const { distanceTransform } = require('./rc-scene-occ')

const PREFER = 3 // unit: extra clearance the router prefers (0.3 m at scale 0.1)
const STEP = 0.5 // dense spacing (unit)

function planGrid(floor, occ, s, opts = {}) {
	const r = floor.rect
	const oc = occ ? occ.cell / s : 0.3
	const cell = 2 * oc
	const nx = Math.max(1, Math.ceil((r[2] - r[0]) / cell)), nz = Math.max(1, Math.ceil((r[3] - r[1]) / cell))
	const clr = new Float32Array(nx * nz)
	const edt = occ ? occ.clearance() : null
	const walls = opts.walls || []
	for (let k = 0; k < nz; k++) {
		for (let i = 0; i < nx; i++) {
			const cx = r[0] + (i + 0.5) * cell, cz = r[1] + (k + 0.5) * cell
			let c = Math.min(cx - r[0], r[2] - cx, cz - r[1], r[3] - cz) - cell * 0.71
			for (const w of walls) c = Math.min(c, G.pointRectDist([cx, cz], w) - cell * 0.71)
			if (edt) {
				// occupancy cells under this plan cell (world → grid indices)
				const i0 = Math.floor(((r[0] + i * cell) * s - occ.x0) / occ.cell), k0 = Math.floor(((r[1] + k * cell) * s - occ.z0) / occ.cell)
				let m = Infinity
				for (let kk = k0; kk <= k0 + 2; kk++) for (let ii = i0; ii <= i0 + 2; ii++) if (ii >= 0 && kk >= 0 && ii < occ.w && kk < occ.h) m = Math.min(m, edt[kk * occ.w + ii])
				c = Math.min(c, m / s - 1.42 * oc)
			}
			clr[k * nx + i] = c
		}
	}
	// inside (clearance < 0): minus the distance to the nearest cell outside, so the gradient leads out of an obstacle
	const out = new Uint8Array(nx * nz)
	for (let q = 0; q < out.length; q++) out[q] = clr[q] >= 0 ? 1 : 0
	const din = distanceTransform(out, nx, nz, cell)
	for (let q = 0; q < out.length; q++) if (!out[q]) clr[q] = Number.isFinite(din[q]) ? -din[q] : -1e3
	const at = (x, z) => {
		const i = Math.floor((x - r[0]) / cell), k = Math.floor((z - r[1]) / cell)
		return i >= 0 && k >= 0 && i < nx && k < nz ? clr[k * nx + i] : -Infinity
	}
	/** Bilinear between cell centres (smooth, for the smoothing's gradient; not a bound). */
	const lerp = (x, z) => {
		const fx = (x - r[0]) / cell - 0.5, fz = (z - r[1]) / cell - 0.5
		const i = Math.floor(fx), k = Math.floor(fz), tx = fx - i, tz = fz - k
		const v = (ii, kk) => (ii >= 0 && kk >= 0 && ii < nx && kk < nz ? clr[kk * nx + ii] : -cell)
		return (1 - tz) * ((1 - tx) * v(i, k) + tx * v(i + 1, k)) + tz * ((1 - tx) * v(i, k + 1) + tx * v(i + 1, k + 1))
	}
	return { floor, rect: r, cell, nx, nz, clr, at, lerp, idx: (x, z) => {
		const i = Math.floor((x - r[0]) / cell), k = Math.floor((z - r[1]) / cell)
		return i >= 0 && k >= 0 && i < nx && k < nz ? k * nx + i : -1
	}, centre: (q) => [r[0] + ((q % nx) + 0.5) * cell, r[1] + (Math.floor(q / nx) + 0.5) * cell] }
}

/** Nearest cell centre to (x, z) with clearance ≥ need (spiral search up to `reach` unit) → [x, z] or null. */
function snap(pg, p, need, reach = 20) {
	const q0 = pg.idx(p[0], p[1])
	if (q0 >= 0 && pg.clr[q0] >= need) return pg.centre(q0)
	const i0 = Math.floor((p[0] - pg.rect[0]) / pg.cell), k0 = Math.floor((p[1] - pg.rect[1]) / pg.cell)
	const R = Math.ceil(reach / pg.cell)
	for (let d = 1; d <= R; d++) {
		let best = -1, bd = Infinity
		for (let k = k0 - d; k <= k0 + d; k++) {
			for (let i = i0 - d; i <= i0 + d; i++) {
				if (Math.max(Math.abs(i - i0), Math.abs(k - k0)) !== d || i < 0 || k < 0 || i >= pg.nx || k >= pg.nz) continue
				const q = k * pg.nx + i
				const dd = (i - i0) ** 2 + (k - k0) ** 2
				if (pg.clr[q] >= need && dd < bd) (bd = dd), (best = q)
			}
		}
		if (best >= 0) return pg.centre(best)
	}
	return null
}

/** Cells reachable from p with clearance ≥ need (8-connected, no corner cutting) → Uint8Array or null. */
function reach(pg, p, need) {
	const a = snap(pg, p, need)
	if (!a) return null
	const { nx, nz, clr } = pg
	const seen = new Uint8Array(nx * nz)
	const q0 = pg.idx(a[0], a[1])
	const stack = [q0]
	seen[q0] = 1
	while (stack.length) {
		const q = stack.pop()
		const qi = q % nx, qk = Math.floor(q / nx)
		for (const [di, dk] of MOVES) {
			const i = qi + di, k = qk + dk
			if (i < 0 || k < 0 || i >= nx || k >= nz) continue
			const c = k * nx + i
			if (seen[c] || clr[c] < need || (di && dk && (clr[qk * nx + i] < need || clr[k * nx + qi] < need))) continue
			seen[c] = 1
			stack.push(c)
		}
	}
	return seen
}

/** The reachable cell centre with the highest score(x, z), preferring clearance ≥ need + PREFER → [x, z] or null. */
function extreme(pg, seen, need, score) {
	for (const lim of [need + PREFER, need]) {
		let best = -1, bs = -Infinity
		for (let q = 0; q < seen.length; q++) {
			if (!seen[q] || pg.clr[q] < lim) continue
			const c = pg.centre(q), v = score(c[0], c[1])
			if (v > bs) (bs = v), (best = q)
		}
		if (best >= 0) return pg.centre(best)
	}
	return null
}

/** Binary min-heap of (key, value) in typed arrays. */
function heap(cap) {
	let keys = new Float64Array(cap), vals = new Int32Array(cap), n = 0
	return {
		get size() {
			return n
		},
		push(k, v) {
			if (n === keys.length) {
				const k2 = new Float64Array(n * 2), v2 = new Int32Array(n * 2)
				k2.set(keys), v2.set(vals)
				keys = k2, vals = v2
			}
			let i = n++
			while (i > 0) {
				const p = (i - 1) >> 1
				if (keys[p] <= k) break
				keys[i] = keys[p], vals[i] = vals[p], i = p
			}
			keys[i] = k, vals[i] = v
		},
		pop() {
			const top = vals[0]
			const k = keys[--n], v = vals[n]
			let i = 0
			for (;;) {
				let c = 2 * i + 1
				if (c >= n) break
				if (c + 1 < n && keys[c + 1] < keys[c]) c++
				if (keys[c] >= k) break
				keys[i] = keys[c], vals[i] = vals[c], i = c
			}
			keys[i] = k, vals[i] = v
			return top
		},
	}
}

const MOVES = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]]

/** A* from `from` to `to` (unit points) → cell-centre path or null. opts: { forbid: Uint8Array, maxExpand }. */
function route(pg, from, to, need, opts = {}) {
	const a = snap(pg, from, need), b = snap(pg, to, need)
	if (!a || !b) return null
	const s0 = pg.idx(a[0], a[1]), g0 = pg.idx(b[0], b[1])
	const { nx, nz, clr, cell } = pg
	const forbid = opts.forbid
	const N = nx * nz
	const g = new Float32Array(N).fill(Infinity)
	const from_ = new Int32Array(N).fill(-1)
	const done = new Uint8Array(N)
	const gi = g0 % nx, gk = Math.floor(g0 / nx)
	const h = (q) => {
		const dx = Math.abs((q % nx) - gi), dz = Math.abs(Math.floor(q / nx) - gk)
		return (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)) * cell
	}
	const H = heap(1024)
	g[s0] = 0
	H.push(h(s0), s0)
	let expand = 0
	const maxExpand = opts.maxExpand || N
	while (H.size) {
		const q = H.pop()
		if (done[q]) continue
		done[q] = 1
		if (q === g0) break
		if (++expand > maxExpand) return null
		const qi = q % nx, qk = Math.floor(q / nx)
		for (const [di, dk, len] of MOVES) {
			const i = qi + di, k = qk + dk
			if (i < 0 || k < 0 || i >= nx || k >= nz) continue
			const p = k * nx + i
			if (done[p] || clr[p] < need || (forbid && forbid[p] && p !== g0)) continue
			if (di && dk && (clr[qk * nx + i] < need || clr[k * nx + qi] < need)) continue // no corner cutting
			const pen = Math.max(0, need + PREFER - clr[p]) / PREFER
			const ng = g[q] + len * cell * (1 + 2 * pen)
			if (ng < g[p]) {
				g[p] = ng
				from_[p] = q
				H.push(ng + h(p), p)
			}
		}
	}
	if (!done[g0]) return null
	const out = []
	for (let q = g0; q >= 0; q = from_[q]) out.push(pg.centre(q))
	return out.reverse()
}

/** Is the straight leg a→b clear by `need` (sampled at a fifth of a cell)? */
function legClear(pg, a, b, need) {
	const L = G.dist(a, b)
	const k = Math.max(1, Math.ceil(L / (pg.cell / 5)))
	for (let j = 0; j <= k; j++) if (pg.at(a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k) < need) return false
	return true
}

/** String pulling → polyline vertices (first and last kept). */
function pull(pg, path, need) {
	if (!path || path.length < 2) return path
	const out = [path[0]]
	let anchor = 0
	while (anchor < path.length - 1) {
		let j = anchor + 1
		while (j + 1 < path.length && legClear(pg, path[anchor], path[j + 1], need)) j++
		out.push(path[j])
		anchor = j
	}
	return out
}

/**
 * Corner cutting at a bounded distance: each round replaces every corner by two points `d` along its legs (at most a
 * third of a leg), d halving per round — the curve stays within ≈ d of the taut corner it rounds (plain Chaikin cuts
 * a quarter of a long leg: straight across what the corner wraps). An open polyline keeps its end points.
 */
function chaikin(poly, rounds = 4, closed = false, d0 = 3) {
	let Q = poly.filter((p, i) => i === 0 || G.dist(p, poly[i - 1]) >= 1)
	if (closed && Q.length > 1 && G.dist(Q[0], Q[Q.length - 1]) < 1) Q.pop()
	for (let r = 0, d = d0; r < rounds; r++, d /= 2) {
		const n = Q.length, out = closed ? [] : [Q[0]]
		for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
			const a = Q[(i - 1 + n) % n], v = Q[i], b = Q[(i + 1) % n]
			const la = G.dist(a, v), lb = G.dist(v, b)
			const ta = Math.min(d, la / 3) / (la || 1), tb = Math.min(d, lb / 3) / (lb || 1)
			out.push([v[0] + (a[0] - v[0]) * ta, v[1] + (a[1] - v[1]) * ta], [v[0] + (b[0] - v[0]) * tb, v[1] + (b[1] - v[1]) * tb])
		}
		if (!closed) out.push(Q[n - 1])
		Q = out
	}
	return Q
}

/** Points every STEP along a polyline (open), first point included, last excluded. */
function dense(poly) {
	const out = []
	for (let k = 0; k + 1 < poly.length; k++) {
		const a = poly[k], b = poly[k + 1]
		const m = Math.max(1, Math.round(G.dist(a, b) / STEP))
		for (let j = 0; j < m; j++) out.push([a[0] + ((b[0] - a[0]) * j) / m, a[1] + ((b[1] - a[1]) * j) / m])
	}
	return out
}

/** Smallest turn radius at i over neighbours ±1, ±2. */
const radiusAt = (Q, i) => {
	const n = Q.length
	return Math.min(G.circumradius(Q[(i - 1 + n) % n], Q[i], Q[(i + 1) % n]), G.circumradius(Q[(i - 2 + n) % n], Q[i], Q[(i + 2) % n]))
}

/** Spread the free points evenly (by arc length) between their pinned neighbours; an all-free loop is resampled whole. */
function evenOut(Q, pinned) {
	const n = Q.length
	const first = pinned.indexOf(1)
	if (first < 0) return G.resampleClosed(Q, n)
	const out = Q.map((p) => [p[0], p[1]])
	for (let c = 0, i = first; c < n; ) {
		let j = (i + 1) % n, m = 1
		while (!pinned[j] && m < n) (j = (j + 1) % n), m++
		if (m > 1) {
			const run = Array.from({ length: m + 1 }, (_, q) => Q[(i + q) % n])
			const acc = [0]
			for (let q = 1; q <= m; q++) acc.push(acc[q - 1] + G.dist(run[q - 1], run[q]))
			for (let q = 1, seg = 0; q < m; q++) {
				const t = (acc[m] * q) / m
				while (seg < m - 1 && acc[seg + 1] < t) seg++
				const f = acc[seg + 1] > acc[seg] ? (t - acc[seg]) / (acc[seg + 1] - acc[seg]) : 0
				out[(i + q) % n] = [run[seg][0] + f * (run[seg + 1][0] - run[seg][0]), run[seg][1] + f * (run[seg + 1][1] - run[seg][1])]
			}
		}
		c += m
		i = j
	}
	return out
}

/**
 * Round a closed loop: points whose radius is < R relax towards their neighbours' mean (and pull their neighbours
 * along), points short of clearance are pushed up the clearance gradient. `clearAt(x, z)` → clearance (unit).
 */
function smooth(loop, pinned, clearAt, need, R, iters = 1500) {
	let Q = loop.map((p) => [p[0], p[1]])
	const n = Q.length
	const grad = (x, z) => {
		const e = 0.3
		const gx = clearAt(x + e, z) - clearAt(x - e, z), gz = clearAt(x, z + e) - clearAt(x, z - e)
		const l = Math.hypot(gx, gz)
		return l > 1e-9 ? [gx / l, gz / l] : [0, 0]
	}
	for (let it = 0; it < iters; it++) {
		const tight = new Uint8Array(n)
		let bad = 0
		for (let i = 0; i < n; i++) {
			if (!pinned[i] && radiusAt(Q, i) < R) {
				bad++
				for (let d = -2; d <= 2; d++) tight[(i + d + n) % n] = 1
			}
		}
		let short = 0
		for (let i = 0; i < n; i++) if (!pinned[i] && clearAt(Q[i][0], Q[i][1]) < need) short++
		if (!bad && !short) return Q
		const N = Q.map((p) => [p[0], p[1]])
		for (let i = 0; i < n; i++) {
			if (pinned[i]) continue
			const a = Q[(i - 1 + n) % n], b = Q[(i + 1) % n]
			let x = Q[i][0], z = Q[i][1]
			if (tight[i]) (x += 0.5 * ((a[0] + b[0]) / 2 - x)), (z += 0.5 * ((a[1] + b[1]) / 2 - z))
			else (x += 0.05 * ((a[0] + b[0]) / 2 - x)), (z += 0.05 * ((a[1] + b[1]) / 2 - z)) // keep the spacing even
			const c = clearAt(x, z)
			if (c < need + 0.1) {
				const [gx, gz] = grad(x, z)
				const push = Math.min(1, need + 0.1 - c)
				x += gx * push
				z += gz * push
			}
			N[i] = [x, z]
		}
		Q = it % 25 === 24 ? evenOut(N, pinned) : N
	}
	return null
}

module.exports = { planGrid, snap, reach, extreme, route, pull, chaikin, dense, smooth, STEP, PREFER }
