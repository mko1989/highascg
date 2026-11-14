'use strict'

/**
 * WO-1074 v2 — the second half of `validateTrack` (rc-track-check.js): checkpoints, the 10-slot start grid, boost pads
 * and item-box rows (contract §2.1: 2–4 pads, 2–3 rows of 3–4 boxes, never on a ramp, a drop or within 6 m of the start
 * line). Pure; called with the geometry the first half already measured.
 */

const G = require('./rc-track-geo')
const { GROUND_TOL, ground, obstacleHits } = require('./rc-ground')

const GRID_SLOTS = 10
const CAR_CLEAR = 0.26 // half the car's diagonal (0.45 × 0.25 m)
const START_CLEAR = 6 // pads / boxes keep this far (along the track) from the start line, both ways
const FEATURE_CLEAR = 2 // … and this far from a ramp or a drop
const PADS = [2, 4]
const ROWS = [2, 3]
const PADS_MAX = 6 // §2.7: a long track may carry more (limits grow with the length, see limitsFor)
const ROWS_MAX = 5
const ROW_BOXES = [3, 4]
const BOX_LIFT = [0.3, 0.8] // a box floats this high above the road
const ROW_GAP = 1 // boxes within 1 m (along) form one row
const finite = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * Nearest centre-line segment to (x, z) → { i, t, d, at (plan distance from point 0 along the track) }. With `y` (and
 * ctx.Y) a height mismatch beyond 0.6 m costs 4 m per metre, so a thing on a bridge is not matched to the road below.
 */
function nearest(ctx, x, z, y = null) {
	const { P, s, n, Y } = ctx
	let best = null
	for (let i = 0; i < n; i++) {
		const pr = G.project([x, z], P[i], P[(i + 1) % n])
		const dy = y == null || !Y ? 0 : Math.max(0, Math.abs(y - (Y[i] + pr.t * (Y[(i + 1) % n] - Y[i]))) - 0.6)
		const score = pr.d + 4 * dy
		if (!best || score < best.score) best = { i, t: pr.t, d: pr.d, score }
	}
	best.at = s[best.i] + best.t * G.dist(P[best.i], P[(best.i + 1) % n])
	return best
}

/** Distance along the track between two positions (either way round, the shorter). */
const gap = (a, b, L) => Math.min(Math.abs(a - b), L - Math.abs(a - b))

/** May a pad / box sit at plan position `at` (metres from the start line)? */
function featureFree(ctx, at) {
	const { s, L, n, rampSeg, dropSeg } = ctx
	if (gap(at, 0, L) < START_CLEAR) return false
	for (let i = 0; i < n; i++) {
		if (!rampSeg[i] && !dropSeg[i]) continue
		const a = s[i], b = i + 1 < n ? s[i + 1] : L
		if (at >= a - FEATURE_CLEAR && at <= b + FEATURE_CLEAR) return false
		if (gap(at, a, L) < FEATURE_CLEAR || gap(at, b, L) < FEATURE_CLEAR) return false
	}
	return true
}

/**
 * Pad / box-row limits for a track of length L: [min, max] pads and rows. Up to 100 m the v2 limits (2–4 pads, 2–3
 * rows); longer tracks may carry one more pad per 25 m and one more row per 30 m: max pads = clamp(round(L / 25), 4, 6),
 * max rows = clamp(round(L / 30), 3, 5).
 */
function limitsFor(L) {
	const c = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
	return { pads: [PADS[0], c(Math.round(L / 25), PADS[1], PADS_MAX)], rows: [ROWS[0], c(Math.round(L / 30), ROWS[1], ROWS_MAX)] }
}

/** A thing lying flat on the road (a floor or a deck, not a ramp) at (x, y, z)? → error text or null. */
function onFlatRoad(scene, track, x, y, z) {
	const g = ground(scene, track, x, z, y), g0 = ground(scene, track, x, z, y, { ramps: false })
	if (g == null || g0 == null) return 'off the floor'
	if (Math.abs(g - g0) > GROUND_TOL) return 'on a ramp'
	if (Math.abs(y - g) > GROUND_TOL) return `not on the ground (y ${y}, ground ${g})`
	return null
}

