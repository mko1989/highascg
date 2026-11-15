'use strict'

/**
 * WO-1081 — Stage Skirmish: an arena's solid grid (pure; world metres in, world metres out). Contract §4: solid for
 * soldiers, bullets and rockets inside an arena = blocked cells of that floor's `occ` grid ∪ the arena's `blocks` ∪ the
 * arena edge. A block is rasterised into the SAME cells: a cell is blocked when its centre lies inside the block's
 * rectangle (closed interval; centre x/z, extent `w` along X and `d` along Z at yaw 0, swapped at yaw π/2). The arena
 * rect is snapped to the occ grid's cell edges by the generator, so arena cell (i, k) is occ cell (i0 + i, k0 + k).
 *
 *   arenaGrid(arena, occ, scale)  → { x0, z0, cell, w, h, bits, rect, u }   (bits: 1 = solid; outside the rect = solid)
 *   passable(g, r)                → Uint8Array: no solid square / edge within r of the cell centre (a soldier fits there)
 *   components(mask, w, h)        → { label: Int32Array (−1 = none), sizes: [] } (4-connected)
 *   clearAt(g, x, z, r)           exact: no solid square and no edge within r of the point
 *   lineClear(g, a, b, shrink)    the segment crosses no solid cell; shrink = §5's one cell of tolerance (a solid cell
 *                                 counts only when its 4 neighbours are solid too — the solid shrunk by one cell)
 *   rayHit(g, x, z, dx, dz, max)  distance along the ray to the first solid cell (or the edge), ≤ max
 *   findPath(g, mask, a, b)       A* over passable cells (8 directions, no corner cutting) → [[x, z], …] or null
 */

/** Cell size a floor without an occ grid gets (the RC bake's toy grid: 0.3 u). */
const CELL_U = 0.3

function blockRect(b) {
	const turned = Math.abs(Math.abs(b.yaw || 0) - Math.PI / 2) < 1e-3
	const hx = (turned ? b.d : b.w) / 2, hz = (turned ? b.w : b.d) / 2
	return [b.x - hx, b.z - hz, b.x + hx, b.z + hz]
}

/** Mark the cells whose centre lies inside world rect r (closed). */
function rasterRect(g, r) {
	const { x0, z0, cell, w, h, bits } = g
	const i0 = Math.max(0, Math.ceil((r[0] - x0) / cell - 0.5 - 1e-9)), i1 = Math.min(w - 1, Math.floor((r[2] - x0) / cell - 0.5 + 1e-9))
	const k0 = Math.max(0, Math.ceil((r[1] - z0) / cell - 0.5 - 1e-9)), k1 = Math.min(h - 1, Math.floor((r[3] - z0) / cell - 0.5 + 1e-9))
	for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) bits[k * w + i] = 1
}

/**
 * The arena's solid grid. occ: the decoded grid of the arena's floor (rc-scene-occ.js fromJSON) or null (a floor
 * without one: every cell free, cell = 0.3 u). blocks are rasterised unless opts.noBlocks.
 */
function arenaGrid(arena, occ, scale = 1, opts = {}) {
	const r = arena.rect
	const cell = occ ? occ.cell : CELL_U * scale
	const ox = occ ? occ.x0 : r[0], oz = occ ? occ.z0 : r[1]
	const i0 = Math.round((r[0] - ox) / cell), k0 = Math.round((r[1] - oz) / cell)
	const w = Math.max(1, Math.round((r[2] - r[0]) / cell)), h = Math.max(1, Math.round((r[3] - r[1]) / cell))
	const g = { x0: ox + i0 * cell, z0: oz + k0 * cell, cell, w, h, bits: new Uint8Array(w * h), rect: r, u: scale }
	if (occ) {
		for (let k = 0; k < h; k++) {
			const kk = k0 + k
			if (kk < 0 || kk >= occ.h) continue
			for (let i = 0; i < w; i++) {
				const ii = i0 + i
				if (ii >= 0 && ii < occ.w && occ.bits[kk * occ.w + ii]) g.bits[k * w + i] = 1
			}
		}
	}
	if (!opts.noBlocks) for (const b of arena.blocks || []) rasterRect(g, blockRect(b))
	return g
}

const solid = (g, i, k) => i < 0 || k < 0 || i >= g.w || k >= g.h || g.bits[k * g.w + i] === 1

