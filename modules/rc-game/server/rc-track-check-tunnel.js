'use strict'

/**
 * WO-1074 §3.1 — tunnels through tables, the validator's part (pure; called by rc-track-check.js in the unit frame,
 * lengths ÷ scale, so 0.6–4 m at 0.1 is 6–40 here). Track field `tunnels: [{ from, to }]` (point indices, driving order,
 * from < to: a tunnel never spans the start line; absent = none).
 *
 * Carving (game/rc/occ.js MUST agree, rc-scene-occ.js `carveCells`): for the active track, every occupancy cell whose
 * centre lies within width/2 + 1 cell (world) of the WORLD centre line from … to is free — in the grid of the floor the
 * tunnel lies on (|grid.y − points[from].y| ≤ 0.02 · scale). Everything else stays as in `occ`. Inside a tunnel the
 * remaining blocked cells are the corridor walls: there the ribbon itself (width/2) must be clear (rc-track-check-occ.js).
 *
 * Rules (contract §3.1): at most 3; the carve frees ≥ 1 blocked cell and every blocked cell it frees belongs to a
 * tunnel-able blob (rc-toy-blobs.js); level floor (no ramp, deck or drop inside or within 2 widths of a portal); plan
 * radius ≥ 2 × the floor's minimum (k = 1, 2); both portals open onto ≥ 2 widths of free straight (radius ≥ 8 there,
 * not in a tunnel, clear by width/2 + 1 cell in the UNCARVED grid); length 6–40; no pad, box, checkpoint, grid slot or
 * the start line inside or within 1 width of a portal; a tunnel never crosses another part of the track (every segment
 * outside it and its 2-width portal stretches keeps ≥ 2 × (width/2 + 1 cell) from its centre line).
 * Refinement (15.11, contract §3.1): the portal stretches are clear in the CARVED grid (the carve's round end cap frees
 * the cloth at the portal, so the tube starts at the furniture, not a carve radius in front of it); the tube is under a
 * roof — ≥ ROOF_SHARE (85 %) of its centre line (sampled every SAMPLE) has geometry ≥ ROOF (0.3 m) above the floor in
 * the height field; and it does not run in the open — at each end ≤ OPEN (0.15 m) of it lies before the first sample
 * that is covered (a blocked cell of the uncarved grid, or roofed): `coverOf`, `tubeCover`.
 */

const G = require('./rc-track-geo')
const { GROUND_TOL } = require('./rc-ground')
const { carveCells, carved } = require('./rc-scene-occ')
const { blobsOf } = require('./rc-toy-blobs')
const { nearest } = require('./rc-track-check-deco')

const MAX_TUNNELS = 3
const LEN = [6, 40] // unit (0.6–4 m at 0.1)
const PORTAL = 2 // widths of free straight beyond each portal; also the level-floor margin
const STRAIGHT_R = 8 // a portal stretch is straight: radius ≥ this (RADIUS_RAMP)
const DECO = 1 // widths: no pad / box / checkpoint / grid slot / start line this close to a portal
const RADIUS = { stage: 1.8, hall: 3 } // the floor's minimum turn radius (× 2 inside a tunnel)
const ROOF = 0.3 // world m above the floor
const ROOF_SHARE = 0.85
const OPEN = 0.15 // world m per end
const SAMPLE = 0.01 // world m

/** (x, z) world → is there geometry ≥ ROOF above grid g's floor (the height field)? */
const roofOf = (g, field) => (x, z) => !!field && Number.isFinite(field.bottomAbove(x, z, g.y + ROOF))

/** (x, z) world → is the tube covered there: a blocked cell of the (uncarved) grid g, or roofed? */
function coverOf(g, field) {
	const roof = roofOf(g, field)
	return (x, z) => {
		const i = Math.floor((x - g.x0) / g.cell), k = Math.floor((z - g.z0) / g.cell)
		if (i >= 0 && k >= 0 && i < g.w && k < g.h && g.bits[k * g.w + i]) return true
		return roof(x, z)
	}
}

/** The world polyline `line` ([[x, z]]) sampled every SAMPLE → { share (roofed), open: [entry, exit] (m before / after the first / last covered sample) }. */
function tubeCover(line, roof, cover) {
	const at = []
	let s0 = 0
	for (let j = 0; j + 1 < line.length; j++) {
		const [ax, az] = line[j], [bx, bz] = line[j + 1]
		const l = Math.hypot(bx - ax, bz - az)
		for (let d = Math.ceil(s0 / SAMPLE) * SAMPLE - s0; d < l - 1e-12; d += SAMPLE) at.push([ax + ((bx - ax) * d) / l, az + ((bz - az) * d) / l, s0 + d])
		s0 += l
	}
	at.push([...line[line.length - 1], s0])
	let roofed = 0, first = null, last = null
	for (const [x, z, d] of at) {
		if (roof(x, z)) roofed++
		if (cover(x, z)) (first ??= d), (last = d)
	}
	return { share: roofed / at.length, open: first === null ? [s0, s0] : [first, s0 - last], len: s0 }
}

