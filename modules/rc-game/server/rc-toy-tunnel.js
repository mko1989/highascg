'use strict'

/**
 * WO-1074 §3.1 — where a toy track can tunnel through a table (pure, deterministic). Refined 15.11 (owner: the track
 * disappears into the tablecloth of a round table and comes out the other side): every corridor runs through the
 * MIDDLE of a table top (rc-toy-blobs.js tablesOf). For every table, every heading (each 5°, both driving directions)
 * and a line OFFS × the table's radius beside its centre (≤ 25 %), a straight line is a corridor when
 *   - the portals sit where the tube enters the furniture: each is the first spot (SLIDE steps out from the first
 *     blocked cell near the line) from which the PORT straight beyond it keeps width/2 + 1 cell + PM from every
 *     blocked cell the carve does not free (the carve: cells whose centres lie within width/2 + 1 cell of the line
 *     between the portals — rc-scene-occ.js `carveCells`; its round end cap frees the cloth at the portal), so the
 *     tube starts at the cloth, not a carve radius in front of it;
 *   - ≤ OPEN_GEN of the line at each end lies in the open (no blocked cell and no roof ≥ 0.3 m — rc-track-check-tunnel.js
 *     `coverOf`) and ≥ TOP_SHARE of it under the table top;
 *   - the carve frees only cells of tunnel-able blobs;
 *   - PORT (2 widths + 2, unit) of straight beyond each portal stays in the hall clear of its walls (the pinned part of
 *     the track, A … B), and LEAD more beyond that keeps the router's clearance (the free part the smoothing joins to the
 *     route: A2 … A, B … B2);
 *   - the portals are 0.7–3.9 m apart (rule 0.6–4).
 * The track keeps the portals on its resampled points rounded outwards (rc-track-build.js tunnelRanges), so the margins
 * here cover one point spacing (SP_W). corridors(ctx, width) → [{ table, blob, tc, R, off, ang, u, len, top, open, a, b
 * (portals), A, B (pinned straight), A2, B2 (route ends) }] in the unit frame, best first (on the centre, least open,
 * most under the top, shortest). ctx: rc-toy-route.js's (U, hall, pg, oc; `used`: table ids other tracks took).
 */

const G = require('./rc-track-geo')
const { segSquare } = require('./rc-scene-occ')
const { blobsOf, tablesOf, tableTop } = require('./rc-toy-blobs')
const { coverOf } = require('./rc-track-check-tunnel')

const HEADINGS = 72 // 5° steps over a full turn (each heading is one driving direction)
const OFFS = [0, 0.12, -0.12, 0.24, -0.24] // × the table's radius: the line passes this far beside its centre
const GAP = 2 // cells: blocked runs along the line closer than this are one obstacle
const MARGIN = 0.03 // world m beyond the rule
const PM = 0.005 // world m: the portal straight's clearance over the rule
const SLIDE = 0.005 // world m: portal search step
const LEN = [0.7, 3.9] // world m between the portals (rule 0.6–4)
const STEP = 0.02 // world m: clearance samples along the straights
const SAMPLE = 0.01 // world m: roof samples along the tube
const TOP_SHARE = 0.5 // of the tube under the table top (asked 0.85; every live table is ringed by chairs: 0.52–0.56 at best)
const SP_W = 0.06 // world m: a track point spacing (the outward rounding of the portals)
const OPEN_GEN = 0.15 - SP_W - 0.02 // world m in the open per end (rule ≤ 0.15 after the rounding)

function corridors(ctx, width) {
	ctx.corridorCache ??= new Map()
	if (!ctx.corridorCache.has(width)) ctx.corridorCache.set(width, corridorsOf(ctx, width))
	return ctx.corridorCache.get(width).filter((c) => !ctx.used?.has(c.table))
}

