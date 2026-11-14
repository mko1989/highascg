'use strict'

/**
 * WO-1074 §2.7 — whole-room tracks over a furnished hall: elevated decks (pure, deterministic; kind 'room-long').
 *
 * Every design leaves the stage up a ramp onto a deck, tours the hall on decks over whatever stands there (the scene's
 * height field `scene.field` / `heights` says where a deck fits), and comes back onto the stage by a ramp, a drop off a
 * deck end onto the stage, or a drop onto the hall floor followed by a short ramp up (a front zone of clear floor).
 * Written in the local frame of one stage edge (u along it, v out into the hall; rc-track-plan.js `edgeFrames`, each
 * also mirrored), with deck corners of radius ≥ 6.25 m and ramps / drops on straight legs:
 *   sky     "Sky tour"       — the widest loop (45° flares off the stage legs), one deck height, a drop to finish;
 *   over    "Over and under" — a figure-eight: the outgoing diagonal runs low (H1), the far lobe climbs to H2 on a
 *                              slab ramp and the return diagonal crosses over the outgoing one (a bridge, ≥ 1.3 m up);
 *   coaster "Rollercoaster"  — mirrored first: an eight whose far lobe is a lift hill (H1 → mid → H2 in two slab
 *                              ramps) and a drop to finish; else the loop with humps (H1 → H2 → H1 on its long legs).
 * Candidates are pre-checked cheaply (stage clutter via clearMap, the deck band via a mask of the height field, length
 * and coverage from the polygon) before the full build; `validateTrack` has the last word. A hall too small for the
 * whole-room rules simply gets none of these (the short tracks remain).
 */

const G = require('./rc-track-geo')
const PL = require('./rc-track-plan')
const { buildTrack, rampSteps, straight, claim, DROP_RUN } = require('./rc-track-build')
const { validateTrack } = require('./rc-track-check')
const DK = require('./rc-track-check-deck')
const { fieldOf } = require('./rc-scene-height')
const { clearMap } = require('./rc-track-space')

const WIDTH = 4
const HALF = WIDTH / 2
const RD = 6.25 // deck corners (rule ≥ 6)
const RST = 1.9 // stage corners (rule ≥ 1.8)
const T45 = RD * Math.tan(Math.PI / 8) // tangent length of a 45° deck corner
const EDGE = HALF + DK.RAIL_W + 0.3 // centre line ↔ hall rect edge
const GRID_RUN = 14 // §2.7: the 10-slot grid stands on a straight ≥ 14 m
const TRIES = 16 // full builds + validations per design, shape and exit
const MAX_PRE = 4000 // cheap prechecks per design
const STAGE_DECK = 1.6 // a stage-level deck joins the stage to the first / last slab ramp
const APRON = 5 // a drop off a deck may land on a stage-level deck this long joining the stage (its flight then stays ≥ 4 m clear)
const LIP_IN = 0.8 // a deck reaches this far over the stage before its drop
const SP_PLAN = 0.7 // spacing assumed while planning (the emitted one is ≤ this up to 140 m)
const PLATEAU = 3 // flat deck between the two ramps of a hump
const SHORT = 0.8 // the Sky tour may come out shorter than the whole-room minimum (then kind 'room')
const HUMP = 0.75 // a hump's rise on the Rollercoaster's eight
const c01 = (t) => (1 - Math.cos(Math.PI * t)) / 2
const rampLen = (h) => rampSteps(Math.abs(h), SP_PLAN) * SP_PLAN

const DESIGNS = [
	{ key: 'sky', name: 'Sky tour', shapes: ['loop'], spans: 'wide', short: true, heights: [[2.75], [2.5], [3], [2.25], [2]], exits: ['drop-apron', 'drop-stage', 'ramp'] },
	{ key: 'over', name: 'Over and under', shapes: ['eight'], heights: [[2, 3.5], [2.25, 3.75], [2, 3.3], [2.25, 3.55]], exits: ['ramp', 'drop-apron', 'drop-stage'] },
	{ key: 'coaster', name: 'Rollercoaster', shapes: ['eight', 'loop'], humps: true, mirror: true, spans: 'mid', heights: [[2.25, 3.75], [2, 3.5], [2, 3.3]], exits: ['drop-apron', 'ramp'] },
]

