'use strict'

/**
 * WO-1074 §3 — routed toy-scale tracks (pure, deterministic; unit frame — rc-scale.js). The hall is a landscape of
 * table and chair footprints at toy height, so these tracks are not fitted shapes but routes: A* on the hall's
 * occupancy clearance (rc-toy-plan.js) from target to target, each leg kept a track width away from the legs before
 * it, string-pulled, then rounded until every turn is ≥ RH and the ribbon keeps width/2 + 1 cell (+ MARGIN).
 *   tour(ctx, spec)  — a whole-room tour: up a ramp onto the stage, across it on a U, down a ramp or off the edge (a
 *                      drop) on a straight leg, then through the hall to the far end and back (kind 'room-long', 1 lap);
 *   weave(ctx, spec) — a hall loop through the aisles around a block of tables (kind 'hall');
 *   tunnelLoop(ctx, spec) — §3.1: a hall loop through a tunnel under a table (rc-toy-tunnel.js corridors);
 *   a tour with `tunnel: true` first tries its route through the cheapest corridors, then without one.
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
const TN = require('./rc-toy-tunnel')

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
 * cell-centre paths) → the pulled polyline [S, …, E] or null. §3.1: a target `{ via: [A2, B2], line }` is a tunnel
 * corridor — the route arrives at A2 exactly, runs straight to B2 (not routed) and leaves from there; every `line` (the
 * dense pinned straight) is kept clear like `avoid` from the start.
 */
function routeThrough(pg, S, targets, E, need, width, avoid = []) {
	const mask = new Uint8Array(pg.nx * pg.nz)
	const r = width * 2 + 1
	for (const path of [...avoid, ...targets.filter((t) => t?.via).map((t) => t.line)]) forbidPath(pg, mask, path, r)
	const stops = [S], jump = new Set()
	for (const t of targets) {
		if (t?.via) jump.add(stops.length), stops.push(t.via[0], t.via[1])
		else stops.push(T.snap(pg, t, need + T.PREFER, 60) || T.snap(pg, t, need, 60))
	}
	stops.push(E)
	if (stops.some((p) => !p)) return null
	const legs = []
	const skip = Math.ceil(r / pg.cell) + 2
	const closed = G.dist(S, E) < 1e-9 // a loop: the first leg's head stays open for the last leg to arrive
	for (let j = 0; j + 1 < stops.length; j++) {
		if (jump.has(j)) {
			legs.push(null)
			continue
		}
		const path = T.route(pg, stops[j], stops[j + 1], need, { forbid: mask })
		if (!path) return null
		legs.push(path)
		forbidPath(pg, mask, path, r, skip, closed && j === 0 ? skip : 0)
	}
	const out = [S]
	for (const [j, path] of legs.entries()) {
		if (!path) {
			out.push(stops[j + 1])
			continue
		}
		const p = T.pull(pg, path, need + PULL).slice(1)
		if (jump.has(j + 1)) p[p.length - 1] = stops[j + 1] // into a corridor exactly at its end
		out.push(...p)
	}
	out[out.length - 1] = E
	return out
}

/** §3.1: pin the loop's points that lie on a corridor's straight A … B (chaikin keeps them on it). */
function pinStraights(loop, pinned, list) {
	for (const c of list) {
		const dx = c.B[0] - c.A[0], dz = c.B[1] - c.A[1], l2 = dx * dx + dz * dz
		for (const [i, p] of loop.entries()) {
			const t = ((p[0] - c.A[0]) * dx + (p[1] - c.A[1]) * dz) / l2
			if (t < -1e-9 || t > 1 + 1e-9) continue
			if (Math.abs((p[0] - c.A[0]) * dz - (p[1] - c.A[1]) * dx) / Math.sqrt(l2) < 1e-6) pinned[i] = 1
		}
	}
	return pinned
}

/** The plan grid with the cells within r of `lines` walled off (for reach / extreme; routing keeps its own mask). */
function walledOff(pg, lines, r) {
	const mask = new Uint8Array(pg.nx * pg.nz)
	for (const path of lines) forbidPath(pg, mask, path, r)
	const clr = Float32Array.from(pg.clr, (v, q) => (mask[q] ? -1e3 : v))
	return { ...pg, clr }
}

/** Is corridor c's far end B2 connected to its near end A2 (and to `from`) around its own straight? → the walled grid's reach or null. */
function corridorReach(pg, c, need, width, from = c.B2) {
	const pgm = walledOff(pg, [T.dense([c.A, c.B])], width * 2 + 1)
	const seen = T.reach(pgm, from, need)
	if (!seen) return null
	for (const p of [c.A2, c.B2]) {
		const q = pg.idx(p[0], p[1])
		if (q < 0 || !seen[q] || pg.clr[q] < need) return null
	}
	return { pgm, seen }
}

