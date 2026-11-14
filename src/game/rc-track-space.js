'use strict'

/**
 * WO-1074 — RC car game: where on a floor a track's centre line may run. The floor rect shrunk by the road's half width
 * (+ an edge margin), minus every obstacle grown by the same margin, on a grid; the largest empty rectangles of that
 * grid are the regions the generator fits its shapes into (an obstacle-strewn stage still gets a track in its clear
 * part). Pure.
 */

const { obstacleRectsAt } = require('./rc-track-check')

/** Maximal empty rectangles of a free-cell grid (histogram per row) → [{ rect, area }] (cell units → metres). */
function emptyRects(free, nx, nz, x0, z0, cell) {
	const h = new Int32Array(nx)
	const out = []
	for (let k = 0; k < nz; k++) {
		for (let i = 0; i < nx; i++) h[i] = free[k * nx + i] ? h[i] + 1 : 0
		const stack = []
		for (let i = 0; i <= nx; i++) {
			const cur = i < nx ? h[i] : 0
			let start = i
			while (stack.length && stack[stack.length - 1][1] >= cur) {
				const [s, ht] = stack.pop()
				if (ht > 0) {
					const w = i - s
					out.push({ rect: [x0 + s * cell, z0 + (k + 1 - ht) * cell, x0 + i * cell, z0 + (k + 1) * cell], area: w * ht * cell * cell })
				}
				start = s
			}
			stack.push([start, cur])
		}
	}
	return out
}

const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
const areaOf = (r) => (r[2] - r[0]) * (r[3] - r[1])

/**
 * Regions for a centre line of a road `width` wide on `floor`: up to `max` rects, largest first, then the squarest,
 * each mostly distinct from the ones before.
 */
function freeRegions(floor, obstacles, width, max = 4) {
	const m = width / 2 + 0.25
	const r = floor.rect
	const avail = [r[0] + m, r[1] + m, r[2] - m, r[3] - m]
	if (avail[2] - avail[0] < 2 || avail[3] - avail[1] < 2) return []
	const obs = obstacleRectsAt(obstacles, floor.y).map((o) => [o[0] - m, o[1] - m, o[2] + m, o[3] + m])
		.filter((o) => o[2] > avail[0] && o[0] < avail[2] && o[3] > avail[1] && o[1] < avail[3])
	if (!obs.length) return [avail]
	const cell = Math.max(0.25, Math.max(avail[2] - avail[0], avail[3] - avail[1]) / 240)
	const nx = Math.floor((avail[2] - avail[0]) / cell), nz = Math.floor((avail[3] - avail[1]) / cell)
	const free = new Uint8Array(nx * nz).fill(1)
	for (const o of obs) {
		const i0 = Math.max(0, Math.floor((o[0] - avail[0]) / cell)), i1 = Math.min(nx - 1, Math.ceil((o[2] - avail[0]) / cell) - 1)
		const k0 = Math.max(0, Math.floor((o[1] - avail[1]) / cell)), k1 = Math.min(nz - 1, Math.ceil((o[3] - avail[1]) / cell) - 1)
		for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) free[k * nx + i] = 0
	}
	const all = emptyRects(free, nx, nz, avail[0], avail[1], cell).filter((e) => e.rect[2] - e.rect[0] >= 2 && e.rect[3] - e.rect[1] >= 2)
	const byArea = [...all].sort((a, b) => b.area - a.area || a.rect[0] - b.rect[0] || a.rect[1] - b.rect[1])
	const side = (e) => Math.min(e.rect[2] - e.rect[0], e.rect[3] - e.rect[1])
	const bySide = [...all].sort((a, b) => side(b) - side(a) || b.area - a.area || a.rect[0] - b.rect[0])
	const out = []
	const take = (list, n) => {
		for (const e of list) {
			if (out.length >= max || n <= 0) return
			if (out.some((o) => overlap(o, e.rect) > 0.6 * Math.min(areaOf(o), e.area))) continue
			out.push(e.rect)
			n--
		}
	}
	take(byArea, max - 1)
	take(bySide, 1)
	take(byArea, max)
	return out
}

module.exports = { freeRegions }