/** → { list: [{ from, to }], seg (segment i in a tunnel), pt, error }. */
function tunnelBook(track, n) {
	const seg = new Uint8Array(n), pt = new Uint8Array(n)
	const out = { list: [], seg, pt, error: null }
	if (track.tunnels == null) return out
	if (!Array.isArray(track.tunnels)) return { ...out, error: 'tunnels must be an array' }
	if (track.tunnels.length > MAX_TUNNELS) return { ...out, error: `tunnels: ${track.tunnels.length} (at most ${MAX_TUNNELS})` }
	let last = -1
	for (const [k, t] of track.tunnels.entries()) {
		if (!t || !Number.isInteger(t.from) || !Number.isInteger(t.to) || t.from < 0 || t.to >= n || t.from >= t.to) return { ...out, error: `tunnel ${k}: bad range` }
		if (t.from <= last) return { ...out, error: `tunnel ${k} overlaps or is out of driving order` }
		last = t.to
		for (let i = t.from; i <= t.to; i++) (pt[i] = 1), i < t.to && (seg[i] = 1)
		out.list.push({ from: t.from, to: t.to })
	}
	return out
}

/** Index ranges within `m` (plan) beyond each portal: before from (driving towards it) and after to. */
function portalStretch(n, along, t, m) {
	const before = [], after = []
	for (let i = (t.from - 1 + n) % n, c = 0; c < n && along(i, t.from) <= m + 1e-9; i = (i - 1 + n) % n, c++) before.push(i)
	for (let i = (t.to + 1) % n, c = 0; c < n && along(t.to, i) <= m + 1e-9; i = (i + 1) % n, c++) after.push(i)
	return { before, after }
}

/**
 * The carve of every tunnel (world): → { grids: Map(grid → carved grid), freed: [[blocked cell indices] per tunnel],
 * gridOf: [grid per tunnel] }. world: the world track (exact points) when the caller has it.
 */
function carveTrack(track, world, toy, list) {
	const s = toy.s
	const W = world || { points: track.points.map((p) => p.map((v) => v * s)), width: track.width * s }
	const per = new Map()
	const freed = [], gridOf = []
	for (const t of list) {
		const y = W.points[t.from][1]
		const g = toy.occ.find((q) => Math.abs(q.y - y) <= GROUND_TOL * s)
		gridOf.push(g || null)
		if (!g) {
			freed.push([])
			continue
		}
		const line = []
		for (let i = t.from; i <= t.to; i++) line.push([W.points[i][0], W.points[i][2]])
		const cells = carveCells(g, line, W.width / 2 + g.cell)
		if (!per.has(g)) per.set(g, [])
		per.get(g).push(...cells)
		freed.push(cells.filter((q) => g.bits[q] === 1))
	}
	const grids = new Map()
	for (const [g, cells] of per) grids.set(g, carved(g, cells))
	return { grids, freed, gridOf }
}

/**
 * → { error } | { grids }. ctx (unit frame): { P, Y, n, s (arc), L, half, width, along, rampPt, dropSeg, book, tb, world }.
 */
