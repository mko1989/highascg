/**
 * The arena's solid grid (WO-1081 §4/§5) — pure. Solid for soldiers, bullets and rockets inside an arena = the
 * blocked cells of that floor's `occ` grid (RC contract §3, decoded by the kit's occ.js) ∪ the arena's toy `blocks`
 * ∪ everything outside the arena rect (its edge is a wall). The grid uses the floor grid's own cells (aligned with
 * it, cropped to the rect); a floor without `occ` gets a plain grid of FALLBACK_CELL_U. A block marks a cell when the
 * cell's CENTRE lies inside the block's rectangle (both sides rasterise the same way).
 *
 *   g = buildArenaGrid(arena, preparedOcc, s)   → { x0, z0, cell, w, h, bits, rect, y, s }
 *   solidAt(g, x, z)                            a plan point in a solid cell (or outside the grid)?
 *   moveCircle(g, x, z, nx, nz, r)              move a disc to (nx, nz), sliding along solids → [x, z]
 *   rayCast(g, x, z, dx, dz, max)               distance along a unit direction to the first solid cell (≤ max)
 *   lineClear(g, ax, az, bx, bz)                no solid cell between two points
 * All positions are world metres (the scene frame); r / max in metres too.
 */
import { prepareOcc, cellBlocked } from './kit/occ.js'

/** Cell size (u) of an arena whose floor has no occupancy grid. */
export const FALLBACK_CELL_U = 0.3
/** Largest grid accepted (cells per side) — an 80 u arena at a 0.03 m cell is 267. */
const MAX_SIDE = 4000

/** The block's footprint [minX, minZ, maxX, maxZ]; yaw π/2 swaps w and d. */
export function blockRect(b) {
	const turned = Math.abs(Math.sin(Number(b.yaw) || 0)) > 0.5
	const hw = (turned ? Number(b.d) : Number(b.w)) / 2
	const hd = (turned ? Number(b.w) : Number(b.d)) / 2
	return [b.x - hw, b.z - hd, b.x + hw, b.z + hd]
}

/** The floor grid of an arena: same floor id, else the grid at the arena's height. */
function floorGrid(grids, arena) {
	return (
		grids.find((o) => o.floor && o.floor === arena.floor) ||
		grids.find((o) => Math.abs(o.y - Number(arena.y)) <= 0.02) ||
		null
	)
}

/**
 * @param {{ rect: number[], y?: number, floor?: string, blocks?: object[] }} arena
 * @param {object[]} occ the scene's `occ` list (raw or already prepared)
 * @param {number} s the scene scale
 */
export function buildArenaGrid(arena, occ, s = 1) {
	const [rx0, rz0, rx1, rz1] = (arena?.rect || [0, 0, 0, 0]).map(Number)
	const grids = prepareOcc(occ || [])
	const o = floorGrid(grids, arena || {})
	/* the server's exact geometry (sk-grid.js arenaGrid): origin = the floor grid (or the rect's corner without one),
	 * the rect snapped to whole cells by rounding — the generator puts arena edges on cell edges */
	const cell = o ? o.cell : FALLBACK_CELL_U * s
	const ox = o ? o.x0 : rx0
	const oz = o ? o.z0 : rz0
	const i0 = Math.round((rx0 - ox) / cell)
	const j0 = Math.round((rz0 - oz) / cell)
	const w = Math.min(MAX_SIDE, Math.max(1, Math.round((rx1 - rx0) / cell)))
	const h = Math.min(MAX_SIDE, Math.max(1, Math.round((rz1 - rz0) / cell)))
	const x0 = ox + i0 * cell
	const z0 = oz + j0 * cell
	const bits = new Uint8Array(w * h)
	const rects = (arena?.blocks || []).filter((b) => b && [b.x, b.z, b.w, b.d].every(Number.isFinite)).map(blockRect)
	let count = 0
	for (let j = 0; j < h; j++) {
		const cz = z0 + (j + 0.5) * cell
		for (let i = 0; i < w; i++) {
			const cx = x0 + (i + 0.5) * cell
			let solid = cx < rx0 || cx > rx1 || cz < rz0 || cz > rz1
			if (!solid && o) solid = cellBlocked(o, i0 + i, j0 + j)
			if (solid) {
				bits[j * w + i] = 1
				count++
			}
		}
	}
	/* blocks: the cells whose centre lies inside the closed rect — the server's index maths (1e-9 cell of tolerance) */
	for (const r of rects) {
		const ia = Math.max(0, Math.ceil((r[0] - x0) / cell - 0.5 - 1e-9))
		const ib = Math.min(w - 1, Math.floor((r[2] - x0) / cell - 0.5 + 1e-9))
		const ja = Math.max(0, Math.ceil((r[1] - z0) / cell - 0.5 - 1e-9))
		const jb = Math.min(h - 1, Math.floor((r[3] - z0) / cell - 0.5 + 1e-9))
		for (let j = ja; j <= jb; j++)
			for (let i = ia; i <= ib; i++) {
				if (!bits[j * w + i]) count++
				bits[j * w + i] = 1
			}
	}
	return { x0, z0, cell, w, h, bits, count, rect: [rx0, rz0, rx1, rz1], y: Number(arena?.y) || 0, s }
}

