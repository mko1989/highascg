/**
 * Ground model of the RC game (WO-1074, contract v2 §2.1 "Ground model") — pure, node-testable.
 * The server's validator and this client physics MUST agree:
 *
 *   ground(x, z) = the highest of: every floor's `y` whose rect contains (x, z) (hall, stage); the surface of any ramp
 *   of the ACTIVE track whose ribbon footprint contains (x, z). Outside every floor rect there is no ground (null: the
 *   hall rect's edge is a wall).
 *
 * The ramp surface rule lives in ONE function, `rampSurfaceY()`, so it can be reconciled with the server in one place.
 *
 * §2.7 decks (server: src/game/rc-ground.js): a deck range has the ramp surface and footprint; decks and "slab" ramps
 * (both ends join a deck) have no skirts, so with the car's height y a slab counts only while it is ≤ y + REACH
 * (0.75 m) — higher is overhead (the car drives under the bridge). A skirted ramp counts at any height. Ends are cut
 * square END_TOL (5 cm) past the end point. Rails (`railClamp`): a car on a deck or a slab ramp (its y within
 * RAIL_BELOW under / RAIL_ABOVE over the surface, inside the ribbon, not past a square end) stays within
 * half-width − its radius of the centre line; crossing that edge bounces it back like a wall.
 *
 * §3 toy scale: the constants below are the scale-1 values; createGround(floors, T, scale) stores them × scale on the
 * ground object (G.eps, G.stepUp, G.reach, G.endTol, G.slab, G.railBelow, G.railAbove) and every function reads those.
 * Long ramps / decks (2500-point tracks) get a segment grid (seg-grid.js) for their nearest-point queries.
 * §3 occupancy grids (occ.js) ride along as G.occ (the car-height band of each floor).
 */
import { buildSegGrid, forSegsNear } from './seg-grid.js'
import { validScale } from './scale.js'

/** A car is grounded when its y ≤ ground + GROUND_EPS. */
export const GROUND_EPS = 0.02
/** Ground more than STEP_UP above the car's y is a wall. */
export const STEP_UP = 0.3
/** A deck / slab ramp more than REACH above the car is overhead (the car's 0.5 m + the slab's 0.25 m). */
export const REACH = 0.75
/** A ramp / deck end is cut square this far past its end point (a deck ↔ ramp joint leaves no seam). */
export const END_TOL = 0.05
/** A deck's slab thickness (surface to underside) — the server's rc-ground.js DECK_SLAB. */
export const DECK_SLAB = 0.25
/** Rails hold a car whose y is within RAIL_BELOW under … RAIL_ABOVE over the deck surface. */
export const RAIL_BELOW = 0.3
export const RAIL_ABOVE = 1.0

/** Valid floors only: { id, y, rect: [minX, minZ, maxX, maxZ] }. */
export function prepareFloors(floors) {
	const out = []
	for (const f of Array.isArray(floors) ? floors : []) {
		const r = f?.rect
		if (!Array.isArray(r) || r.length !== 4 || !r.every(Number.isFinite)) continue
		if (!(r[2] > r[0] && r[3] > r[1])) continue
		out.push({ id: String(f.id ?? ''), y: Number(f.y) || 0, rect: r.slice() })
	}
	return out
}

/** Highest floor containing (x, z) (rect edges included), or null outside every floor. */
export function floorY(floors, x, z) {
	let y = null
	for (const f of floors) {
		const r = f.rect
		if (x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3] && (y === null || f.y > y)) y = f.y
	}
	return y
}

/**
 * One ramp of a prepared track as plan segments with heights: points ramp.from … ramp.to (forward, wrapping on closed
 * tracks), plus a plan bounding box grown by the half-width for a quick reject.
 */
