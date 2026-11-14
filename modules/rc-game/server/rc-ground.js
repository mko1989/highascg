'use strict'

/**
 * WO-1074 v2 — the ground model the server's validator and the browser's physics share (work/notes/rc-game-contract.md
 * §2.1 "Ground model"). Pure.
 *
 *   ground(scene, track, x, z) = the highest of
 *     - every floor's y whose rect contains (x, z) (rect edges inclusive),
 *     - the surface of every ramp of `track` whose footprint contains (x, z);
 *   null outside every floor rect (no ground, the hall edge is a wall — a ramp does not count there).
 *
 * Ramp surface (`rampHeight`): a ramp { from, to } is the centre polyline points[from], points[from + 1], …, points[to]
 * (indices wrap past the end when to < from). For (x, z), every segment A→B of that polyline gives, in plan,
 * u = ((P − A)·(B − A)) / |B − A|² (unclamped), t = clamp(u, 0, 1) and d = |P − (A + t (B − A))|. The segment with the
 * smallest d wins (the earlier one on a tie). (x, z) is on the ramp when d ≤ width / 2, except beyond the two ends: on
 * the FIRST segment u < 0 and on the LAST segment u > 1 are off the ramp (the ends are cut square, not rounded; §2.7:
 * 5 cm past the end point still counts — END_TOL — so a deck meeting a ramp leaves no seam). The height there is
 * A.y + t · (B.y − A.y).
 *
 * §2.7 decks: a deck { from, to } has exactly the ramp surface and footprint above. Decks, and "slab" ramps (a ramp
 * whose both ends join a deck: an elevated ramp between two decks, drawn on pillars like a deck), have no skirts, so a
 * car can be UNDER them: with the car's height y, a slab surface counts only while it is at most REACH (0.75 m = the
 * car's 0.5 m + the slab's 0.25 m) above the car — higher is overhead (a bridge), at most REACH above is ground (and
 * a wall when > 0.3 above, the slab's edge). A skirted ramp counts at any height (its skirts are walls). Without y
 * (y = Infinity) everything counts: the v2 rule.
 *
 *   ground(scene, track, x, z, y) = the highest of the floors under (x, z), every skirted ramp surface there and every
 *   slab (deck / slab ramp) surface there that is ≤ y + REACH.
 */

const GROUND_TOL = 0.02 // a car is grounded within this of the ground; a track point lies on it within this
const WALL_STEP = 0.3 // ground more than this above the car is a wall
const CAR_TOP = 0.5 // a car occupies [y, y + 0.5] for obstacle tests
const DECK_SLAB = 0.25 // a deck's slab thickness (surface to underside)
const REACH = CAR_TOP + DECK_SLAB // a slab more than this above the car is overhead
const END_TOL = 0.05 // a ramp / deck end is cut square this far (m) past its end point (a deck ↔ ramp joint has no seam)

/** Indices of a ramp's centre polyline, from → to in driving order (wrapping), or [] when malformed. */
function rampIndices(ramp, n) {
	if (!ramp || !Number.isInteger(ramp.from) || !Number.isInteger(ramp.to)) return []
	if (ramp.from < 0 || ramp.to < 0 || ramp.from >= n || ramp.to >= n || ramp.from === ramp.to) return []
	const out = []
	for (let i = ramp.from; ; i = (i + 1) % n) {
		out.push(i)
		if (i === ramp.to) return out
	}
}

/** Height of one ramp's surface at (x, z), or null off its footprint (see the header). */
function rampHeight(track, ramp, x, z) {
	const pts = track.points
	const idx = rampIndices(ramp, pts.length)
	if (idx.length < 2) return null
	let best = null
	for (let k = 0; k < idx.length - 1; k++) {
		const A = pts[idx[k]], B = pts[idx[k + 1]]
		const dx = B[0] - A[0], dz = B[2] - A[2]
		const l2 = dx * dx + dz * dz
		const u = l2 ? ((x - A[0]) * dx + (z - A[2]) * dz) / l2 : 0
		const t = u < 0 ? 0 : u > 1 ? 1 : u
		const d = Math.hypot(x - A[0] - t * dx, z - A[2] - t * dz)
		if (!best || d < best.d) best = { d, u, t, k, A, B }
	}
	if (best.d > track.width / 2) return null
	const tol = END_TOL / (Math.hypot(best.B[0] - best.A[0], best.B[2] - best.A[2]) || 1)
	if (best.k === 0 && best.u < -tol) return null
	if (best.k === idx.length - 2 && best.u > 1 + tol) return null
	return best.A[1] + best.t * (best.B[1] - best.A[1])
}

/** The highest floor whose rect contains (x, z) → its y, or null. */
function floorGround(scene, x, z) {
	let g = null
	for (const f of scene?.floors || []) {
		const r = f?.rect
		if (r && x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3] && (g == null || f.y > g)) g = f.y
	}
	return g
}

/** Is ramp `r` a slab ramp (both ends join a deck of `track`)? */
function slabRamp(track, r) {
	const decks = track?.decks || []
	return decks.some((d) => d.to === r.from) && decks.some((d) => d.from === r.to)
}

/**
 * The ground model: floors + the ramps and decks of `track` (may be null: floors only) for a car at height `y`
 * (default Infinity: every surface counts). opts.ramps === false leaves the ramps out (floors + decks: the flat road).
 */
function ground(scene, track, x, z, y = Infinity, opts = {}) {
	let g = floorGround(scene, x, z)
	if (g == null) return null // ramps only count over a floor (same as the client's game/rc/ground.js groundAt)
	const top = y + REACH
	if (opts.ramps !== false) {
		for (const r of track?.ramps || []) {
			const h = rampHeight(track, r, x, z)
			if (h != null && h > g && (h <= top || !slabRamp(track, r))) g = h
		}
	}
	for (const d of track?.decks || []) {
		const h = rampHeight(track, d, x, z)
		if (h != null && h > g && h <= top) g = h
	}
	return g
}

/** Does obstacle `o` (3D AABB) touch a car whose y moves within [yLo, yHi]? (contract: [min.y, max.y] ∩ [y, y + 0.5]) */
const obstacleHits = (o, yLo, yHi = yLo) => o.max[1] > yLo + GROUND_TOL && o.min[1] < yHi + CAR_TOP

module.exports = { GROUND_TOL, WALL_STEP, CAR_TOP, DECK_SLAB, REACH, END_TOL, ground, floorGround, rampHeight, rampIndices, slabRamp, obstacleHits }