/** Is cell (i, j) solid? Outside the grid = solid. */
export function cellSolid(g, i, j) {
	return i < 0 || j < 0 || i >= g.w || j >= g.h || g.bits[j * g.w + i] === 1
}

export function solidAt(g, x, z) {
	return cellSolid(g, Math.floor((x - g.x0) / g.cell), Math.floor((z - g.z0) / g.cell))
}

/** Nearest point of a solid cell within r of (x, z) → { d, px, pz } (d 0 = inside a solid cell), or null. */
export function nearestSolid(g, x, z, r) {
	const c = g.cell
	const i0 = Math.floor((x - r - g.x0) / c)
	const i1 = Math.floor((x + r - g.x0) / c)
	const j0 = Math.floor((z - r - g.z0) / c)
	const j1 = Math.floor((z + r - g.z0) / c)
	let best = null
	for (let j = j0; j <= j1; j++) {
		const cz0 = g.z0 + j * c
		for (let i = i0; i <= i1; i++) {
			if (!cellSolid(g, i, j)) continue
			const cx0 = g.x0 + i * c
			const px = x < cx0 ? cx0 : x > cx0 + c ? cx0 + c : x
			const pz = z < cz0 ? cz0 : z > cz0 + c ? cz0 + c : z
			const d = Math.hypot(x - px, z - pz)
			if (d < r && (!best || d < best.d)) best = { d, px, pz }
		}
	}
	return best
}

/** Push a disc out of the solids around it (a few passes) → [x, z], or null when its centre is inside a solid. */
function pushOut(g, x, z, r) {
	for (let k = 0; k < 4; k++) {
		const n = nearestSolid(g, x, z, r)
		if (!n) return [x, z]
		if (n.d < 1e-9) return null
		const f = (r - n.d + 1e-6) / n.d
		x += (x - n.px) * f
		z += (z - n.pz) * f
	}
	return nearestSolid(g, x, z, r * 0.98) ? null : [x, z]
}

/**
 * Move a disc of radius r from (x, z) towards (nx, nz): sub-steps no longer than a third of the smaller of r and the
 * cell (no tunnelling through a one-cell leg), each pushed out of the solids (so it slides along walls); a sub-step
 * that ends inside a solid tries the two axis moves alone and else stops there. Returns the final [x, z].
 */
export function moveCircle(g, x, z, nx, nz, r) {
	const dx = nx - x
	const dz = nz - z
	const len = Math.hypot(dx, dz)
	if (len < 1e-12) return pushOut(g, x, z, r) || [x, z]
	const step = Math.max(1e-6, Math.min(r, g.cell) / 3)
	const n = Math.min(400, Math.ceil(len / step))
	let cx = x
	let cz = z
	for (let k = 1; k <= n; k++) {
		const sx = dx / n
		const sz = dz / n
		const p = pushOut(g, cx + sx, cz + sz, r) || pushOut(g, cx + sx, cz, r) || pushOut(g, cx, cz + sz, r)
		if (!p) break
		cx = p[0]
		cz = p[1]
	}
	return [cx, cz]
}

/**
 * Distance from (x, z) along the unit direction (dx, dz) to the first solid cell, at most max (grid DDA). A start
 * inside a solid cell → 0.
 */
export function rayCast(g, x, z, dx, dz, max) {
	const c = g.cell
	let i = Math.floor((x - g.x0) / c)
	let j = Math.floor((z - g.z0) / c)
	if (cellSolid(g, i, j)) return 0
	const stepI = dx > 0 ? 1 : -1
	const stepJ = dz > 0 ? 1 : -1
	const tdx = dx !== 0 ? Math.abs(c / dx) : Infinity
	const tdz = dz !== 0 ? Math.abs(c / dz) : Infinity
	const bx = g.x0 + (dx > 0 ? i + 1 : i) * c
	const bz = g.z0 + (dz > 0 ? j + 1 : j) * c
	let tx = dx !== 0 ? (bx - x) / dx : Infinity
	let tz = dz !== 0 ? (bz - z) / dz : Infinity
	for (let guard = 0; guard < 100000; guard++) {
		let t
		if (tx < tz) {
			t = tx
			i += stepI
			tx += tdx
		} else {
			t = tz
			j += stepJ
			tz += tdz
		}
		if (t >= max) return max
		if (cellSolid(g, i, j)) return Math.max(0, t)
	}
	return max
}

/** No solid cell on the straight line between a and b. */
export function lineClear(g, ax, az, bx, bz) {
	const d = Math.hypot(bx - ax, bz - az)
	if (d < 1e-9) return !solidAt(g, ax, az)
	return rayCast(g, ax, az, (bx - ax) / d, (bz - az) / d, d) >= d
}

/** Share of solid cells inside the rect (the arenas are generated with 8–40 %). */
export function solidShare(g) {
	let inside = 0
	let solid = 0
	const [rx0, rz0, rx1, rz1] = g.rect
	for (let j = 0; j < g.h; j++) {
		const cz = g.z0 + (j + 0.5) * g.cell
		if (cz < rz0 || cz > rz1) continue
		for (let i = 0; i < g.w; i++) {
			const cx = g.x0 + (i + 0.5) * g.cell
			if (cx < rx0 || cx > rx1) continue
			inside++
			solid += g.bits[j * g.w + i]
		}
	}
	return inside ? solid / inside : 0
}