/**
 * Lay the levels of a deck track on the resampled plan P (one stage visit) → { Y, ramps, drops, decks, busy, noStart } or null.
 * spec: { stage, hallY, levels: [abs y of the first deck, …], events: [{ at: [x, z], to: abs y }] (slab ramps centred
 * nearest `at`, in driving order), exit: 'ramp' | 'drop-stage' | 'drop-apron', width }.
 */
function layLevels(P, sp, spec) {
	const n = P.length
	const { stage, hallY } = spec
	const S = stage.y
	const at = (i) => ((i % n) + n) % n
	const inside = P.map(([x, z]) => G.inRect(x, z, stage.rect))
	let ex = -1, en = -1, swaps = 0
	for (let i = 0; i < n; i++) {
		const j = at(i + 1)
		if (inside[i] === inside[j]) continue
		swaps++
		if (inside[i]) ex = i
		else en = j
	}
	if (swaps !== 2) return null
	const m = (en - ex + n) % n // offsets from ex (the last stage point): 0 … m (the first stage point back)
	let lvl = spec.levels[0]
	// leaving the stage: a stage-level deck reaching out over the hall, then a slab ramp up (no skirts: may pass over tables)
	const dS = Math.max(2, Math.ceil(STAGE_DECK / sp))
	const feats = [{ o0: dS, o1: dS + rampSteps(lvl - S, sp), y0: S, y1: lvl, kind: 'ramp' }]
	for (const ev of spec.events) {
		const k = rampSteps(Math.abs(ev.to - lvl), sp)
		let best = -1, bd = Infinity
		for (let o = feats[feats.length - 1].o1 + 2 + Math.ceil(k / 2); o < m; o++) {
			const d = G.dist(P[at(ex + o)], ev.at)
			if (d < bd) (bd = d), (best = o)
		}
		if (best < 0 || bd > 1.5) return null
		const o0 = best - Math.ceil(k / 2)
		feats.push({ o0, o1: o0 + k, y0: lvl, y1: ev.to, kind: 'ramp' })
		lvl = ev.to
	}
	if (spec.exit === 'ramp') {
		feats.push({ o0: m - dS - rampSteps(lvl - S, sp), o1: m - dS, y0: lvl, y1: S, kind: 'ramp' })
	} else if (spec.exit === 'drop-stage') {
		const lip = m + Math.ceil(LIP_IN / sp)
		feats.push({ o0: lip, o1: lip + Math.ceil(DROP_RUN / sp), y0: lvl, y1: S, kind: 'drop' })
	} else {
		// drop-apron: the deck's end drops onto a stage-level deck (an apron over the clear floor in front of the stage)
		const land = m - Math.max(3, Math.ceil(APRON / sp))
		feats.push({ o0: land - Math.ceil(DROP_RUN / sp), o1: land, y0: lvl, y1: S, kind: 'drop', apron: true })
	}
	for (let q = 1; q < feats.length; q++) if (feats[q].o0 - feats[q - 1].o1 < 3) return null // a deck / floor stretch ≥ 2 segments between
	const end = feats[feats.length - 1].o1
	if (end >= n - 4) return null
	const Y = P.map(() => S)
	const busy = new Uint8Array(n)
	const ramps = [], drops = [], decks = []
	let cur = S, prev = 0
	for (const f of feats) {
		for (let o = prev; o < f.o0; o++) Y[at(ex + o)] = cur
		if (f.kind === 'ramp') {
			const k = f.o1 - f.o0
			for (let q = 0; q <= k; q++) Y[at(ex + f.o0 + q)] = f.y0 + (f.y1 - f.y0) * c01(q / k)
			if (!straight(P, ex + f.o0, ex + f.o1) || !claim(busy, ex + f.o0 - 1, ex + f.o1 + 1)) return null // ends too: no wedge at a joint
			ramps.push({ from: at(ex + f.o0), to: at(ex + f.o1) })
		} else {
			Y[at(ex + f.o0)] = f.y0
			for (let o = f.o0 + 1; o <= f.o1; o++) Y[at(ex + o)] = f.y1
			if (!straight(P, ex + f.o0 - 1, ex + f.o1 + 1, [1]) || !claim(busy, ex + f.o0 - 1, ex + f.o1 + 1)) return null
			drops.push({ at: at(ex + f.o0), land: at(ex + f.o1) })
		}
		cur = f.y1
		prev = f.o1 + 1
	}
	for (let o = prev; o <= m; o++) Y[at(ex + o)] = cur
	// decks: the elevated flat stretches between consecutive features (a drop's lip ends one, never starts one)
	decks.push({ from: ex, to: at(ex + dS) })
	for (let q = 0; q + 1 < feats.length; q++) {
		const a = feats[q], b = feats[q + 1]
		if (a.kind !== 'ramp' || Math.abs(a.y1 - S) < 1e-6 || Math.abs(a.y1 - hallY) < 1e-6) continue
		decks.push({ from: at(ex + a.o1), to: at(ex + b.o0) })
	}
	if (spec.exit === 'ramp') decks.push({ from: at(ex + m - dS), to: en })
	if (spec.exit === 'drop-apron') decks.push({ from: at(ex + feats[feats.length - 1].o0 + 1), to: en }) // under the flight too
	// a bridge carries no start line (checkpoint 0) — the grid may stand on it (a flat straight, the upper ribbon)
	return { Y, ramps, drops, decks, busy, noStart: DK.bridgePoints(P, Y, n, spec.width) }
}

