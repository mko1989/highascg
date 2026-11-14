'use strict'

/**
 * WO-1074 v2 — "room" tracks: up onto the stage by a ramp, across it, and off again by a second ramp or a drop off the
 * stage edge (contract §2.1). Designed in the local frame of one stage edge (u along the edge, v out into the hall,
 * rc-track-plan.js `edgeFrames`): two legs cross the edge at right angles (a ramp needs a straight run; the crossing is
 * square so the ramp's top meets the stage edge level across the whole width), the stage part is a U at depth `dc`
 * with corner radius ≥ 1.8 m, the hall part closes the loop with corners ≥ 3 m (legs closer than two hall corners —
 * a narrow stage — flare out at 45° once past the ramp, so an 8 m stage edge still carries a room track).
 *
 * Designs (each tried over widths 4 → 2.5, every edge, leg positions and depths; the first candidate `validateTrack`
 * accepts is kept, a design with none is left out):
 *   loop    — narrow U, ramp up, ramp down;           leap  — mirrored, ramp up, DROP off the edge;
 *   tour    — the widest U and hall part, two ramps;  twister — wide, the far straight weaves, drop off the edge;
 *   double  — two stage visits (ramp up / drop / ramp up / ramp down) where the edge is long enough.
 */

const G = require('./rc-track-geo')
const PL = require('./rc-track-plan')
const { buildTrack, rampSteps } = require('./rc-track-build')
const { validateTrack } = require('./rc-track-check')
const { clearMap } = require('./rc-track-space')

const RS = 1.85 // stage corner radius (rule 1.8)
const RH = 3.1 // hall corner radius (rule 3)
const WIDTHS = [4, 3.5, 3, 2.5]
const TRIES = 12 // full builds + validations per design
const SP = 0.5

const down = (hi, lo) => Array.from({ length: Math.max(1, Math.floor(hi - lo) + 1) }, (_, i) => hi - i) // hi, hi − 1, … ≥ lo
const FLARE = 6.3 // legs closer than 2 RH (a narrow stage): the hall part flares out at 45° by this much on each side
const FLARE_RADII = [RH, RH, RS, RS, RH, RH]
const rect4 = (q) => (q.e
	? [[q.a - q.e, q.vF], [q.a, q.v1], [q.a, -q.dc], [q.b, -q.dc], [q.b, q.v1], [q.b + q.e, q.vF]]
	: [[q.a, q.vF], [q.a, -q.dc], [q.b, -q.dc], [q.b, q.vF]])
const DESIGNS = [
	{ key: 'loop', name: 'Stage loop', exits: ['ramp'], spans: (lo, hi) => [lo + 1, lo + 3, (lo + hi) / 2], poly: rect4, radii: [RH, RS, RS, RH] },
	{ key: 'leap', name: 'Stage leap', exits: ['drop'], spans: (lo, hi) => [(lo + hi) / 2, lo + 2, hi], mirror: true, poly: rect4, radii: [RH, RS, RS, RH] },
	{ key: 'tour', name: 'Grand tour', exits: ['ramp'], spans: (lo, hi) => down(hi, lo + 4), poly: rect4, radii: [RH, RS, RS, RH] },
	{ key: 'twister', name: 'Twister', exits: ['drop'], spans: (lo, hi) => down(hi, lo + 4), mirror: true, weave: true, poly: rect4, radii: [RH, RS, RS, RH] },
	{
		key: 'double', name: 'Double stage', exits: ['drop', 'ramp'], two: true, spans: (lo) => [lo + 0.5, lo + 1.5],
		poly: (q) => [[q.a, q.vF], [q.a, -q.dc], [q.b, -q.dc], [q.b, q.v1], [q.a2, q.v1], [q.a2, -q.dc], [q.b2, -q.dc], [q.b2, q.vF]],
		radii: [RH, RS, RS, RH, RH, RS, RS, RH],
	},
]

/** The far straight (v = vF, between the corners) weaves inwards: v − A (1 − cos(2π w s)) / 2 (radius λ² / (2π² A) ≥ 3.2 m). */
function weave(pts, vF) {
	const on = pts.map((p) => Math.abs(p[1] - vF) < 1e-9)
	const idx = on.map((o, i) => (o ? i : -1)).filter((i) => i >= 0)
	if (idx.length < 10) return pts
	const u0 = Math.min(...idx.map((i) => pts[i][0])), u1 = Math.max(...idx.map((i) => pts[i][0]))
	const len = u1 - u0, waves = Math.floor(len / 8.5)
	if (waves < 1) return pts
	const A = Math.min(1, ((len / waves) ** 2) / (2 * Math.PI * Math.PI * 3.3))
	return pts.map((p, i) => (on[i] ? [p[0], p[1] - (A * (1 - Math.cos((2 * Math.PI * waves * (p[0] - u0)) / len))) / 2] : p))
}

/** Cheap rejection of a candidate (frame-local dense points) before the full build + validation. */
function precheck(local, frame, ctx) {
	const { hall, stage, map, half, sr, hr, legs } = ctx
	for (let i = 0; i < local.length; i += 3) {
		const [u, v] = local[i]
		const [x, z] = frame.toWorld(local[i])
		const onStage = G.inRect(x, z, stage.rect)
		if (onStage) {
			if (u < sr[0] + half || u > sr[2] - half || v < sr[1] + half) return false
		} else {
			if (u < hr[0] + half || u > hr[2] - half || v > hr[3] - half || v < hr[1] + half) return false
			if (v < half && u > sr[0] - half && u < sr[2] + half && !legs.some((a) => Math.abs(u - a) < 1e-6)) return false
		}
		if (map.blocked(x, z, onStage ? stage.y : hall.y)) return false
	}
	return true
}

