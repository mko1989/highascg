'use strict'

/**
 * WO-1074 §3 — routed toy-scale tracks (pure, deterministic; unit frame — rc-scale.js). The hall is a landscape of
 * table and chair footprints at toy height, so these tracks are not fitted shapes but routes: A* on the hall's
 * occupancy clearance (rc-toy-plan.js) from target to target, each leg kept a track width away from the legs before
 * it, string-pulled, then rounded until every turn is ≥ RH and the ribbon keeps width/2 + 1 cell (+ MARGIN).
 *   tour(ctx, spec)  — a whole-room tour: up a ramp onto the stage, across it on a U, down a ramp or off the edge (a
 *                      drop) on a straight leg, then through the hall to the far end and back (kind 'room-long', 1 lap);
 *   weave(ctx, spec) — a hall loop through the aisles around a block of tables (kind 'hall').
 * ctx: { U (unit scene), hall, stage, pg (hall plan grid, the stage as a wall), oc (occupancy cell, unit), onReject? }.
 * Each → the built track (validateTrack has passed on the unit scene) or null.
 */

const G = require('./rc-track-geo')
const PL = require('./rc-track-plan')
const T = require('./rc-toy-plan')
const { buildTrack, rampSteps, DROP_RUN } = require('./rc-track-build')
const { validateTrack } = require('./rc-track-check')
const { RS, RH } = require('./rc-track-room')
const { LAND_RUN } = require('./rc-track-check-occ')

const SP = 0.5
const MARGIN = 0.3 // unit: clearance the router keeps over the rule (width/2 + 1 cell)
const R_HALL = RH + 0.4 // the smoothing's turn radius (rule 3)
const R_STAGE = RS + 0.25
const TIP = 8 // straight leg beyond the ramp / drop run before the route takes over
const PULL = 2 // unit: the string pulling keeps this much more (rounding a taut corner cuts in towards what it hugs)
const LEAD = 6 // the route's first / last stop lies this much further out along the leg
const MAX_POINTS = 2500
const MAX_LENGTH = 2000 // unit (200 m at scale 0.1; 2500 points keep the spacing ≤ 0.8, under 0.5 × width)

const needOf = (width, oc) => width / 2 + oc + MARGIN

/** Mark cells within r of the cell-centre path `path` (except its first `skipHead` and last `skipTail` cells). */
function forbidPath(pg, mask, path, r, skipTail = 0, skipHead = 0) {
	const R = Math.ceil(r / pg.cell)
	for (let p = skipHead; p < path.length - skipTail; p++) {
		const q = pg.idx(path[p][0], path[p][1])
		if (q < 0) continue
		const i0 = q % pg.nx, k0 = Math.floor(q / pg.nx)
		for (let k = Math.max(0, k0 - R); k <= Math.min(pg.nz - 1, k0 + R); k++) {
			for (let i = Math.max(0, i0 - R); i <= Math.min(pg.nx - 1, i0 + R); i++) if ((i - i0) ** 2 + (k - k0) ** 2 <= R * R) mask[k * pg.nx + i] = 1
		}
	}
}

/** Points every SP along segment a→b (a included, b excluded). */
const seg = (a, b) => T.dense([a, b])

/** Arc around c from angle t0 to t1 (radians, either way), every SP; first point included, last excluded. */
function arc(c, r, t0, t1) {
	const m = Math.max(2, Math.ceil((Math.abs(t1 - t0) * r) / SP))
	return Array.from({ length: m }, (_, j) => {
		const t = t0 + ((t1 - t0) * j) / m
		return [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]
	})
}

/**
 * Route S → targets… → E through the hall (each leg kept 2 × width + 1 away from the ones before and from `avoid`,
 * cell-centre paths) → the pulled polyline [S, …, E] or null.
 */
function routeThrough(pg, S, targets, E, need, width, avoid = []) {
	const mask = new Uint8Array(pg.nx * pg.nz)
	const r = width * 2 + 1
	for (const path of avoid) forbidPath(pg, mask, path, r)
	const stops = [S, ...targets.map((t) => T.snap(pg, t, need + T.PREFER, 60) || T.snap(pg, t, need, 60)), E]
	if (stops.some((p) => !p)) return null
	const legs = []
	const skip = Math.ceil(r / pg.cell) + 2
	const closed = G.dist(S, E) < 1e-9 // a loop: the first leg's head stays open for the last leg to arrive
	for (let j = 0; j + 1 < stops.length; j++) {
		const path = T.route(pg, stops[j], stops[j + 1], need, { forbid: mask })
		if (!path) return null
		legs.push(path)
		forbidPath(pg, mask, path, r, skip, closed && j === 0 ? skip : 0)
	}
	const out = [S]
	for (const path of legs) out.push(...T.pull(pg, path, need + PULL).slice(1))
	out[out.length - 1] = E
	return out
}

/** Dense closed loop from the open dense `fixed` part (pinned) followed by the routed polyline `poly` (free). */
function closeLoop(fixed, poly) {
	const free = T.dense(T.chaikin(poly, 4))
	const loop = [...fixed, ...free]
	const pinned = new Uint8Array(loop.length)
	pinned.fill(1, 0, fixed.length)
	if (free.length) pinned[fixed.length] = 1 // S itself
	return { loop, pinned }
}