/** Cell offsets whose square comes within r (m) of a cell centre (the centre's own cell excluded). */
function offsetsWithin(cell, r) {
	const n = Math.ceil(r / cell) + 1
	const out = []
	for (let dk = -n; dk <= n; dk++) {
		for (let di = -n; di <= n; di++) {
			if (!di && !dk) continue
			if (cell * Math.hypot(Math.max(Math.abs(di) - 0.5, 0), Math.max(Math.abs(dk) - 0.5, 0)) < r) out.push([di, dk])
		}
	}
	return out
}

/** Cells a soldier of radius r (m) can stand on: free, and no solid square (outside counts) within r of the centre. */
function passable(g, r) {
	const off = offsetsWithin(g.cell, r)
	const out = new Uint8Array(g.w * g.h)
	for (let k = 0; k < g.h; k++) {
		for (let i = 0; i < g.w; i++) {
			if (g.bits[k * g.w + i]) continue
			let ok = true
			for (const [di, dk] of off) {
				if (solid(g, i + di, k + dk)) {
					ok = false
					break
				}
			}
			if (ok) out[k * g.w + i] = 1
		}
	}
	return out
}

/** 4-connected components of the set cells of mask. */
function components(mask, w, h) {
	const label = new Int32Array(w * h).fill(-1)
	const sizes = []
	const stack = []
	for (let s = 0; s < mask.length; s++) {
		if (!mask[s] || label[s] >= 0) continue
		const id = sizes.length
		let n = 0
		label[s] = id
		stack.push(s)
		while (stack.length) {
			const q = stack.pop()
			n++
			const i = q % w, k = (q - i) / w
			const nb = [i > 0 ? q - 1 : -1, i < w - 1 ? q + 1 : -1, k > 0 ? q - w : -1, k < h - 1 ? q + w : -1]
			for (const t of nb) {
				if (t >= 0 && mask[t] && label[t] < 0) {
					label[t] = id
					stack.push(t)
				}
			}
		}
		sizes.push(n)
	}
	return { label, sizes }
}

/** Cell index of a world point (−1 outside). */
function cellIndex(g, x, z) {
	const i = Math.floor((x - g.x0) / g.cell), k = Math.floor((z - g.z0) / g.cell)
	return i < 0 || k < 0 || i >= g.w || k >= g.h ? -1 : k * g.w + i
}

/** Exact: no solid square within r of (x, z), and the arena edge at least r away. */
function clearAt(g, x, z, r) {
	const ex = g.x0 + g.w * g.cell, ez = g.z0 + g.h * g.cell
	if (x - g.x0 < r || ex - x < r || z - g.z0 < r || ez - z < r) return false
	const i0 = Math.max(0, Math.floor((x - r - g.x0) / g.cell)), i1 = Math.min(g.w - 1, Math.floor((x + r - g.x0) / g.cell))
	const k0 = Math.max(0, Math.floor((z - r - g.z0) / g.cell)), k1 = Math.min(g.h - 1, Math.floor((z + r - g.z0) / g.cell))
	for (let k = k0; k <= k1; k++) {
		for (let i = i0; i <= i1; i++) {
			if (!g.bits[k * g.w + i]) continue
			const sx = g.x0 + i * g.cell, sz = g.z0 + k * g.cell
			if (Math.hypot(Math.max(sx - x, 0, x - sx - g.cell), Math.max(sz - z, 0, z - sz - g.cell)) < r) return false
		}
	}
	return true
}

/** A solid cell as the shrunk grid sees it (§5 tolerance): solid and all 4 neighbours solid (outside = solid). */
const shrunkSolid = (g, i, k) => solid(g, i, k) && solid(g, i - 1, k) && solid(g, i + 1, k) && solid(g, i, k - 1) && solid(g, i, k + 1)

/**
 * Walk the cells a segment / ray crosses (Amanatides–Woo). visit(i, k, t) → true stops; t = the entry distance (m).
 * Starts in the cell of (ax, az); stops after `len` metres.
 */
function walk(g, ax, az, dx, dz, len, visit) {
	const c = g.cell
	let i = Math.floor((ax - g.x0) / c), k = Math.floor((az - g.z0) / c)
	const si = dx > 0 ? 1 : dx < 0 ? -1 : 0, sk = dz > 0 ? 1 : dz < 0 ? -1 : 0
	const tdx = si ? c / Math.abs(dx) : Infinity, tdz = sk ? c / Math.abs(dz) : Infinity
	let tx = si ? ((si > 0 ? g.x0 + (i + 1) * c - ax : ax - (g.x0 + i * c)) / Math.abs(dx)) : Infinity
	let tz = sk ? ((sk > 0 ? g.z0 + (k + 1) * c - az : az - (g.z0 + k * c)) / Math.abs(dz)) : Infinity
	let t = 0
	for (let n = 0; n < 100000; n++) {
		if (visit(i, k, t)) return true
		if (tx < tz) {
			t = tx
			tx += tdx
			i += si
		} else {
			t = tz
			tz += tdz
			k += sk
		}
		if (t > len) return false
	}
	return false
}

