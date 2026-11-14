/**
 * Plan grid of line segments (WO-1074 §3: tracks of up to 2500 points) — pure. Every segment is listed in each cell
 * its plan bounding box touches (compressed rows: `start` / `items`), so a nearest-segment search or a "segments near a
 * point" query reads a few cells instead of the whole track. Results are exactly the full scan's (ties go to the
 * lower index), so a caller can switch between the scan and the grid without changing behaviour.
 */

/**
 * @param {{ ax: number, az: number, dx: number, dz: number }[]} segs plan segments (a → a + d)
 * @param {number} minCell smallest cell size (m); the grid never has more than `maxSide` cells per side
 */
export function buildSegGrid(segs, minCell, maxSide = 128) {
	let x0 = Infinity
	let z0 = Infinity
	let x1 = -Infinity
	let z1 = -Infinity
	for (const g of segs) {
		x0 = Math.min(x0, g.ax, g.ax + g.dx)
		x1 = Math.max(x1, g.ax, g.ax + g.dx)
		z0 = Math.min(z0, g.az, g.az + g.dz)
		z1 = Math.max(z1, g.az, g.az + g.dz)
	}
	if (!segs.length) return null
	const cell = Math.max(minCell > 0 ? minCell : 1e-3, (x1 - x0) / maxSide, (z1 - z0) / maxSide, 1e-6)
	const nx = Math.max(1, Math.ceil((x1 - x0) / cell) + 1)
	const nz = Math.max(1, Math.ceil((z1 - z0) / cell) + 1)
	const ci = (x) => Math.min(nx - 1, Math.max(0, Math.floor((x - x0) / cell)))
	const cj = (z) => Math.min(nz - 1, Math.max(0, Math.floor((z - z0) / cell)))
	const count = new Int32Array(nx * nz + 1)
	const span = (g) => [
		ci(Math.min(g.ax, g.ax + g.dx)),
		ci(Math.max(g.ax, g.ax + g.dx)),
		cj(Math.min(g.az, g.az + g.dz)),
		cj(Math.max(g.az, g.az + g.dz)),
	]
	for (const g of segs) {
		const [i0, i1, j0, j1] = span(g)
		for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) count[j * nx + i + 1]++
	}
	for (let c = 1; c <= nx * nz; c++) count[c] += count[c - 1]
	const start = count.slice()
	const fill = count.slice()
	const items = new Int32Array(start[nx * nz])
	segs.forEach((g, k) => {
		const [i0, i1, j0, j1] = span(g)
		for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) items[fill[j * nx + i]++] = k
	})
	return { x0, z0, cell, nx, nz, start, items, ci, cj }
}

/** Call fn(k) for every segment listed in a cell that the square (x ± r, z ± r) touches (a segment may repeat). */
export function forSegsNear(grid, x, z, r, fn) {
	const i0 = grid.ci(x - r)
	const i1 = grid.ci(x + r)
	const j0 = grid.cj(z - r)
	const j1 = grid.cj(z + r)
	if (
		x + r < grid.x0 ||
		z + r < grid.z0 ||
		x - r > grid.x0 + grid.nx * grid.cell ||
		z - r > grid.z0 + grid.nz * grid.cell
	)
		return
	for (let j = j0; j <= j1; j++)
		for (let i = i0; i <= i1; i++) {
			const c = j * grid.nx + i
			for (let p = grid.start[c]; p < grid.start[c + 1]; p++) fn(grid.items[p])
		}
}

/**
 * Ring search for the lowest score: score(k) ≥ the plan distance from (x, z) to segment k is required (a height
 * penalty may be added). Rings of cells grow around (x, z)'s cell (clamped into the grid) until no unvisited cell can
 * beat the best. Calls visit(k) for every candidate; the caller keeps the best (ties → lower index) and
 * `best()` returns its current score.
 */
export function ringSearch(grid, x, z, visit, best) {
	const ic = grid.ci(x)
	const jc = grid.cj(z)
	const maxR = Math.max(grid.nx, grid.nz)
	const cellRow = (j, i0, i1) => {
		if (j < 0 || j >= grid.nz) return
		for (let i = Math.max(0, i0); i <= Math.min(grid.nx - 1, i1); i++) {
			const c = j * grid.nx + i
			for (let p = grid.start[c]; p < grid.start[c + 1]; p++) visit(grid.items[p])
		}
	}
	const cellCol = (i, j0, j1) => {
		if (i < 0 || i >= grid.nx) return
		for (let j = Math.max(0, j0); j <= Math.min(grid.nz - 1, j1); j++) {
			const c = j * grid.nx + i
			for (let p = grid.start[c]; p < grid.start[c + 1]; p++) visit(grid.items[p])
		}
	}
	for (let r = 0; r <= maxR; r++) {
		if (r === 0) cellRow(jc, ic, ic)
		else {
			cellRow(jc - r, ic - r, ic + r)
			cellRow(jc + r, ic - r, ic + r)
			cellCol(ic - r, jc - r + 1, jc + r - 1)
			cellCol(ic + r, jc - r + 1, jc + r - 1)
		}
		/* every unvisited cell is ≥ r cells from (x, z)'s clamped cell → ≥ r · cell away from (x, z) */
		if (best() <= r * grid.cell) return
	}
}
