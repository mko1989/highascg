'use strict'

/**
 * WO-1074 §3 — the track set at toy scale (pure, deterministic per scene; rc-scale.js). Everything is generated in the
 * unit frame (the scene ÷ scale, so every v2 rule and v2 design holds with its lengths × scale) and handed back in
 * world metres (unit × scale, rounded to 0.1 mm at 0.1), each re-validated on the world scene. The mix (contract §3):
 *   long   — whole-room tours (rc-toy-route.js `tour`): stage, ramp, the hall's far end and back, `laps: 1`;
 *   medium — the v2 room designs (ramp up onto the stage, ramp or drop off it; rc-track-room.js), a figure-eight whose
 *            second diagonal crosses the first on a small bridge (decks 0.16–0.2 m at 0.1), a table weave (a route
 *            through the aisles around a block of tables);
 *   short  — the v2 shape families at small caps: a stage oval / GP, a hall loop with a kicker in the clear zone.
 * The v2 prefilters (free regions, clearMap) see the occupancy grids as obstacle rects (`planObstacles`: 2 × 2-cell
 * blocks — never smaller than the cells they stand for, so they reject at most what the occupancy rule rejects); the
 * validator judges against the grids themselves. Every track but a tour carries `laps: 3`.
 */

const G = require('./rc-track-geo')
const PL = require('./rc-track-plan')
const SC = require('./rc-scale')
const T = require('./rc-toy-plan')
const R = require('./rc-toy-route')
const DK = require('./rc-track-check-deck')
const { buildTrack, rampSteps, straight, claim } = require('./rc-track-build')
const { validateTrack } = require('./rc-track-check')
const { roomJobs, RH } = require('./rc-track-room')
const { freeRegions } = require('./rc-track-space')

const BLOCK = 2 // occupancy cells per plan obstacle block side
const LAPS = 3
const BRIDGE_H = 1.8 // unit: the bridge deck above the hall floor (0.18 m at 0.1; rule ≥ 1.2 over the lower ribbon)
const BRIDGE_W = 4 // unit: deck width rule (≥ 4)
const PLAIN = [{}]
const JUMP = [{ kicker: 0.45, as: 'jump' }, { kicker: 0.45, run: 1, as: 'jump' }]

/** The grids as unit obstacle boxes (BLOCK × BLOCK cells, merged along rows, then rows with the same span). */
function planObstacles(U) {
	const out = []
	const s = U.toy.s
	for (const g of U.toy.occ) {
		const f = U.floors.find((q) => q.id === g.floor)
		if (!f) continue
		const bw = Math.ceil(g.w / BLOCK), bh = Math.ceil(g.h / BLOCK)
		const open = new Map() // "i0,i1" → box growing down the rows
		for (let k = 0; k < bh; k++) {
			const runs = []
			for (let i = 0, start = -1; i <= bw; i++) {
				let hit = false
				for (let dk = 0; i < bw && dk < BLOCK && !hit; dk++) {
					for (let di = 0; di < BLOCK && !hit; di++) {
						const ii = i * BLOCK + di, kk = k * BLOCK + dk
						hit = ii < g.w && kk < g.h && g.bits[kk * g.w + ii] === 1
					}
				}
				if (hit && start < 0) start = i
				if (!hit && start >= 0) runs.push([start, i]), (start = -1)
			}
			const seen = new Set()
			for (const [i0, i1] of runs) {
				const key = `${i0},${i1}`
				seen.add(key)
				const box = open.get(key)
				if (box) box.k1 = k + 1
				else open.set(key, { i0, i1, k0: k, k1: k + 1 })
			}
			for (const [key, b] of open) if (!seen.has(key)) out.push(toBox(g, f, b, s)), open.delete(key)
		}
		for (const b of open.values()) out.push(toBox(g, f, b, s))
	}
	return out
}

const toBox = (g, f, b, s) => {
	const c = (g.cell * BLOCK) / s
	const top = Number.isFinite(g.hi) ? g.hi / s : f.y + 0.6 // g.hi: the band top (world, absolute)
	return { min: [g.x0 / s + b.i0 * c, f.y, g.z0 / s + b.k0 * c], max: [g.x0 / s + b.i1 * c, top, g.z0 / s + b.k1 * c] }
}

/**
 * A figure-eight of two lobes (radius r, centres ±c on x) joined by straight diagonals through the origin; the second
 * diagonal (heading −x) is the one that will carry the bridge. → { pts, dir2 }. A floor-and-deck track is a 'room' track.
 */