/** A blocked(x, z) test for decks spanning [lo, hi] (abs y): the validator's band test at 0.5 m cells, once per band. */
function maskFor(ctx, lo, hi) {
	const key = `${lo.toFixed(2)}:${hi.toFixed(2)}`
	if (ctx.masks.has(key)) return ctx.masks.get(key)
	const F = ctx.field
	let fn = () => false
	if (F) {
		const bad = new Uint8Array(F.nx * F.nz)
		for (let k = 0; k < F.nz; k++) {
			for (let i = 0; i < F.nx; i++) {
				const x = F.x0 + (i + 0.5) * F.cell, z = F.z0 + (k + 0.5) * F.cell
				bad[k * F.nx + i] = F.bandHit(x, z, HALF + DK.RAIL_W, Math.max(F.base, lo), hi) ? 1 : 0
			}
		}
		fn = (x, z) => {
			const i = Math.floor((x - F.x0) / F.cell), k = Math.floor((z - F.z0) / F.cell)
			return i < 0 || k < 0 || i >= F.nx || k >= F.nz || bad[k * F.nx + i] === 1
		}
	}
	ctx.masks.set(key, fn)
	return fn
}

/** Local samples of a filleted polygon without filleting it: the straight parts every ~1 m + each arc's middle. */
function polySamples(poly, radii) {
	const m = poly.length
	const C = poly.map((c, k) => {
		const p = poly[(k - 1 + m) % m], q = poly[(k + 1) % m]
		const li = Math.hypot(c[0] - p[0], c[1] - p[1]) || 1, lo = Math.hypot(q[0] - c[0], q[1] - c[1]) || 1
		const di = [(c[0] - p[0]) / li, (c[1] - p[1]) / li], dout = [(q[0] - c[0]) / lo, (q[1] - c[1]) / lo]
		const th = Math.acos(Math.max(-1, Math.min(1, di[0] * dout[0] + di[1] * dout[1])))
		return { c, di, dout, th, t: radii[k] * Math.tan(th / 2), r: radii[k], lo }
	})
	const out = []
	let L = 0
	for (let k = 0; k < m; k++) {
		const a = C[k], b = C[(k + 1) % m]
		const bis = [a.dout[0] - a.di[0], a.dout[1] - a.di[1]], bl = Math.hypot(bis[0], bis[1]) || 1
		const off = a.r / Math.cos(a.th / 2) - a.r
		out.push([a.c[0] + (bis[0] / bl) * off, a.c[1] + (bis[1] / bl) * off])
		const run = a.lo - a.t - b.t
		L += run + a.r * a.th
		for (let s = 0; s <= run; s += 1) out.push([a.c[0] + a.dout[0] * (a.t + s), a.c[1] + a.dout[1] * (a.t + s)])
	}
	return { pts: out, L }
}