function corridorsOf(ctx, width) {
	const { U, hall, stage, pg, oc } = ctx
	const s = U.toy.s
	const g = U.toy.occ.find((q) => q.floor === hall.id)
	const field = U.toy.field || null
	if (!g || !field) return []
	const { lab, blobs } = blobsOf(g, U.toy.floors || [], field)
	const tables = tablesOf(g, U.toy.floors || [], field)
	const r = (width * s) / 2 + g.cell
	const port = (2 * width + 2) * s, lead = (2 * width + 2) * s
	const needU = width / 2 + oc + 0.3 + 0.1 // the router's clearance (rc-toy-route.js needOf) + the smoothing's slack
	const hr = hall.rect, walls = stage ? [stage.rect] : []
	const wall = (x, z) => Math.min(x - hr[0], hr[2] - x, z - hr[1], hr[3] - z, ...walls.map((w) => G.pointRectDist([x, z], w)))
	const top = tableTop(field, g.y)
	const cover = coverOf(g, field)
	const out = []
	for (const T of tables) {
		const B = blobs[T.blob]
		const [cx, cz] = T.c
		const reach = Math.hypot(B.rect[2] - B.rect[0], B.rect[3] - B.rect[1]) / 2 + port + 0.3
		const cells = []
		const i0 = Math.max(0, Math.floor((cx - reach - g.x0) / g.cell)), i1 = Math.min(g.w - 1, Math.floor((cx + reach - g.x0) / g.cell))
		const k0 = Math.max(0, Math.floor((cz - reach - g.z0) / g.cell)), k1 = Math.min(g.h - 1, Math.floor((cz + reach - g.z0) / g.cell))
		for (let k = k0; k <= k1; k++) {
			for (let i = i0; i <= i1; i++) {
				const q = k * g.w + i
				if (!g.bits[q]) continue
				const px = g.x0 + (i + 0.5) * g.cell - cx, pz = g.z0 + (k + 0.5) * g.cell - cz
				if (Math.hypot(px, pz) <= reach + r + g.cell) cells.push({ q, px, pz, sx: g.x0 + i * g.cell, sz: g.z0 + k * g.cell })
			}
		}
		const lat = r + g.cell + MARGIN
		// the cells near a line through the centre at heading u, split by their lateral offset e (signed)
		const nearOf = (ux, uz) => {
			const out = []
			for (const c of cells) {
				const e = -c.px * uz + c.pz * ux
				if (Math.abs(e) <= lat + 0.25 * T.R) out.push({ ...c, t0: c.px * ux + c.pz * uz, e })
			}
			return out
		}
		const corridorAt = (cand, off, ux, uz) => {
			const o = off * T.R, ox = cx - uz * o, oz = cz + ux * o
			const at = (t) => [ox + ux * t, oz + uz * t]
			const near = []
			for (const c of cand) {
				const d = Math.abs(c.e - o)
				if (d <= lat && Math.abs(c.t0) <= reach) near.push({ t: c.t0, d, q: c.q, sx: c.sx, sz: c.sz })
			}
			const band = near.filter((p) => p.d <= r + 0.75 * g.cell)
			const own = band.filter((p) => lab[p.q] === T.blob)
			if (!own.length) return null
			let lo = Math.min(...own.map((p) => p.t)), hi = Math.max(...own.map((p) => p.t))
			const ext = r + g.cell + MARGIN
			for (let grew = true; grew; ) {
				grew = false
				for (const p of band) {
					if (p.t < lo && p.t >= lo - Math.max(ext, GAP * g.cell)) (lo = p.t), (grew = true)
					if (p.t > hi && p.t <= hi + Math.max(ext, GAP * g.cell)) (hi = p.t), (grew = true)
				}
			}
			// carved: centre within r of the line between the portals
			const carvedBy = (p, a, b) => Math.hypot(p.t - Math.max(a, Math.min(b, p.t)), p.d) <= r
			const clearStraight = (t0, t1, a, b, list = near) => {
				const [ax, az] = at(t0), [bx, bz] = at(t1)
				const far = r + PM + 0.71 * g.cell // a centre this far from the straight: its cell is too
				return list.every((p) => Math.hypot(Math.max(0, t0 - p.t, p.t - t1), p.d) >= far || carvedBy(p, a, b) || segSquare(ax, az, bx, bz, p.sx, p.sz, g.cell) >= r + PM)
			}
			// (only the cells by a portal matter for its straight: the rest are carved or farther than r from it)
			const head = near.filter((p) => p.t <= lo + 2 * ext), tail = near.filter((p) => p.t >= hi - 2 * ext)
			let tin = null, tout = null
			for (let d = 0; d <= ext + 1e-9 && tin === null; d += SLIDE) if (clearStraight(lo - d - port, lo - d, lo - d, hi + ext, head)) tin = lo - d
			for (let d = 0; d <= ext + 1e-9 && tout === null; d += SLIDE) if (clearStraight(hi + d, hi + d + port, lo - ext, hi + d, tail)) tout = hi + d
			if (tin === null || tout === null) return null
			if (!clearStraight(tin - port, tin, tin, tout) || !clearStraight(tout, tout + port, tin, tout)) return null
			const len = tout - tin
			if (len < LEN[0] || len > LEN[1]) return null
			// in the open at each end, and under the table top
			let o1 = null, o2 = null, onTop = 0, m = 0
			for (let t = tin; t <= tout + 1e-9; t += SAMPLE) {
				const [x, z] = at(t)
				if (o1 === null && cover(x, z)) o1 = t - tin
				m++
				if (top(x, z)) onTop++
			}
			for (let t = tout; t >= tin - 1e-9 && o2 === null; t -= SAMPLE) if (cover(...at(t))) o2 = tout - t
			if (o1 === null || o1 > OPEN_GEN || o2 > OPEN_GEN) return null
			const share = onTop / m
			if (share < TOP_SHARE) return null
			// the carve (one point spacing longer each end): every blocked cell it frees belongs to a tunnel-able blob
			if (near.some((p) => carvedBy(p, tin - SP_W, tout + SP_W) && !blobs[lab[p.q]]?.ok)) return null
			let ok = true
			for (const [t0, t1] of [[tin - port, tin], [tout, tout + port]]) {
				for (let t = t0; t <= t1 + 1e-9 && ok; t += STEP) {
					const [x, z] = at(t)
					if (wall(x / s, z / s) < needU) ok = false
				}
			}
			for (const [t0, t1] of [[tin - port - lead, tin - port], [tout + port, tout + port + lead]]) {
				for (let t = t0; t <= t1 + 1e-9 && ok; t += STEP * 5) {
					const [x, z] = at(t)
					if (pg.lerp(x / s, z / s) < needU) ok = false
				}
			}
			if (!ok) return null
			const U2 = (t) => at(t).map((v) => v / s)
			return { len, top: share, open: [o1, o2], a: U2(tin), b: U2(tout), A: U2(tin - port), B: U2(tout + port), A2: U2(tin - port - lead), B2: U2(tout + port + lead) }
		}
		for (let h = 0; h < HEADINGS; h++) {
			const ang = (h * 2 * Math.PI) / HEADINGS, ux = Math.cos(ang), uz = Math.sin(ang)
			const cand = nearOf(ux, uz)
			for (const off of OFFS) {
				const c = corridorAt(cand, off, ux, uz)
				if (c) out.push({ table: T.id, blob: T.blob, tc: T.c, R: T.R, off, ang: h * (360 / HEADINGS), u: [ux, uz], ...c })
			}
		}
	}
	const rank = (p) => Math.abs(p.off) * 10 + Math.max(...p.open) * 5 + (1 - p.top)
	return out.sort((p, q) => rank(p) - rank(q) || p.len - q.len || p.table - q.table || p.ang - q.ang || p.off - q.off)
}

module.exports = { corridors, MARGIN, LEN }