export function prepareRamp(T, ramp, slab = false, sc = T?.scale ?? 1) {
	const idx = []
	const n = T.n
	if (ramp.to > ramp.from) for (let i = ramp.from; i <= ramp.to; i++) idx.push(i)
	else if (T.closed)
		for (let i = ramp.from; ; i = (i + 1) % n) {
			idx.push(i)
			if (i === ramp.to || idx.length > n) break
		}
	const segs = []
	for (let k = 0; k + 1 < idx.length; k++) {
		const a = idx[k]
		const b = idx[k + 1]
		const ax = T.pts[a][0]
		const az = T.pts[a][1]
		const dx = T.pts[b][0] - ax
		const dz = T.pts[b][1] - az
		const len2 = dx * dx + dz * dz || 1e-12
		segs.push({ ax, az, ay: T.ys[a], dx, dz, dy: T.ys[b] - T.ys[a], len2, tol: (END_TOL * sc) / Math.sqrt(len2) })
	}
	const h = T.half
	const bbox = [Infinity, Infinity, -Infinity, -Infinity]
	for (const i of idx) {
		bbox[0] = Math.min(bbox[0], T.pts[i][0] - h)
		bbox[1] = Math.min(bbox[1], T.pts[i][1] - h)
		bbox[2] = Math.max(bbox[2], T.pts[i][0] + h)
		bbox[3] = Math.max(bbox[3], T.pts[i][1] + h)
	}
	return {
		from: ramp.from,
		to: ramp.to,
		segs,
		slab,
		half: h,
		bbox,
		/* a long ramp / deck: its nearest point comes from a segment grid (only segments within reach are read) */
		grid: segs.length > RAMP_GRID_SEGS ? buildSegGrid(segs, h) : null,
		reach: 0.1 * sc, // extra search radius beyond half-width + pad (rails test half + 0.05 · scale)
	}
}

/** Ramps / decks longer than this many segments get a segment grid. */
export const RAMP_GRID_SEGS = 48

/**
 * THE ramp surface rule (the one function to reconcile with the server's validator):
 * the height of the ramp's centre line at the plan-nearest point of the ramp's segments, linearly interpolated along
 * that segment, when that nearest point is within the ribbon's half-width; otherwise null (not on this ramp).
 * The footprint ends square at both ends of the ramp: a point whose projection falls more than END_TOL before the
 * first segment's start or past the last segment's end is outside (no half-disc of ramp beyond its lip); at interior
 * joints the clamped projection is used, so the footprint has no gaps on the outside of a bend.
 * @returns {number|null}
 */
export function rampSurfaceY(R, x, z) {
	const h = nearestOn(R, x, z)
	return h && h.d <= R.half && !h.beyond ? h.y : null
}

/** Plan-nearest point of a prepared ramp / deck → { d, y, px, pz, beyond } (null outside the bbox grown by `pad`). */
export function nearestOn(R, x, z, pad = 0) {
	const b = R.bbox
	if (x < b[0] - pad || x > b[2] + pad || z < b[1] - pad || z > b[3] + pad) return null
	let best = null
	let bestK = -1
	const last = R.segs.length - 1
	const visit = (k) => {
		const g = R.segs[k]
		const raw = ((x - g.ax) * g.dx + (z - g.az) * g.dz) / g.len2
		const t = raw < 0 ? 0 : raw > 1 ? 1 : raw
		const px = g.ax + g.dx * t
		const pz = g.az + g.dz * t
		const d = Math.hypot(x - px, z - pz)
		/* nearest to an open end, past it: off the (square-ended) footprint */
		if (!best || d < best.d || (d === best.d && k < bestK)) {
			bestK = k
			best = { d, y: g.ay + g.dy * t, px, pz, beyond: (k === 0 && raw < -g.tol) || (k === last && raw > 1 + g.tol) }
		}
	}
	if (!R.grid) {
		for (let k = 0; k <= last; k++) visit(k)
		return best
	}
	/* the full scan's answer whenever it lies within the search radius; beyond it nothing counts anyway (rampSurfaceY
	 * wants d ≤ half, railClamp d ≤ half + 0.05 · scale) → "far" */
	forSegsNear(R.grid, x, z, R.half + pad + R.reach, visit)
	return best || { d: Infinity, y: 0, px: x, pz: z, beyond: true }
}