/** Is the stage U (legs a, b down to depth dc) clear of stage clutter? Samples every 0.5 m. */
function uClear(a, b, dc, fr, ctx) {
	const pts = []
	for (let v = 0; v >= -dc; v -= 0.5) pts.push([a, v], [b, v])
	for (let u = a; u <= b; u += 0.5) pts.push([u, -dc])
	return pts.every((p) => {
		const [x, z] = fr.f.toWorld(p)
		return !ctx.map.blocked(x, z, ctx.stage.y)
	})
}

/**
 * The deck-free extent of the hall in frame fr for one band (`blocked`): the outermost lanes uL / uR whose column
 * (v 12 m … the far end − 4 m) is clear, and the farthest row vF clear between them → { uL, uR, vF } (local).
 */
function extents(fr, blocked) {
	if (fr.ext?.has(blocked)) return fr.ext.get(blocked)
	const { hr, f } = fr
	const uMin = hr[0] + EDGE, uMax = hr[2] - EDGE, vMax = hr[3] - EDGE
	const free = (u0, v0, u1, v1) => {
		const n = Math.max(1, Math.ceil(Math.hypot(u1 - u0, v1 - v0) / 0.5))
		for (let k = 0; k <= n; k++) if (blocked(...f.toWorld([u0 + ((u1 - u0) * k) / n, v0 + ((v1 - v0) * k) / n]))) return false
		return true
	}
	let uL = uMin, uR = uMax, vF = vMax
	while (uL < uMax && !free(uL, 12, uL, vMax - 4)) uL += 0.25
	while (uR > uL && !free(uR, 12, uR, vMax - 4)) uR -= 0.25
	while (vF > 12 && !free(uL + RD, vF, uR - RD, vF)) vF -= 0.25
	const out = { uL, uR, vF }
	;(fr.ext ||= new Map()).set(blocked, out)
	return out
}