/** Resample a closed loop to ≈ SP spacing (the smoothing moves points apart). */
const even = (loop) => G.resampleClosed(loop, Math.max(8, Math.round(G.polyLength(loop) / SP)))

/** The stage part of a tour in the edge frame: up the leg at u = a, a U at depth dc, down the leg at u = b → world. */
function stagePart(fr, a, b, dc, vT) {
	const d = Math.sign(b - a), R = R_STAGE
	const L = (p) => fr.toWorld(p)
	const local = [
		...seg([a, vT], [a, -dc + R]),
		...arc([a + d * R, -dc + R], R, d > 0 ? Math.PI : 0, d > 0 ? 1.5 * Math.PI : -0.5 * Math.PI),
		...seg([a + d * R, -dc], [b - d * R, -dc]),
		...arc([b - d * R, -dc + R], R, d > 0 ? 1.5 * Math.PI : -0.5 * Math.PI, d > 0 ? 2 * Math.PI : -Math.PI),
		...seg([b, -dc + R], [b, vT]),
	]
	return local.map(L)
}

/** Build + validate on the unit scene → track or null. */
function finish(ctx, loop, meta) {
	const t = buildTrack(even(loop), { maxPoints: MAX_POINTS, maxLength: MAX_LENGTH, ...meta }, ctx.U)
	const v = t ? validateTrack(t, ctx.U) : { ok: false, errors: ['not built'] }
	if (!v.ok && ctx.onReject) ctx.onReject(meta.id, v.errors[0]) // probes: why a candidate was dropped
	return v.ok ? t : null
}

/**
 * A whole-room tour. spec: { id, name, width, exit: 'ramp' | 'drop', aims: [[wu, wv]] (each stop is the reachable
 * hall cell farthest along wu·u + wv·v in the stage edge's frame: u along the edge, v out into the hall), legs: [[a, b]
 * as fractions of the stage edge], kind, gridRun }.
 */
function tour(ctx, spec) {
	const { hall, stage, pg, oc } = ctx
	const width = spec.width, half = width / 2
	const need = needOf(width, oc)
	const fr = PL.edgeFrames(stage.rect).map((f) => ({ f, hr: PL.rectIn(f, hall.rect), sr: PL.rectIn(f, stage.rect) }))
		.sort((p, q) => q.hr[3] - p.hr[3])[0]
	const { f, sr } = fr
	const k = rampSteps(stage.y - hall.y, SP)
	const run = spec.exit === 'drop' ? Math.ceil(DROP_RUN / SP) * SP + LAND_RUN + 1.5 : (k + 3) * SP
	const vL = Math.max((k + 3) * SP, run) + 1
	const vT = vL + TIP
	const dc = R_STAGE + 1.15
	const span = sr[2] - sr[0]
	for (const [fa, fb] of spec.legs) {
		const a = sr[0] + half + 0.3 + fa * span, b = sr[0] + fb * span - half - 0.3
		if (Math.abs(b - a) < 2 * R_STAGE + width) continue
		const fixed = stagePart(f, a, b, dc, vT)
		const S = f.toWorld([b, vT]), E = f.toWorld([a, vT])
		const legPath = (u) => T.dense([f.toWorld([u, 0]), f.toWorld([u, vL])])
		const seen = T.reach(pg, f.toWorld([b, vT + LEAD]), need)
		if (!seen) continue
		const targets = spec.aims.map(([wu, wv]) => T.extreme(pg, seen, need, (x, z) => {
			const [u, v] = f.fromWorld([x, z])
			return wu * u + wv * v
		}))
		if (targets.some((p) => !p)) continue
		// the route starts and ends LEAD further out along the legs, so the rounded joint stays tangent to them
		const mid = routeThrough(pg, f.toWorld([b, vT + LEAD]), targets, f.toWorld([a, vT + LEAD]), need, width, [legPath(a), legPath(b)])
		if (!mid) continue
		const poly = [S, ...mid, E]
		const { loop, pinned } = closeLoop(fixed, poly)
		const smooth = T.smooth(loop, pinned, pg.lerp, need, R_HALL)
		if (!smooth) continue
		const t = finish(ctx, smooth, { id: spec.id, name: spec.name, floor: 'room', kind: spec.kind || 'room-long', y: hall.y, width,
			gridRun: spec.gridRun, straightGrid: !!spec.gridRun, features: { room: { stage, hallY: hall.y, exits: [spec.exit] } } })
		if (t) return t
	}
	return null
}

/** A hall loop through `targets` (world, unit) in order and back. spec: { id, name, width, targets, features }. */
function weave(ctx, spec) {
	const { hall, pg, oc } = ctx
	const need = needOf(spec.width, oc)
	const [S, ...rest] = spec.targets
	const s0 = T.snap(pg, S, need + T.PREFER, 30)
	if (!s0) return null
	const poly = routeThrough(pg, s0, rest, s0, need, spec.width)
	if (!poly) return null
	poly.pop()
	const ring = T.chaikin(poly, 4, true)
	const loop = T.dense([...ring, ring[0]])
	const smooth = T.smooth(loop, new Uint8Array(loop.length), pg.lerp, need, R_HALL)
	if (!smooth) return null
	return finish(ctx, smooth, { id: spec.id, name: spec.name, floor: 'hall', kind: 'hall', y: hall.y, width: spec.width, features: spec.features || {} })
}

module.exports = { tour, weave, MAX_POINTS, MAX_LENGTH }
