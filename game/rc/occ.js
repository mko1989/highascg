/**
 * §3 occupancy grids (WO-1074, contract "Obstacles at toy height") — pure: what blocks a toy car is whatever crosses
 * the band floor … floor + car height (table legs, truss bases, walls, the stage side). The scene sends one grid per
 * floor, run-length encoded:
 *
 *   { floor, y, x0, z0, cell, w, h, rle: [free, blocked, free, …] }   row-major, z rows from z0, x from x0
 *
 * decoded ONCE here (prepareOcc). Cell (i, j) covers x0 + i·cell … +cell, z0 + j·cell … +cell. The grid is not dilated:
 * the car's radius is added here (a disc against the blocked squares). A car whose y is within
 * [grid.y − eps, grid.y + carH] collides with that grid; on a ramp or deck above the band it ignores it.
 */

/** Largest grid accepted (cells); a bigger one is dropped (the car then only meets walls and obstacle boxes). */
export const MAX_CELLS = 16e6

/** Decode one RLE list into a Uint8Array of w·h cells (1 = blocked). Runs past the end are cut, a short list = free. */
export function decodeRle(rle, n) {
	const bits = new Uint8Array(n)
	let p = 0
	let blocked = false
	for (const v of Array.isArray(rle) ? rle : []) {
		const run = Math.max(0, Math.floor(Number(v) || 0))
		const q = Math.min(n, p + run)
		if (blocked && q > p) bits.fill(1, p, q)
		p = q
		blocked = !blocked
		if (p >= n) break
	}
	return bits
}

/** Scene `occ` list → decoded grids (malformed entries dropped). Already-decoded grids pass through unchanged. */
export function prepareOcc(list) {
	const out = []
	for (const o of Array.isArray(list) ? list : []) {
		if (o?.bits instanceof Uint8Array) {
			out.push(o)
			continue
		}
		const w = Math.floor(Number(o?.w))
		const h = Math.floor(Number(o?.h))
		const cell = Number(o?.cell)
		const nums = [o?.x0, o?.z0, o?.y].map(Number)
		if (!(w > 0 && h > 0 && w * h <= MAX_CELLS && cell > 0) || !nums.every(Number.isFinite)) continue
		const bits = decodeRle(o.rle, w * h)
		let count = 0
		for (let i = 0; i < bits.length; i++) count += bits[i]
		out.push({ floor: String(o.floor ?? ''), y: nums[2], x0: nums[0], z0: nums[1], cell, w, h, bits, count })
	}
	return out
}

/** Is cell (i, j) of grid o blocked? Outside the grid = free. */
export function cellBlocked(o, i, j) {
	return i >= 0 && j >= 0 && i < o.w && j < o.h && o.bits[j * o.w + i] === 1
}

/** Grids whose car band holds a car at height y: [o.y − eps, o.y + carH]. */
function inBand(o, y, eps, carH) {
	return y >= o.y - eps && y <= o.y + carH
}

/**
 * Nearest blocked point within radius r of (x, z) for a car at height y → { d, px, pz } (d = 0 when (x, z) itself is
 * in a blocked cell), or null when the disc is clear.
 */
export function occNearest(grids, x, z, y, r, eps, carH) {
	let best = null
	for (const o of grids || []) {
		if (!o.count || !inBand(o, y, eps, carH)) continue
		const c = o.cell
		const i0 = Math.floor((x - r - o.x0) / c)
		const i1 = Math.floor((x + r - o.x0) / c)
		const j0 = Math.floor((z - r - o.z0) / c)
		const j1 = Math.floor((z + r - o.z0) / c)
		if (i1 < 0 || j1 < 0 || i0 >= o.w || j0 >= o.h) continue
		for (let j = Math.max(0, j0); j <= Math.min(o.h - 1, j1); j++) {
			const cz0 = o.z0 + j * c
			for (let i = Math.max(0, i0); i <= Math.min(o.w - 1, i1); i++) {
				if (o.bits[j * o.w + i] !== 1) continue
				const cx0 = o.x0 + i * c
				const px = x < cx0 ? cx0 : x > cx0 + c ? cx0 + c : x
				const pz = z < cz0 ? cz0 : z > cz0 + c ? cz0 + c : z
				const d = Math.hypot(x - px, z - pz)
				if (d < r && (!best || d < best.d)) best = { d, px, pz }
			}
		}
	}
	return best
}