/** A corridor as a routeThrough target. */
const viaOf = (c) => ({ via: [c.A2, c.B2], line: T.dense([c.A, c.B]) })

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
		const S2 = f.toWorld([b, vT + LEAD]), E2 = f.toWorld([a, vT + LEAD])
		for (const tun of spec.tunnel ? tourTunnels(ctx, width, [S2, ...targets, E2]) : []) {
			const t = tourOf(ctx, spec, { fixed, S, E, S2, E2, targets: tun.targets, avoid: [legPath(a), legPath(b)], need, list: [tun.c] })
			if (t) return t
		}
		const t = tourOf(ctx, spec, { fixed, S, E, S2, E2, targets, avoid: [legPath(a), legPath(b)], need, list: [] })
		if (t) return t
	}
	return null
}

/** One tour attempt (the hall route between the stage legs, through any corridors in `list`) → track or null. */
function tourOf(ctx, spec, o) {
	const { hall, stage, pg } = ctx
	const mid = routeThrough(pg, o.S2, o.targets, o.E2, o.need, spec.width, o.avoid)
	if (!mid) return null
	const { loop, pinned } = closeLoop(o.fixed, [o.S, ...mid, o.E])
	const smooth = T.smooth(loop, pinStraights(loop, pinned, o.list), pg.lerp, o.need, R_HALL)
	if (!smooth) return null
	return finish(ctx, smooth, { id: spec.id, name: spec.name, floor: 'room', kind: spec.kind || 'room-long', y: hall.y, width: spec.width,
		gridRun: spec.gridRun, straightGrid: !!spec.gridRun, features: { room: { stage, hallY: hall.y, exits: [spec.exit] } },
		tunnels: o.list.map((c) => ({ a: c.a, b: c.b })) })
}

const TOUR_TRIES = 4

/**
 * §3.1: a tour's tunnel — the corridors (one per blob, its cheapest heading) spliced into the tour's stops where the
 * detour is shortest → up to TOUR_TRIES [{ c, targets }], cheapest first.
 */
function tourTunnels(ctx, width, stops) {
	const all = []
	for (const c of TN.corridors(ctx, width)) {
		for (let j = 0; j + 1 < stops.length; j++) {
			const p = stops[j], q = stops[j + 1]
			const cost = G.dist(p, c.A2) + G.dist(c.B2, q) - G.dist(p, q)
			all.push({ c, j, cost })
		}
	}
	all.sort((x, y) => x.cost - y.cost || x.c.blob - y.c.blob || x.c.ang - y.c.ang || x.j - y.j)
	const seen = new Set(), out = []
	const need = needOf(width, ctx.oc)
	for (const x of all) {
		if (seen.has(x.c.blob)) continue
		seen.add(x.c.blob)
		if (!corridorReach(ctx.pg, x.c, need, width, stops[0])) continue
		const targets = stops.slice(1, -1)
		targets.splice(x.j, 0, viaOf(x.c))
		out.push({ c: x.c, targets })
		if (out.length >= TOUR_TRIES) break
	}
	return out
}

/**
 * §3.1: a medium hall loop through a table — the corridor's straight, then a route out to one side (OFFSETS × the
 * hall's unit across the corridor) and back to the corridor's start. spec: { id, name, width, len: [min, max] (unit) }.
 */
function tunnelLoop(ctx, spec) {
	const { hall, pg, oc } = ctx
	const need = needOf(spec.width, oc)
	const seen = new Set()
	let tries = 0
	for (const c of TN.corridors(ctx, spec.width)) {
		if (seen.has(c.blob)) continue // one heading per table (the shortest)
		seen.add(c.blob)
		const cr = corridorReach(pg, c, need, spec.width)
		if (!cr) continue
		for (const off of OFFSETS) {
			for (const side of [1, -1]) {
				if (tries++ >= LOOP_TRIES) return null
				const aim = [(c.A2[0] + c.B2[0]) / 2 - side * c.u[1] * off, (c.A2[1] + c.B2[1]) / 2 + side * c.u[0] * off]
				const m = T.extreme(cr.pgm, cr.seen, need, (x, z) => -G.dist([x, z], aim))
				if (!m || G.dist(m, aim) > off / 2) continue
				const mid = routeThrough(pg, c.B2, [m], c.A2, need, spec.width, [T.dense([c.A, c.B])])
				if (!mid) continue
				const { loop, pinned } = closeLoop(T.dense([c.A, c.B]), [c.B, ...mid, c.A])
				const smooth = T.smooth(loop, pinStraights(loop, pinned, [c]), pg.lerp, need, R_HALL)
				if (!smooth) continue
				const t = finish(ctx, smooth, { id: spec.id, name: spec.name, floor: 'hall', kind: 'hall', y: hall.y, width: spec.width, features: {},
					tunnels: [{ a: c.a, b: c.b }] })
				if (t && t.length >= spec.len[0] && t.length <= spec.len[1]) return t
			}
		}
	}
	return null
}

const OFFSETS = [26, 34, 20]
const LOOP_TRIES = 24

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

module.exports = { tour, weave, tunnelLoop, MAX_POINTS, MAX_LENGTH }