/** Candidate shapes of design d in frame fr → generator of { poly, radii, events (local), zone }. */
function* shapes(d, shape, fr, ctx, levels, exit, blocked) {
	const { sr } = fr
	const S = ctx.stage.y
	const su0 = sr[0] + HALF + 0.1, su1 = sr[2] - HALF - 0.1
	const X = extents(fr, blocked)
	const upZone = STAGE_DECK + rampLen(levels[0] - S) + 1
	const exitZone = (lvl) => (exit === 'ramp' ? STAGE_DECK + rampLen(lvl - S) + 1 : exit === 'drop-apron' ? APRON + DROP_RUN + 0.6 : 0.5)
	const zone = Math.max(upZone, ...levels.map(exitZone))
	const room = su1 - su0
	const lo = Math.max(2 * RST + 0.2, WIDTH + (shape === 'eight' ? 0.4 : 0.6))
	if (room < lo) return
	const all = []
	for (let sp = room; sp >= lo - 1e-9; sp -= 1) all.push(sp)
	all.push(lo)
	const spans = shape === 'eight' || d.spans === 'wide' ? all : [...all].reverse() // wider legs: a longer lap
	const dcs = exit === 'drop-stage' ? [LIP_IN + DROP_RUN + 1.8 + RST] : [RST + 0.6, RST + 1.2]
	for (const dc of dcs) {
		if (dc + HALF > -sr[1] + 1e-9) continue
		for (const span of [...new Set(spans.filter((s) => s >= lo - 1e-9 && s <= room + 1e-9).map((s) => Math.round(s * 4) / 4))]) {
			for (const a of positions(su0, su1 - span)) {
				const b = a + span
				if (!uClear(a, b, dc, fr, ctx)) continue
				for (const vF of [0, -0.5, -1, -2, -3.5].map((o) => X.vF + o)) {
					for (const uR of [...[0, -0.5, -1.25].map((o) => X.uR + o).filter((u) => u >= b + 3.75), b]) {
						for (const uL of [...[0, 0.5, 1.25].map((o) => X.uL + o).filter((u) => u <= a - 3.75), a]) {
							const q = shape === 'eight' ? eight(d, a, b, uL, uR, vF, dc, levels, upZone, exitZone) : loop(d, a, b, uL, uR, vF, dc, levels, upZone, exitZone(Math.max(...levels)))
							if (q) yield { ...q, zone }
						}
					}
				}
			}
		}
	}
}

/** Loop: stage U (a → b), out on leg b (flaring to uR), across the far end, back on uL flaring in to leg a. */
function loop(d, a, b, uL, uR, vF, dc, levels, upZone, exitZone) {
	const eR = uR - b, eL = a - uL
	if ((eR > 1e-6 && eR < 3.7) || (eL > 1e-6 && eL < 3.7)) return null
	const vB = upZone + T45 + 0.5, vA = exitZone + T45 + 0.5
	const pts = [[a, -dc, RST], [b, -dc, RST]]
	if (eR > 1e-6) pts.push([b, vB, RD], [uR, vB + eR, RD])
	pts.push([uR, vF, RD], [uL, vF, RD])
	if (eL > 1e-6) pts.push([uL, vA + eL, RD], [a, vA, RD])
	const events = []
	if (d.humps) {
		let lvl = levels[0]
		const leg = (u, v0, v1, dir) => {
			const other = lvl === levels[0] ? levels[1] : levels[0]
			const k = rampLen(other - lvl), len = Math.abs(v1 - v0)
			if (len >= 2 * k + PLATEAU + 3) {
				events.push({ at: [u, v0 + dir * (1.5 + k / 2)], to: other }, { at: [u, v0 + dir * (1.5 + k + PLATEAU + k / 2)], to: lvl })
			} else if (len >= k + 3) {
				events.push({ at: [u, v0 + dir * (1.5 + k / 2)], to: other })
				lvl = other
			}
		}
		leg(uR, eR > 1e-6 ? vB + eR + T45 : upZone + 0.5, vF - RD, 1)
		leg(uL, vF - RD, eL > 1e-6 ? vA + eL + T45 : exitZone + 0.5, -1)
		if (!events.length) return null
	}
	return { poly: pts.map((p) => [p[0], p[1]]), radii: pts.map((p) => p[2]), events }
}

/**
 * Figure-eight: legs a / b turn 45° onto two diagonals crossing at X (between the legs); the far lobe (uL side up, far
 * end, uR side down) climbs H1 → H2 on one side so the return diagonal crosses over the outgoing one. With `d.humps`
 * the other side carries a hump (H1 → H1 + 0.75 → H1) when it fits.
 */