function eightPlan(c, r) {
	const L = Math.sqrt(c * c - r * r), al = Math.asin(r / c)
	const t1 = [L * Math.cos(al), L * Math.sin(al)], t2 = [L * Math.cos(al), -L * Math.sin(al)]
	const th = Math.atan2(t1[1], t1[0] - c)
	const out = [...T.dense([[-t1[0], -t1[1]], t1])]
	const arc = (cx, a0, a1) => {
		const m = Math.ceil((Math.abs(a1 - a0) * r) / T.STEP)
		for (let j = 0; j < m; j++) out.push([cx + r * Math.cos(a0 + ((a1 - a0) * j) / m), r * Math.sin(a0 + ((a1 - a0) * j) / m)])
	}
	arc(c, th, -th) // clockwise round the right lobe, the far side first
	out.push(...T.dense([t2, [-t2[0], -t2[1]]]))
	const th3 = Math.PI - th
	arc(-c, th3, 2 * Math.PI - th3) // counter-clockwise round the left lobe
	return { pts: out, dir2: [-Math.cos(al), Math.sin(al)] }
}

/** Levels of the bridge eight: up a skirted ramp, a deck over the crossing, down again (the second diagonal). */
function bridgeLevels(P, sp, o) {
	const n = P.length
	const at = (i) => ((i % n) + n) % n
	let c = -1, best = Infinity
	for (let i = 0; i < n; i++) {
		const j = at(i + 1)
		const hx = P[j][0] - P[i][0], hz = P[j][1] - P[i][1], l = Math.hypot(hx, hz)
		if (!l || (hx * o.dir2[0] + hz * o.dir2[1]) / l < 0.95) continue
		const d = G.dist(P[i], o.centre)
		if (d < best) (best = d), (c = i)
	}
	if (c < 0 || best > 1) return null
	const k = rampSteps(o.h, sp), dk = Math.ceil(o.deck / sp)
	const a = c - dk - k, b = c + dk + k
	const busy = new Uint8Array(n)
	if (!straight(P, a, b) || !claim(busy, a - 1, b + 1)) return null
	const Y = P.map(() => o.y)
	const c01 = (t) => (1 - Math.cos(Math.PI * t)) / 2
	for (let q = 0; q <= k; q++) (Y[at(a + q)] = o.y + o.h * c01(q / k)), (Y[at(b - q)] = o.y + o.h * c01(q / k))
	for (let i = c - dk; i <= c + dk; i++) Y[at(i)] = o.y + o.h
	return { Y, ramps: [{ from: at(a), to: at(c - dk) }, { from: at(c + dk), to: at(b) }], drops: [], decks: [{ from: at(c - dk), to: at(c + dk) }],
		busy, noStart: DK.bridgePoints(P, Y, n, o.width) }
}

/** The bridge eight in the hall's free regions → generator (null between tries, the track last). */
function* bridgeJob(PS, U, hall, meta) {
	const lobe = RH + 4, c = 24
	const { pts, dir2 } = eightPlan(c, lobe)
	const bb = G.bbox(pts)
	const w = bb[2] - bb[0], d = bb[3] - bb[1]
	let tries = 0
	for (const region of freeRegions(hall, PS.obstacles, BRIDGE_W, 4, PS.floors)) {
		const rw = region[2] - region[0], rd = region[3] - region[1]
		for (const turned of [false, true]) {
			const sx = turned ? d : w, sz = turned ? w : d
			if (sx > rw || sz > rd) continue
			for (const [fx, fz] of [[0, 0], [-0.5, 0], [0.5, 0], [0, -0.5], [0, 0.5]]) {
				const at = { turned, cx: (region[0] + region[2]) / 2 + fx * (rw - sx), cz: (region[1] + region[3]) / 2 + fz * (rd - sz) }
				const dense = PL.place(pts, at)
				const dir = turned ? [-dir2[1], dir2[0]] : dir2
				const o = { centre: [at.cx, at.cz], dir2: dir, y: hall.y, h: BRIDGE_H, deck: 7, width: BRIDGE_W }
				const t = buildTrack(dense, { id: 'hall-bridge', name: 'Toy bridge', floor: 'room', kind: 'room', y: hall.y, width: BRIDGE_W,
					levels: (P, sp) => bridgeLevels(P, sp, o), ...meta }, U)
				if (t && validateTrack(t, U).ok) return yield t
				yield null
				if (++tries >= 12) return
			}
		}
	}
}

