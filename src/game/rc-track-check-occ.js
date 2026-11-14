'use strict'

/**
 * WO-1074 §3 — the toy-scale half of `validateTrack` (rc-track-check.js): the track's ribbon against the occupancy grids
 * of the floors (rc-scene-occ.js). Runs on the unit-frame track (rc-scale.js `toUnitScene`), the grids are in world
 * metres: every query multiplies by `scene.toy.s`. Rules (contract §3 "Obstacles at toy height"):
 *   - a road segment whose ends lie in a floor's car band (floor.y − 0.02 … + CAR_TOP, unit) keeps its centre line
 *     ≥ width/2 + 1 cell away from every blocked cell of that floor's grid (the ribbon never touches one);
 *   - a deck or slab ramp (no skirts, pillars below) has no blocked cell under its footprint (width/2);
 *   - a drop's landing run (to LAND_RUN past `land`) is clear of blocked cells by a full width + 1 cell (v2's landing
 *     rule × scale), cells inside the ledge's own floor rect + 0.3 (unit) not counted.
 */

const G = require('./rc-track-geo')
const { GROUND_TOL, CAR_TOP, floorGround } = require('./rc-ground')
const { segSquare } = require('./rc-scene-occ')

const LAND_RUN = 4

/** → error text or null. ctx: { P (plan, unit), Y, n, half, width, book (deckSeg, slabSeg), dropSeg, along }. */
function checkOcc(track, scene, ctx) {
	const toy = scene?.toy
	if (!toy || !Array.isArray(toy.occ) || !toy.occ.length) return null
	const s = toy.s
	const { P, Y, n, half, width, book, along } = ctx
	const floors = (scene.floors || []).filter((f) => toy.occ.some((g) => g.floor === f.id))
	const grid = (f) => toy.occ.find((g) => g.floor === f.id)
	const near = (g, i, j, r) => g.segNear(P[i][0] * s, P[i][1] * s, P[j][0] * s, P[j][1] * s, r)
	const inBand = (y, f) => y >= f.y - GROUND_TOL && y <= f.y + CAR_TOP
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n
		const mx = (P[i][0] + P[j][0]) / 2, mz = (P[i][1] + P[j][1]) / 2
		for (const f of floors) {
			if (!(inBand(Y[i], f) || inBand(Y[j], f)) || !G.inRect(mx, mz, f.rect)) continue
			const g = grid(f)
			const r = half * s + g.cell
			const d = near(g, i, j, r)
			if (d < r) return `toy: a blocked cell of the ${f.id} within width/2 + 1 cell of the road at ${i} (${(d / s).toFixed(2)})`
		}
		if (book && (book.deckSeg[i] || book.slabSeg[i])) {
			const gy = floorGround(scene, mx, mz)
			const f = floors.find((q) => q.y === gy && G.inRect(mx, mz, q.rect))
			if (f && near(grid(f), i, j, half * s) < half * s) return `toy: a deck stands over a blocked cell of the ${f.id} at ${i}`
		}
	}
	for (const [k, d] of (track.drops || []).entries()) {
		const ledge = (scene.floors || []).find((f) => Math.abs(f.y - Y[d.at]) <= GROUND_TOL && G.inRect(P[d.at][0], P[d.at][1], f.rect))
		const cut = ledge ? [ledge.rect[0] - 0.3, ledge.rect[1] - 0.3, ledge.rect[2] + 0.3, ledge.rect[3] + 0.3] : null
		const land = floors.find((f) => Math.abs(f.y - Y[d.land]) <= GROUND_TOL && G.inRect(P[d.land][0], P[d.land][1], f.rect))
		if (!land) continue
		const g = grid(land)
		const r = width * s + g.cell
		for (let i = (d.at + 1) % n, m = 0; m < n; i = (i + 1) % n, m++) {
			const j = (i + 1) % n
			if (along(d.land, i) >= LAND_RUN && along(d.at, i) > along(d.at, d.land)) break
			if (nearOutside(g, P[i], P[j], s, r, cut)) return `toy: drop ${k}: landing not clear of blocked cells by a track width at ${i}`
		}
	}
	return null
}

/** Any blocked cell within r (world) of segment a→b (unit) whose centre lies outside `cut` (unit rect)? */
function nearOutside(g, a, b, s, r, cut) {
	if (!cut) return g.segNear(a[0] * s, a[1] * s, b[0] * s, b[1] * s, r) < r
	const ax = a[0] * s, az = a[1] * s, bx = b[0] * s, bz = b[1] * s
	const c = g.cell
	const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - g.x0) / c)), i1 = Math.min(g.w - 1, Math.floor((Math.max(ax, bx) + r - g.x0) / c))
	const k0 = Math.max(0, Math.floor((Math.min(az, bz) - r - g.z0) / c)), k1 = Math.min(g.h - 1, Math.floor((Math.max(az, bz) + r - g.z0) / c))
	for (let k = k0; k <= k1; k++) {
		for (let i = i0; i <= i1; i++) {
			if (!g.bits[k * g.w + i]) continue
			const cx = g.x0 + (i + 0.5) * c, cz = g.z0 + (k + 0.5) * c
			if (G.inRect(cx / s, cz / s, cut)) continue
			if (segSquare(ax, az, bx, bz, g.x0 + i * c, g.z0 + k * c, c) < r) return true
		}
	}
	return false
}

module.exports = { checkOcc, LAND_RUN }