/** Is ramp r of T a slab ramp (both its ends join a deck)? */
export function isSlabRamp(T, r) {
	const decks = T?.decks || []
	return decks.some((d) => d.to === r.from) && decks.some((d) => d.from === r.to)
}

/**
 * Ground of a race: the scene floors plus the ramps of the ACTIVE track.
 * @param {object[]} floors scene floors ({ id, y, rect })
 * @param {object|null} T prepared track
 */
export function createGround(floors, T, scale) {
	const k = validScale(scale ?? T?.scale)
	const fl = prepareFloors(floors)
	const ramps = T ? (T.ramps || []).map((r) => prepareRamp(T, r, isSlabRamp(T, r), k)).filter((r) => r.segs.length) : []
	const decks = T ? (T.decks || []).map((d) => prepareRamp(T, d, true, k)).filter((r) => r.segs.length) : []
	return {
		floors: fl,
		ramps: [...ramps, ...decks],
		rails: [...ramps.filter((r) => r.slab), ...decks],
		scale: k,
		eps: GROUND_EPS * k,
		stepUp: STEP_UP * k,
		reach: REACH * k,
		endTol: END_TOL * k,
		slab: DECK_SLAB * k,
		railBelow: RAIL_BELOW * k,
		railAbove: RAIL_ABOVE * k,
		occ: null,
	}
}

/**
 * ground(x, z, y) per the contract: highest floor / ramp / deck surface, or null outside every floor rect. With the
 * car's y, a deck or slab ramp more than REACH above it does not count (it is overhead); without y everything counts.
 */
export function groundAt(G, x, z, y = Infinity) {
	const f = floorY(G.floors, x, z)
	if (f === null) return null
	const top = y + (G.reach ?? REACH)
	let g = f
	for (const R of G.ramps) {
		const r = rampSurfaceY(R, x, z)
		if (r !== null && r > g && (!R.slab || r <= top)) g = r
	}
	return g
}

/**
 * Rails (§2.7): a car moving (ox, oz) → (x, z) at height y while on a deck / slab ramp is held within
 * half-width − radius of its centre line (not past a square-cut end: the open ends lead on and off).
 * → null (free) or { x, z, nx, nz } (the clamped position and the inward normal to bounce off).
 */
export function railClamp(G, ox, oz, x, z, y, radius) {
	const k = G.scale ?? 1
	for (const R of G.rails || []) {
		const a = nearestOn(R, ox, oz)
		if (
			!a ||
			a.beyond ||
			a.d > R.half + 0.05 * k ||
			y < a.y - (G.railBelow ?? RAIL_BELOW) ||
			y > a.y + (G.railAbove ?? RAIL_ABOVE)
		)
			continue
		const b = nearestOn(R, x, z, 2 * k)
		const lim = R.half - radius
		if (!b || b.beyond || b.d <= lim) continue
		const ux = (x - b.px) / b.d
		const uz = (z - b.pz) / b.d
		return { x: b.px + ux * lim, z: b.pz + uz * lim, nx: -ux, nz: -uz }
	}
	return null
}

/** Underside of the lowest deck / slab ramp overhead a car at height y at (x, z) (a bridge), or Infinity. */
export function ceilingAt(G, x, z, y) {
	let c = Infinity
	const reach = G.reach ?? REACH
	const slab = G.slab ?? DECK_SLAB
	for (const R of G.rails || []) {
		const r = rampSurfaceY(R, x, z)
		if (r !== null && r > y + reach && r - slab < c) c = r - slab
	}
	return c
}

/** Ground under the floors only (no ramps) — where a ramp's side skirt ends. */
export function floorOnlyAt(G, x, z) {
	return floorY(G.floors, x, z)
}

/** A horizontal move into (x, z) is blocked for a car at height y: no ground there, or ground > y + STEP_UP. */
export function blockedAt(G, x, z, y) {
	const g = groundAt(G, x, z, y)
	return g === null || g > y + (G.stepUp ?? STEP_UP)
}