/** Candidate parameter sets for one design on one frame at one width, in preference order. */
function* candidates(d, frame, ctx) {
	const { half, sr, hr, need } = ctx
	const lo = Math.max(2 * RS + 0.2, ctx.width + 0.6)
	const su0 = sr[0] + half + 0.05, su1 = sr[2] - half - 0.05
	const room = su1 - su0
	if (room < lo) return // the legs (and the U between them) do not fit along this edge
	const vMax = Math.min(hr[3] - half - 0.05, need + RH + 14)
	const vMin = need + RH + 0.1
	for (const dc of [RS + 1.15, RS + 1.8]) {
		if (dc + half > -sr[1] + 1e-9) continue
		if (d.two) {
			const gapMin = 2 * RH + 0.2
			for (const span of d.spans(lo, room)) {
				const total = 2 * span + gapMin
				if (total > room) continue
				for (const a of positions(su0, su1 - total)) {
					const b = a + span, a2 = b + gapMin, b2 = a2 + span
					for (let vF = vMax; vF >= vMin; vF -= 0.75) yield { a, b, a2, b2, dc, vF, v1: vMin }
				}
			}
			continue
		}
		const spans = [...new Set(d.spans(lo, room).map((s) => Math.floor(Math.min(room, Math.max(lo, s)) * 4 + 1e-9) / 4))]
		for (const span of spans) {
			// 45° flare: the leg turns at v1 (tangent RH tan 22.5° = 1.3 m before it, so the ramp's run ends by then)
			const e = span < 2 * RH + 0.2 ? FLARE : 0
			const lowF = e ? need + 1.45 + e : vMin
			for (const a of positions(su0, su1 - span)) for (let vF = vMax; vF >= lowF; vF -= 0.75) yield { a, b: a + span, dc, vF, e, v1: vF - e }
		}
	}
}

/** Leg positions over [lo, hi]: the middle first, then outwards in 1 m steps. */
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

/** One design → generator of null (between tries) and finally the track (or nothing). */
function* searchDesign(d, scene, hall, stage, seen, opts = {}) {
	const h = stage.y - hall.y
	const k = rampSteps(h, SP)
	const legRamp = (k + 3) * SP, legDrop = Math.ceil(3.3 / SP) * SP + 1.5
	const need = Math.max(legRamp, d.exits.includes('drop') ? legDrop : 0)
	const frames = PL.edgeFrames(stage.rect)
		.map((f) => ({ f, hr: PL.rectIn(f, hall.rect), sr: PL.rectIn(f, stage.rect) }))
		.sort((p, q) => q.hr[3] - p.hr[3] || 0)
	let tries = 0
	for (const width of opts.widths || WIDTHS) {
		const half = width / 2
		const map = clearMap(scene, half)
		for (const { f, hr, sr } of frames) {
			const ctx = { hall, stage, map, half, sr, hr, need, width }
			for (const q of candidates(d, f, ctx)) {
				let poly = d.poly(q)
				if (d.mirror) poly = poly.map(([u, v]) => [sr[0] + sr[2] - u, v]) // same legs, driven the other way round
				const fp = PL.filletPolygon(poly, q.e ? FLARE_RADII : d.radii)
				if (!fp) continue
				const local = d.weave ? weave(fp.pts, q.vF) : fp.pts
				ctx.legs = d.mirror ? [q.a, q.b, q.a2, q.b2].filter((x) => x != null).map((u) => sr[0] + sr[2] - u) : [q.a, q.b, q.a2, q.b2].filter((x) => x != null)
				if (!precheck(local, f, ctx)) continue
				const dense = local.map((p) => f.toWorld(p))
				const t = buildTrack(dense, { id: `room-${d.key}`, name: d.name, floor: 'room', y: hall.y, width,
					features: { room: { stage, hallY: hall.y, exits: d.exits } }, ...opts.meta }, scene)
				const sig = t && JSON.stringify([t.points.map((q) => q.map((v) => Math.round(v * 10))), t.ramps, t.drops])
				if (t && !seen.has(sig) && validateTrack(t, scene).ok) return seen.add(sig), yield t
				yield null
				if (++tries >= TRIES) return
			}
		}
	}
}

/**
 * Room designs for a scene with a stage standing above its hall → generator (null between tries, tracks as found).
 * opts (§3 toy scale, unit frame): { widths, meta: extra buildTrack meta, designs: keys to try }.
 */
function* roomJobs(scene, opts = {}) {
	const floors = scene.floors || []
	const hall = floors.find((f) => f.id === 'hall'), stage = floors.find((f) => f.id === 'stage')
	if (!hall || !stage || stage.y < hall.y + 0.35) return
	const r = stage.rect, H = hall.rect
	if (r[0] < H[0] || r[1] < H[1] || r[2] > H[2] || r[3] > H[3]) return
	const seen = new Set() // a design that comes out the same as an earlier one (a small stage) keeps searching
	for (const d of DESIGNS) if (!opts.designs || opts.designs.includes(d.key)) yield* searchDesign(d, scene, hall, stage, seen, opts)
}

module.exports = { roomJobs, RS, RH }
