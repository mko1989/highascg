'use strict'

/**
 * WO-1074 §3.1 — tunnel-able blobs of a floor's occupancy grid (pure; world metres). At toy height a banquet table
 * whose cloth reaches the floor is a closed ring of blocked cells, its chairs small rings around it. A **blob** is an
 * 8-connected component of blocked cells (chairs touching the table's ring are part of it). It is *tunnel-able*
 * (contract §3.1) when it is
 *   - compact: its bounding box is BLOB_MIN … BLOB_MAX (0.8–3.5 m) on each side — not a wall, not a lone chair;
 *   - inside the hall: it touches no edge of the grid (the hall's walls run along it);
 *   - not the stage side: its box stays STAGE_GAP clear of every higher floor's rect;
 *   - roofed: of the height-field cells whose centres lie in the middle half of its box, ≥ ROOF_SHARE carry geometry
 *     ≥ ROOF (0.3 m) above the floor (a table top; rc-scene-height.js `bottomAbove`). No field → no roof.
 * `blobsOf(grid, floors, field)` labels a grid once (cached per grid and field object) → { lab: Int32Array (−1 = free cell),
 * blobs: [{ id, n, cells: [i0, k0, i1, k1], rect: [x0, z0, x1, z1], c: [x, z], ok, why }] }.
 */

const BLOB_MIN = 0.8
const BLOB_MAX = 3.5
const STAGE_GAP = 0.1
const ROOF = 0.3
const ROOF_SHARE = 0.5

const cache = new WeakMap()

/** 8-connected labels of the blocked cells → { lab, comps: [{ id, n, i0, k0, i1, k1 }] }. */
function label(g) {
	const { w, h, bits } = g
	const lab = new Int32Array(w * h).fill(-1)
	const comps = []
	const stack = []
	for (let q0 = 0; q0 < w * h; q0++) {
		if (!bits[q0] || lab[q0] >= 0) continue
		const c = { id: comps.length, n: 0, i0: Infinity, k0: Infinity, i1: -1, k1: -1 }
		lab[q0] = c.id
		stack.push(q0)
		while (stack.length) {
			const q = stack.pop()
			const i = q % w, k = (q - i) / w
			c.n++
			if (i < c.i0) c.i0 = i
			if (i > c.i1) c.i1 = i
			if (k < c.k0) c.k0 = k
			if (k > c.k1) c.k1 = k
			for (let dk = -1; dk <= 1; dk++) {
				for (let di = -1; di <= 1; di++) {
					const ii = i + di, kk = k + dk
					if (ii < 0 || kk < 0 || ii >= w || kk >= h) continue
					const p = kk * w + ii
					if (bits[p] && lab[p] < 0) (lab[p] = c.id), stack.push(p)
				}
			}
		}
		comps.push(c)
	}
	return { lab, comps }
}

/** Share of the field cells in the middle half of rect that hold geometry ≥ ROOF above floorY (0 without a field). */
function roofShare(field, rect, floorY) {
	if (!field) return 0
	const mx = (rect[2] - rect[0]) / 4, mz = (rect[3] - rect[1]) / 4
	const x0 = rect[0] + mx, x1 = rect[2] - mx, z0 = rect[1] + mz, z1 = rect[3] - mz
	let n = 0, hit = 0
	const c = field.cell
	for (let k = Math.ceil((z0 - field.z0) / c - 0.5); field.z0 + (k + 0.5) * c <= z1; k++) {
		for (let i = Math.ceil((x0 - field.x0) / c - 0.5); field.x0 + (i + 0.5) * c <= x1; i++) {
			const x = field.x0 + (i + 0.5) * c, z = field.z0 + (k + 0.5) * c
			n++
			if (Number.isFinite(field.bottomAbove(x, z, floorY + ROOF))) hit++
		}
	}
	return n ? hit / n : 0
}

/** The blobs of grid g (world). floors: the scene floors (higher ones are walls); field: the world height field. */
function blobsOf(g, floors = [], field = null) {
	if (!cache.has(g)) cache.set(g, new Map())
	const per = cache.get(g) // keyed by the field (no field → no roofs)
	if (per.has(field)) return per.get(field)
	const { lab, comps } = label(g)
	const higher = floors.filter((f) => f && Array.isArray(f.rect) && f.y > g.y + 0.05)
	const blobs = comps.map((c) => {
		const rect = [g.x0 + c.i0 * g.cell, g.z0 + c.k0 * g.cell, g.x0 + (c.i1 + 1) * g.cell, g.z0 + (c.k1 + 1) * g.cell]
		const b = { id: c.id, n: c.n, cells: [c.i0, c.k0, c.i1, c.k1], rect, c: [(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2], ok: false, why: '' }
		const sx = rect[2] - rect[0], sz = rect[3] - rect[1]
		if (sx < BLOB_MIN || sz < BLOB_MIN || sx > BLOB_MAX || sz > BLOB_MAX) b.why = 'size'
		else if (c.i0 === 0 || c.k0 === 0 || c.i1 === g.w - 1 || c.k1 === g.h - 1) b.why = 'edge'
		else if (higher.some((f) => rect[0] < f.rect[2] + STAGE_GAP && rect[2] > f.rect[0] - STAGE_GAP && rect[1] < f.rect[3] + STAGE_GAP && rect[3] > f.rect[1] - STAGE_GAP)) b.why = 'stage'
		else if (roofShare(field, rect, g.y) < ROOF_SHARE) b.why = 'roof'
		else b.ok = true
		return b
	})
	const out = { lab, blobs }
	per.set(field, out)
	return out
}

module.exports = { blobsOf, BLOB_MIN, BLOB_MAX }