function eight(d, a, b, uL, uR, vF, dc, levels, upZone, exitZone) {
	const uX = (a + b) / 2
	if (!(uL < a - 1 && uR > b + 1)) return null
	const vX = Math.max(exitZone(levels[1]) + T45 + 0.5 + (uX - a), upZone + T45 + 0.5 + (b - uX))
	const va = vX - (uX - a), vb = vX - (b - uX), vL = vX + (uX - uL), vR = vX + (uR - uX)
	const top = vF - RD, l0 = vL + T45, r0 = vR + T45
	if (top - l0 < 1 || top - r0 < 1) return null
	// the grid's straight: the outgoing (lower) diagonal, its start line past the crossing (the grid may stand under it)
	if ((b - uL) * Math.SQRT2 - 2 * T45 < GRID_RUN + 1) return null
	const kH = rampLen(levels[1] - levels[0]), kh = rampLen(HUMP), kM = rampLen((levels[1] - levels[0]) / 2)
	const fitsClimb = (len) => len >= kH + 1.5, fitsHump = (len) => len >= 2 * kh + PLATEAU + 1.5
	const events = []
	if (d.humps && top - l0 >= kM + 1.5 && top - r0 >= kM + 1.5) {
		// the lift hill: the far lobe climbs in two steps (up its first side to mid height, up its second side to H2)
		events.push({ at: [uL, (l0 + top) / 2], to: (levels[0] + levels[1]) / 2 }, { at: [uR, (top + r0) / 2], to: levels[1] })
		return eightPoly(a, b, uL, uR, vF, dc, vb, vL, vR, va, events)
	}
	const hump = (u, v0, dir) => events.push({ at: [u, v0 + dir * (0.75 + kh / 2)], to: levels[0] + HUMP }, { at: [u, v0 + dir * (0.75 + kh + PLATEAU + kh / 2)], to: levels[0] })
	if (fitsClimb(top - r0) && (!fitsClimb(top - l0) || top - r0 >= top - l0 || d.humps)) {
		if (d.humps && fitsHump(top - l0)) hump(uL, l0, 1)
		events.push({ at: [uR, (top + r0) / 2], to: levels[1] })
	} else if (fitsClimb(top - l0)) {
		events.push({ at: [uL, (l0 + top) / 2], to: levels[1] })
	} else return null
	if (d.humps && events.length < 3) return null
	return eightPoly(a, b, uL, uR, vF, dc, vb, vL, vR, va, events)
}

const eightPoly = (a, b, uL, uR, vF, dc, vb, vL, vR, va, events) => {
	const pts = [[a, -dc, RST], [b, -dc, RST], [b, vb, RD], [uL, vL, RD], [uL, vF, RD], [uR, vF, RD], [uR, vR, RD], [a, va, RD]]
	return { poly: pts.map((p) => [p[0], p[1]]), radii: pts.map((p) => p[2]), events }
}

/** Leg positions over [lo, hi]: the middle first, then outwards in 1 m steps, then the ends. */
function positions(lo, hi) {
	if (hi < lo) return []
	const mid = (lo + hi) / 2
	const out = [mid]
	for (let k = 1; mid - k >= lo || mid + k <= hi; k++) {
		if (mid - k >= lo) out.push(mid - k)
		if (mid + k <= hi) out.push(mid + k)
	}
	if (hi - lo > 0.01) out.push(lo, hi)
	return out
}

/** Cheap rejection (→ { L } estimate or false): the stage part clear of clutter, the decks clear of the scene band, ≥ minL, wide enough. */
function precheck(q, fr, ctx, blocked, minL) {
	const { hr, sr, f } = fr
	const { pts, L } = polySamples(q.poly, q.radii)
	if (L < minL + 0.3) return false
	const W = pts.map((p) => f.toWorld(p))
	const bx = G.bbox(W), H = ctx.hall.rect
	const hw = H[2] - H[0], hd = H[3] - H[1]
	const ex = bx[2] - bx[0], ez = bx[3] - bx[1]
	const [eLong, eShort] = hw >= hd ? [ex, ez] : [ez, ex]
	if (eLong < DK.COVER_LONG * Math.max(hw, hd) + 0.5 || eShort < DK.COVER_SHORT * Math.min(hw, hd) + 0.5) return false
	for (const [k, [u, v]] of pts.entries()) {
		const [x, z] = W[k]
		if (v < 0) {
			if (u < sr[0] + HALF || u > sr[2] - HALF || v < sr[1] + HALF || ctx.map.blocked(x, z, ctx.stage.y)) return false
		} else {
			if (u < hr[0] + HALF || u > hr[2] - HALF || v > hr[3] - HALF) return false
			if (v > q.zone && blocked(x, z)) return false
		}
	}
	return { L }
}