function checkTunnels(track, scene, ctx) {
	const { P, Y, n, s, L, half, width, along, rampPt, dropSeg, book, tb } = ctx
	const err = (m) => ({ error: m })
	const toy = scene?.toy
	if (!toy || !toy.occ?.length) return err('tunnels need the occupancy grids (a toy scene)')
	const floors = (scene.floors || []).filter((f) => f && Array.isArray(f.rect))
	const cv = carveTrack(track, ctx.world, toy, tb.list)
	const busy = (i) => rampPt[i] || dropSeg[i] || dropSeg[(i - 1 + n) % n] || book.deckPt[i]
	for (const [k, t] of tb.list.entries()) {
		const tag = `tunnel ${k}`
		const g = cv.gridOf[k]
		if (!g) return err(`${tag}: not on a floor with an occupancy grid`)
		// what it passes through: tunnel-able blobs only, at least one cell of one
		if (!cv.freed[k].length) return err(`${tag} passes through no blocked cell (not a tunnel)`)
		const { lab, blobs } = blobsOf(g, toy.floors || [], toy.field || null)
		for (const q of cv.freed[k]) {
			const b = blobs[lab[q]]
			if (!b || !b.ok) return err(`${tag} cuts through a blob that is not tunnel-able (${b ? b.why : '?'}) at cell ${q}`)
		}
		// level floor
		const f = floors.find((q) => Math.abs(q.y - Y[t.from]) <= GROUND_TOL && G.inRect(P[t.from][0], P[t.from][1], q.rect))
		if (!f) return err(`${tag} is not on a floor`)
		for (let i = t.from; i <= t.to; i++) {
			if (busy(i)) return err(`${tag}: a ramp, deck or drop inside at ${i}`)
			if (Math.abs(Y[i] - f.y) > GROUND_TOL || !G.inRect(P[i][0], P[i][1], f.rect)) return err(`${tag} is not level on the ${f.id} at ${i}`)
		}
		const ps = portalStretch(n, along, t, PORTAL * width)
		for (const i of [...ps.before, ...ps.after]) if (busy(i)) return err(`${tag}: a ramp, deck or drop within 2 widths of a portal at ${i}`)
		// radius inside ≥ 2 × the floor's minimum
		const rMin = 2 * (f.id === 'stage' ? RADIUS.stage : RADIUS.hall)
		for (let i = t.from; i <= t.to; i++) {
			for (const m of [1, 2]) {
				const r = G.circumradius(P[(i - m + n) % n], P[i], P[(i + m) % n])
				if (r < rMin - 1e-6) return err(`${tag}: turn radius ${r.toFixed(2)} < ${rMin} at ${i}`)
			}
		}
		// both portals open onto 2 widths of free straight
		const cellU = g.cell / toy.s
		const gc = cv.grids.get(g) || g // the portal stretches see the carve (its end cap frees the cloth at the portal)
		for (const [side, idx] of [['entry', ps.before], ['exit', ps.after]]) {
			for (const i of idx) {
				if (tb.pt[i]) return err(`${tag}: the ${side} portal runs into another tunnel at ${i}`)
				if (G.circumradius(P[(i - 1 + n) % n], P[i], P[(i + 1) % n]) < STRAIGHT_R - 1e-6) return err(`${tag}: the ${side} portal does not open onto a straight (at ${i})`)
				const j = side === 'entry' ? (i + 1) % n : (i - 1 + n) % n
				const r = half * toy.s + g.cell
				const S = toy.s
				if (gc.segNear(P[i][0] * S, P[i][1] * S, P[j][0] * S, P[j][1] * S, r) < r) return err(`${tag}: the ${side} portal does not open onto free floor (at ${i})`)
			}
		}
		// under a roof, not in the open
		const line = []
		for (let i = t.from; i <= t.to; i++) line.push([P[i][0] * toy.s, P[i][1] * toy.s])
		const tc = tubeCover(line, roofOf(g, toy.field), coverOf(g, toy.field))
		if (tc.share < ROOF_SHARE - 1e-9) return err(`${tag}: ${(tc.share * 100).toFixed(1)} % under a roof ≥ ${ROOF} m (≥ ${ROOF_SHARE * 100} %)`)
		for (const [k2, side] of ['entry', 'exit'].entries()) {
			if (tc.open[k2] > OPEN + 1e-9) return err(`${tag}: ${tc.open[k2].toFixed(3)} m of tube in the open at the ${side} (≤ ${OPEN})`)
		}
		// length
		const len = along(t.from, t.to)
		if (len < LEN[0] - 1e-6 || len > LEN[1] + 1e-6) return err(`${tag}: ${(len * toy.s).toFixed(2)} m long (0.6–4)`)
		// no decoration inside or within a width of a portal
		const w0 = (s[t.from] - DECO * width + L) % L, span = len + 2 * DECO * width
		const inside = (at) => (at - w0 + L) % L <= span
		if (inside(0)) return err(`${tag}: the start line is inside or within a width of a portal`)
		for (const c of track.checkpoints || []) if (Number.isInteger(c) && c >= 0 && c < n && inside(s[c])) return err(`${tag}: checkpoint ${c} inside or within a width of a portal`)
		const nctx = { P, s, n, Y }
		for (const [kind, list] of [['grid slot', track.grid], ['pad', track.pads], ['box', track.boxes]]) {
			for (const [m, o] of (Array.isArray(list) ? list : []).entries()) {
				if (!o || ![o.x, o.y, o.z].every(Number.isFinite)) continue
				const at = nearest(nctx, o.x, o.z, kind === 'box' ? o.y - 0.5 : o.y)
				if (inside(at.at)) return err(`${tag}: ${kind} ${m} inside or within a width of a portal`)
			}
		}
		// never crosses another part of the track
		const clear = 2 * (half + cellU)
		const lo = (s[t.from] - PORTAL * width + L) % L, wide = len + 2 * PORTAL * width
		const near = (i) => (s[i] - lo + L) % L <= wide || (s[(i + 1) % n] - lo + L) % L <= wide
		for (let i = t.from; i < t.to; i++) {
			for (let j = 0; j < n; j++) {
				if (near(j)) continue
				const d = G.segSegDist(P[i], P[i + 1], P[j], P[(j + 1) % n])
				if (d < clear - 1e-9) return err(`${tag} crosses / runs beside another part of the track (${i} / ${j}, ${(d * toy.s).toFixed(3)} m)`)
			}
		}
	}
	return { grids: cv.grids }
}

module.exports = { tunnelBook, checkTunnels, coverOf, LEN, ROOF_SHARE, OPEN }