/** Does the segment a → b cross no solid cell? shrink: the §5 tolerance (solid shrunk by one cell). */
function lineClear(g, ax, az, bx, bz, shrink = false) {
	const len = Math.hypot(bx - ax, bz - az)
	if (len < 1e-9) return !(shrink ? shrunkSolid : solid)(g, Math.floor((ax - g.x0) / g.cell), Math.floor((az - g.z0) / g.cell))
	const test = shrink ? shrunkSolid : solid
	return !walk(g, ax, az, (bx - ax) / len, (bz - az) / len, len, (i, k) => test(g, i, k))
}

/** Distance (m) along the unit ray from (x, z) to the first solid cell / the edge; `max` when nothing is hit. */
function rayHit(g, x, z, dx, dz, max) {
	let hit = max
	walk(g, x, z, dx, dz, max, (i, k, t) => {
		if (!solid(g, i, k)) return false
		hit = Math.min(max, t)
		return true
	})
	return hit
}

/** A* over passable cells (8 directions, a diagonal only when both orthogonal cells are passable). → world points. */
function findPath(g, mask, ax, az, bx, bz, maxNodes = 120000) {
	const s = cellIndex(g, ax, az), e = cellIndex(g, bx, bz)
	if (s < 0 || e < 0 || !mask[s] || !mask[e]) return null
	const W = g.w
	const gScore = new Float32Array(mask.length).fill(Infinity)
	const from = new Int32Array(mask.length).fill(-1)
	const closed = new Uint8Array(mask.length)
	const heap = [] // [f, q]
	const push = (f, q) => {
		heap.push([f, q])
		let n = heap.length - 1
		while (n > 0) {
			const p = (n - 1) >> 1
			if (heap[p][0] <= heap[n][0]) break
			;[heap[p], heap[n]] = [heap[n], heap[p]]
			n = p
		}
	}
	const pop = () => {
		const top = heap[0]
		const last = heap.pop()
		if (heap.length) {
			heap[0] = last
			let n = 0
			for (;;) {
				const l = 2 * n + 1, r = l + 1
				let m = n
				if (l < heap.length && heap[l][0] < heap[m][0]) m = l
				if (r < heap.length && heap[r][0] < heap[m][0]) m = r
				if (m === n) break
				;[heap[m], heap[n]] = [heap[n], heap[m]]
				n = m
			}
		}
		return top
	}
	const ei = e % W, ek = (e - ei) / W
	const hOf = (q) => {
		const i = q % W, k = (q - i) / W
		const dx = Math.abs(i - ei), dz = Math.abs(k - ek)
		return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)
	}
	gScore[s] = 0
	push(hOf(s), s)
	let visited = 0
	while (heap.length) {
		const [, q] = pop()
		if (closed[q]) continue
		if (q === e) break
		closed[q] = 1
		if (++visited > maxNodes) return null
		const i = q % W, k = (q - i) / W
		for (let dk = -1; dk <= 1; dk++) {
			for (let di = -1; di <= 1; di++) {
				if (!di && !dk) continue
				const ni = i + di, nk = k + dk
				if (ni < 0 || nk < 0 || ni >= W || nk >= g.h) continue
				const t = nk * W + ni
				if (!mask[t] || closed[t]) continue
				if (di && dk && (!mask[k * W + ni] || !mask[nk * W + i])) continue
				const ng = gScore[q] + (di && dk ? Math.SQRT2 : 1)
				if (ng < gScore[t]) {
					gScore[t] = ng
					from[t] = q
					push(ng + hOf(t), t)
				}
			}
		}
	}
	if (s !== e && from[e] < 0) return null
	const out = []
	for (let q = e; q >= 0; q = q === s ? -1 : from[q]) {
		const i = q % W, k = (q - i) / W
		out.push([g.x0 + (i + 0.5) * g.cell, g.z0 + (k + 0.5) * g.cell])
	}
	return out.reverse()
}

module.exports = { CELL_U, blockRect, arenaGrid, passable, components, cellIndex, clearAt, lineClear, rayHit, findPath }