/** Is the plan point (x, z) inside a blocked cell of a grid whose band holds height y? (the chase camera's test) */
export function occPointBlocked(grids, x, z, y, eps, carH) {
	for (const o of grids || []) {
		if (!o.count || !inBand(o, y, eps, carH)) continue
		if (cellBlocked(o, Math.floor((x - o.x0) / o.cell), Math.floor((z - o.z0) / o.cell))) return true
	}
	return false
}

/** Any blocked cell of a grid at floor height ≈ floorY (within eps) under the square (x ± r, z ± r)? (deck pillars) */
export function occSquareBlocked(grids, x, z, r, floorY, eps) {
	for (const o of grids || []) {
		if (!o.count || Math.abs(o.y - floorY) > eps) continue
		const i0 = Math.floor((x - r - o.x0) / o.cell)
		const i1 = Math.floor((x + r - o.x0) / o.cell)
		const j0 = Math.floor((z - r - o.z0) / o.cell)
		const j1 = Math.floor((z + r - o.z0) / o.cell)
		for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (cellBlocked(o, i, j)) return true
	}
	return false
}

/**
 * §3.1 tunnels — the carve (MUST match src/game/rc-scene-occ.js `carveCells`): the indices of grid o's cells whose
 * centres lie within r of the plan polyline `line` ([[x, z]]), ascending.
 */
export function carveCells(o, line, r) {
	const { x0, z0, cell, w, h } = o
	const mark = new Uint8Array(w * h)
	const r2 = r * r
	for (let s = 0; s + 1 < line.length; s++) {
		const ax = line[s][0],
			az = line[s][1],
			bx = line[s + 1][0],
			bz = line[s + 1][1]
		const dx = bx - ax,
			dz = bz - az
		const l2 = dx * dx + dz * dz
		const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - x0) / cell) - 1),
			i1 = Math.min(w - 1, Math.floor((Math.max(ax, bx) + r - x0) / cell) + 1)
		const k0 = Math.max(0, Math.floor((Math.min(az, bz) - r - z0) / cell) - 1),
			k1 = Math.min(h - 1, Math.floor((Math.max(az, bz) + r - z0) / cell) + 1)
		for (let k = k0; k <= k1; k++) {
			const pz = z0 + (k + 0.5) * cell
			for (let i = i0; i <= i1; i++) {
				const px = x0 + (i + 0.5) * cell
				let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0
				t = t < 0 ? 0 : t > 1 ? 1 : t
				const ex = ax + t * dx - px,
					ez = az + t * dz - pz
				if (ex * ex + ez * ez <= r2) mark[k * w + i] = 1
			}
		}
	}
	const out = []
	for (let q = 0; q < mark.length; q++) if (mark[q]) out.push(q)
	return out
}

/**
 * §3.1: the active track's tunnels carved out of decoded grids → new grid list (a grid a tunnel touches is COPIED —
 * the decoded scene grids are shared between tracks). Each tunnel uses the grid whose y is within 0.02 · scale of its
 * first point, r = width/2 + 1 cell, over the world points from … to. `track`: { points: [[x, y, z]], width, tunnels }.
 */
export function carveTracks(grids, track, scale = 1) {
	const list = Array.isArray(track?.tunnels) ? track.tunnels : []
	if (!list.length) return grids
	const copy = new Map()
	for (const t of list) {
		const P = track.points
		if (!P?.[t.from] || !P[t.to]) continue
		const o = grids.find((g) => Math.abs(g.y - P[t.from][1]) <= 0.02 * scale)
		if (!o) continue
		if (!copy.has(o)) copy.set(o, { ...o, bits: o.bits.slice() })
		const c = copy.get(o)
		const line = []
		for (let i = t.from; i <= t.to; i++) line.push([P[i][0], P[i][2]])
		for (const q of carveCells(o, line, track.width / 2 + o.cell)) if (c.bits[q]) ((c.bits[q] = 0), c.count--)
	}
	return grids.map((g) => copy.get(g) || g)
}