/** Weave candidates: square blocks (half sizes hs) over the hall's middle, nearest the hall's centre line first. */
function weaveTargets(hall, stage, sizes) {
	const r = hall.rect
	const z0 = stage ? Math.max(r[1], stage.rect[3]) : r[1]
	const out = []
	for (const hs of sizes) for (const fz of [0.3, 0.45, 0.6, 0.75]) {
		for (const fx of [0.5, 0.35, 0.65]) {
			const cx = r[0] + fx * (r[2] - r[0]), cz = z0 + fz * (r[3] - z0)
			out.push([[cx - hs, cz - hs], [cx + hs, cz - hs], [cx + hs, cz + hs], [cx - hs, cz + hs]])
		}
	}
	return out
}

const TOURS = [
	{ id: 'room-long-tour', name: 'Grand hall tour', exit: 'ramp', legs: [[0.05, 0.95], [0.15, 0.85]], gridRun: 14,
		aims: [[1, 1.5], [-1, 1.5]] },
	{ id: 'room-long-leap', name: 'Long way round', exit: 'drop', legs: [[0.1, 0.9], [0.2, 0.8]], gridRun: 14,
		aims: [[1, 0.3], [0, 1], [-1, 0.3]] },
]

/** Generator over the toy track set: null between tries, { done, tracks (world), floors (world), bounds } last. */
function* toyJobs(scene, s, deps) {
	const U = SC.toUnitScene(scene, s)
	const hall = U.floors.find((f) => f.id === 'hall'), stage = U.floors.find((f) => f.id === 'stage')
	const PS = { ...U, obstacles: [...U.obstacles, ...planObstacles(U)] }
	const meta = { maxPoints: SC.TOY_MAX_POINTS, maxLength: R.MAX_LENGTH }
	const toyW = (list) => list.filter((w) => w >= U.toy.minWidth - 1e-9 && w <= U.toy.maxWidth + 1e-9)
	const room = [], tours = [], short = []
	const taken = () => new Set([...room, ...tours, ...short].map((t) => t.id))
	const grid = (f) => U.toy.occ.find((g) => g.floor === f.id)
	const hasStage = hall && stage && stage.y > hall.y + 0.35
	if (hasStage) for (const t of roomJobs(PS, { widths: toyW([4, 3.5, 3]), meta, designs: ['loop', 'leap', 'double'] })) if (t) room.push(t); else yield null
	if (hall) {
		for (const t of bridgeJob(PS, U, hall, meta)) if (t) room.push(t); else yield null
		const pg = T.planGrid(hall, grid(hall), s, { walls: hasStage ? [stage.rect] : [] })
		const ctx = { U, hall, stage, pg, oc: grid(hall) ? grid(hall).cell / s : 0.3 }
		yield null
		let woven = 0
		for (const targets of weaveTargets(hall, hasStage ? stage : null, [26, 30, 22])) {
			const t = R.weave(ctx, { id: 'hall-weave', name: 'Table weave', width: 4, targets })
			yield null
			if (t && t.length >= 120 && t.length <= 300) {
				room.push(t)
				if (++woven >= 1) break
			}
		}
		if (hasStage) {
			for (const spec of TOURS) {
				const t = R.tour(ctx, { ...spec, width: 3.5 })
				if (t) tours.push(t)
				yield null
			}
		}
	}
	const singles = [
		[stage, [['oval', PLAIN], ['gp', PLAIN]], toyW([3.5, 3]), { oval: 28, gp: 30 }],
		[hall, [['loop', JUMP], ['gp', PLAIN]], toyW([4, 3.5]), { loop: 26, gp: 44 }],
	]
	for (const [floor, fams, widths, caps] of singles) {
		if (!floor) continue
		for (const fam of fams) for (const t of deps.searchFamily(PS, floor, fam, taken(), { widths, caps, meta })) if (t) short.push(t); else yield null
	}
	const round = SC.roundTo(s)
	const tracks = []
	for (const [list, laps] of [[room, LAPS], [short, LAPS], [tours, 1]]) {
		for (const t of list) {
			const w = SC.scaleTrack({ ...t, laps }, s, round)
			if (validateTrack(w, scene).ok) tracks.push(w)
		}
	}
	const bounds = scene?.bounds ? { min: [...scene.bounds.min], max: [...scene.bounds.max] } : null
	yield { done: true, tracks, floors: (scene.floors || []).filter((f) => f && Array.isArray(f.rect)), bounds }
}

module.exports = { toyJobs }