function checkDeco(track, scene, ctx) {
	const { P, n, half, L, flight, rampSeg, dropSeg, near, errors } = ctx
	const fail = (m) => (errors.push(m), { ok: false, errors })
	const dirAt = (i) => {
		const a = P[i], b = P[(i + 1) % n]
		return G.yawOf(b[0] - a[0], b[1] - a[1])
	}

	const cp = track.checkpoints
	if (!Array.isArray(cp) || cp.length < 3 || cp[0] !== 0) return fail('checkpoints must start at 0 (≥ 3)')
	for (let i = 0; i < cp.length; i++) {
		if (!Number.isInteger(cp[i]) || cp[i] < 0 || cp[i] >= n || (i && cp[i] - cp[i - 1] < 2)) return fail('checkpoints not increasing indices')
		if (flight[cp[i]]) return fail(`checkpoint ${i} is in the air (a drop)`)
	}

	const g = track.grid
	if (!Array.isArray(g) || g.length !== GRID_SLOTS) return fail('grid must have 10 slots')
	const t0 = [P[1][0] - P[n - 1][0], P[1][1] - P[n - 1][1]]
	for (let k = 0; k < g.length; k++) {
		const sl = g[k]
		if (!sl || ![sl.x, sl.y, sl.z, sl.yaw].every(finite)) return fail(`grid ${k} not finite`)
		const bad = onFlatRoad(scene, track, sl.x, sl.y, sl.z)
		if (bad) return fail(`grid ${k} ${bad}`)
		for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
			const c = ground(scene, track, sl.x + dx * CAR_CLEAR, sl.z + dz * CAR_CLEAR, sl.y)
			if (c == null || Math.abs(c - sl.y) > GROUND_TOL) return fail(`grid ${k} too close to an edge`)
		}
		const p = [sl.x, sl.z]
		if (near.some((o) => obstacleHits(o, sl.y) && G.pointRectDist(p, [o.min[0], o.min[2], o.max[0], o.max[2]]) < CAR_CLEAR)) return fail(`grid ${k} in an obstacle`)
		if ((p[0] - P[0][0]) * t0[0] + (p[1] - P[0][1]) * t0[1] >= 0) return fail(`grid ${k} not behind the start line`)
		const at = nearest(ctx, sl.x, sl.z, sl.y)
		if (at.d > half + 0.05 || G.angleDiff(sl.yaw, dirAt(at.i)) > 0.35) return fail(`grid ${k} not on the road facing the driving direction`)
		if (rampSeg[at.i] || dropSeg[at.i]) return fail(`grid ${k} on a ramp or a drop`)
		for (let j = 0; j < k; j++) if (Math.hypot(sl.x - g[j].x, sl.z - g[j].z) < 0.5) return fail(`grid ${k} overlaps ${j}`)
	}

	const lim = limitsFor(L)
	const pads = track.pads
	if (!Array.isArray(pads) || pads.length < lim.pads[0] || pads.length > lim.pads[1]) return fail(`pads: ${pads?.length} (${lim.pads.join('–')})`)
	const padAt = []
	for (const [k, pd] of pads.entries()) {
		if (!pd || ![pd.x, pd.y, pd.z, pd.yaw].every(finite)) return fail(`pad ${k} not finite`)
		const bad = onFlatRoad(scene, track, pd.x, pd.y, pd.z)
		if (bad) return fail(`pad ${k} ${bad}`)
		const at = nearest(ctx, pd.x, pd.z, pd.y)
		if (at.d > half - 0.5) return fail(`pad ${k} not on the road`)
		if (G.angleDiff(pd.yaw, dirAt(at.i)) > 0.35) return fail(`pad ${k} does not face the driving direction`)
		if (!featureFree(ctx, at.at)) return fail(`pad ${k} on / near a ramp, a drop or the start line`)
		if (padAt.some((a) => gap(a, at.at, L) < 3)) return fail(`pad ${k} too close to another pad`)
		padAt.push(at.at)
	}

	const boxes = track.boxes
	if (!Array.isArray(boxes)) return fail('boxes must be an array')
	const ids = new Set()
	const placed = []
	for (const [k, b] of boxes.entries()) {
		if (!b || !Number.isInteger(b.id) || b.id < 0 || ids.has(b.id)) return fail(`box ${k}: ids must be unique integers ≥ 0`)
		ids.add(b.id)
		if (![b.x, b.y, b.z].every(finite)) return fail(`box ${k} not finite`)
		const below = b.y - BOX_LIFT[1] - GROUND_TOL // the road under a box is at most 0.8 m below it
		const gb = ground(scene, track, b.x, b.z, below), g0 = ground(scene, track, b.x, b.z, below, { ramps: false })
		if (gb == null || g0 == null || Math.abs(gb - g0) > GROUND_TOL) return fail(`box ${k} not over the flat road`)
		if (b.y - gb < BOX_LIFT[0] || b.y - gb > BOX_LIFT[1]) return fail(`box ${k} does not float 0.3–0.8 m above the road`)
		const at = nearest(ctx, b.x, b.z, b.y - 0.5)
		if (at.d > half - 0.3) return fail(`box ${k} not over the road`)
		if (!featureFree(ctx, at.at)) return fail(`box ${k} on / near a ramp, a drop or the start line`)
		if (padAt.some((a) => gap(a, at.at, L) < 2)) return fail(`box ${k} on a pad`)
		if (placed.some((q) => Math.hypot(q.x - b.x, q.z - b.z) < 0.6)) return fail(`box ${k} overlaps another box`)
		placed.push({ x: b.x, z: b.z, at: at.at })
	}
	placed.sort((a, b) => a.at - b.at)
	const rows = []
	for (const q of placed) {
		const last = rows[rows.length - 1]
		if (last && q.at - last[last.length - 1].at <= ROW_GAP) last.push(q)
		else rows.push([q])
	}
	if (rows.length > 1 && gap(rows[0][0].at, rows[rows.length - 1][0].at, L) <= ROW_GAP) rows[0].push(...rows.pop())
	if (rows.length < lim.rows[0] || rows.length > lim.rows[1]) return fail(`box rows: ${rows.length} (${lim.rows.join('–')})`)
	for (const r of rows) if (r.length < ROW_BOXES[0] || r.length > ROW_BOXES[1]) return fail(`a box row of ${r.length} (3–4)`)
	return { ok: true, errors }
}

module.exports = { checkDeco, featureFree, nearest, limitsFor, GRID_SLOTS, START_CLEAR, BOX_LIFT }