/** One design → generator of null (between tries) and finally its track (or nothing). */
function* searchDesign(d, frames, ctx) {
	const { scene, hall, stage } = ctx
	let pre = 0
	const order = d.mirror ? [...frames.filter((f) => f.mirrored), ...frames.filter((f) => !f.mirrored)] : frames
	for (const shape of d.shapes) {
		exits: for (const exit of d.exits) {
			let tries = 0
			for (const hs of d.heights) {
				const levels = hs.map((h) => hall.y + h)
				const blocked = maskFor(ctx, Math.min(...levels) - DK.BELOW, Math.max(...levels) + DK.ABOVE)
				for (const fr of order) {
					for (const q of shapes(d, shape, fr, ctx, levels, exit, blocked)) {
						if (++pre > MAX_PRE) return
						if (pre % 64 === 0) yield null
						const est = precheck(q, fr, ctx, blocked, d.short ? SHORT * ctx.need : ctx.need)
						if (!est) continue
						const fp = PL.filletPolygon(q.poly, q.radii)
						if (!fp) continue
						const spec = { stage, hallY: hall.y, levels, exit, width: WIDTH, events: q.events.map((e) => ({ at: fr.f.toWorld(e.at), to: e.to })) }
						const kind = est.L >= ctx.need + 0.3 ? 'room-long' : 'room'
						const meta = { id: `room-${d.key}`, name: d.name, floor: 'room', kind, y: hall.y, width: WIDTH, gridRun: GRID_RUN, straightGrid: true, levels: (P, sp) => layLevels(P, sp, spec) }
						const t = buildTrack(fp.pts.map((p) => fr.f.toWorld(p)), meta, scene)
						if (t && validateTrack(t, scene).ok) return yield t
						yield null
						if (++tries >= TRIES) continue exits
					}
				}
			}
		}
	}
}

/** Whole-room deck tracks for a scene with a stage above its hall → generator (null between tries, tracks as found). */
function* skyJobs(scene) {
	const floors = scene.floors || []
	const hall = floors.find((f) => f.id === 'hall'), stage = floors.find((f) => f.id === 'stage')
	if (!hall || !stage || stage.y < hall.y + 0.35) return
	const r = stage.rect, H = hall.rect
	if (r[0] < H[0] || r[1] < H[1] || r[2] > H[2] || r[3] > H[3]) return
	const need = Math.min(DK.LONG_MIN, DK.LONG_HALL * Math.max(H[2] - H[0], H[3] - H[1]))
	const frames = []
	for (const f0 of PL.edgeFrames(stage.rect)) {
		for (const mir of [false, true]) {
			const f = mir ? { id: `${f0.id}-m`, mirrored: true, toWorld: ([u, v]) => f0.toWorld([-u, v]), fromWorld: (p) => { const [u, v] = f0.fromWorld(p); return [-u, v] } } : f0
			const hr = PL.rectIn(f, H), sr = PL.rectIn(f, r)
			if (hr[3] - EDGE >= 25) frames.push({ f, hr, sr, mirrored: mir })
		}
	}
	frames.sort((p, q) => q.hr[3] - p.hr[3])
	const ctx = { scene, hall, stage, need, field: fieldOf(scene), masks: new Map(), map: clearMap(scene, HALF) }
	for (const d of DESIGNS) yield* searchDesign(d, frames, ctx)
}

module.exports = { skyJobs, WIDTH, GRID_RUN }
