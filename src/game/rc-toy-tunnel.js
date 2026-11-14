'use strict'

/**
 * WO-1074 §3.1 — where a toy track can tunnel through a table (pure, deterministic). For every tunnel-able blob of the
 * hall grid (rc-toy-blobs.js) and every heading (each 5°, both driving directions) a straight line through the blob's
 * centre is a corridor when
 *   - the carve (cells within width/2 + 1 cell of the line between the portals — rc-scene-occ.js `carveCells`) frees
 *     only cells of tunnel-able blobs;
 *   - the portals sit 1 cell + MARGIN beyond the last blocked cell near the line (cells within the carve radius + ¾
 *     cell, gaps under GAP cells closing up), so the uncarved grid keeps width/2 + 1 cell from the stretch outside;
 *   - PORT (2 widths + 2, unit) of straight beyond each portal keeps width/2 + 1 cell + MARGIN in the occupancy grid
 *     and stays in the hall clear of its walls (the pinned part of the track, A … B), and LEAD more beyond that keeps
 *     the router's clearance (the free part the smoothing joins to the route: A2 … A, B … B2);
 *   - the portals are 0.7–3.9 m apart (rule 0.6–4).
 * corridors(ctx, width) → [{ blob, ang, a, b (portals), A, B (pinned straight), A2, B2 (route ends), u, len }] in the
 * unit frame, best (shortest, then blob id, heading) first. ctx: rc-toy-route.js's (U, hall, pg, oc).
 */

const G = require('./rc-track-geo')
const { blobsOf } = require('./rc-toy-blobs')

const HEADINGS = 72 // 5° steps over a full turn (each heading is one driving direction)
const REACH = 5 // world m: blocked cells this far along the line from the blob's centre are looked at
const GAP = 2 // cells: blocked runs along the line closer than this are one obstacle
const MARGIN = 0.03 // world m beyond the rule
const LEN = [0.7, 3.9] // world m between the portals (rule 0.6–4)
const STEP = 0.02 // world m: clearance samples along the straights

function corridors(ctx, width) {
	const { U, hall, stage, pg, oc } = ctx
	const s = U.toy.s
	const g = U.toy.occ.find((q) => q.floor === hall.id)
	if (!g) return []
	const { lab, blobs } = blobsOf(g, U.toy.floors || [], U.toy.field || null)
	const edt = g.clearance()
	const r = (width * s) / 2 + g.cell
	const need = r + MARGIN
	const port = (2 * width + 2) * s, lead = (2 * width + 2) * s
	const needU = width / 2 + oc + 0.3 + 0.1 // the router's clearance (rc-toy-route.js needOf) + the smoothing's slack
	const clr = (x, z) => {
		const i = Math.floor((x - g.x0) / g.cell), k = Math.floor((z - g.z0) / g.cell)
		return i < 0 || k < 0 || i >= g.w || k >= g.h ? -1 : edt[k * g.w + i] - 0.71 * g.cell
	}
	const hr = hall.rect, walls = stage ? [stage.rect] : []
	const wall = (x, z) => Math.min(x - hr[0], hr[2] - x, z - hr[1], hr[3] - z, ...walls.map((w) => G.pointRectDist([x, z], w)))
	const out = []
	for (const b of blobs) {
		if (!b.ok) continue
		const [cx, cz] = b.c
		const i0 = Math.max(0, Math.floor((cx - REACH - g.x0) / g.cell)), i1 = Math.min(g.w - 1, Math.floor((cx + REACH - g.x0) / g.cell))
		const k0 = Math.max(0, Math.floor((cz - REACH - g.z0) / g.cell)), k1 = Math.min(g.h - 1, Math.floor((cz + REACH - g.z0) / g.cell))
		for (let h = 0; h < HEADINGS; h++) {
			const ang = (h * 2 * Math.PI) / HEADINGS, ux = Math.cos(ang), uz = Math.sin(ang)
			const near = []
			for (let k = k0; k <= k1; k++) {
				for (let i = i0; i <= i1; i++) {
					const q = k * g.w + i
					if (!g.bits[q]) continue
					const px = g.x0 + (i + 0.5) * g.cell - cx, pz = g.z0 + (k + 0.5) * g.cell - cz
					const t = px * ux + pz * uz, d = Math.abs(-px * uz + pz * ux)
					if (Math.abs(t) <= REACH && d <= r + 0.75 * g.cell) near.push({ t, d, q })
				}
			}
			const own = near.filter((p) => lab[p.q] === b.id)
			if (!own.length) continue
			let lo = Math.min(...own.map((p) => p.t)), hi = Math.max(...own.map((p) => p.t))
			const ext = r + g.cell + MARGIN
			for (let grew = true; grew; ) {
				grew = false
				for (const p of near) {
					if (p.t < lo && p.t >= lo - Math.max(ext, GAP * g.cell)) (lo = p.t), (grew = true)
					if (p.t > hi && p.t <= hi + Math.max(ext, GAP * g.cell)) (hi = p.t), (grew = true)
				}
			}
			const tin = lo - ext, tout = hi + ext
			if (tout - tin < LEN[0] || tout - tin > LEN[1]) continue
			// the carve: every blocked cell within r of the portal-to-portal segment belongs to a tunnel-able blob
			const segD = (p) => {
				const t = Math.max(tin, Math.min(tout, p.t))
				return Math.hypot(p.t - t, p.d)
			}
			if (near.some((p) => segD(p) <= r && !blobs[lab[p.q]]?.ok)) continue
			const at = (t) => [cx + ux * t, cz + uz * t]
			let ok = true
			for (const [t0, t1] of [[tin - port, tin], [tout, tout + port]]) {
				for (let t = t0; t <= t1 + 1e-9 && ok; t += STEP) {
					const [x, z] = at(t)
					if (clr(x, z) < need || wall(x / s, z / s) < needU) ok = false
				}
			}
			for (const [t0, t1] of [[tin - port - lead, tin - port], [tout + port, tout + port + lead]]) {
				for (let t = t0; t <= t1 + 1e-9 && ok; t += STEP * 5) {
					const [x, z] = at(t)
					if (pg.lerp(x / s, z / s) < needU) ok = false
				}
			}
			if (!ok) continue
			const U2 = (t) => at(t).map((v) => v / s)
			out.push({ blob: b.id, ang: h * (360 / HEADINGS), u: [ux, uz], len: tout - tin, a: U2(tin), b: U2(tout), A: U2(tin - port), B: U2(tout + port),
				A2: U2(tin - port - lead), B2: U2(tout + port + lead) })
		}
	}
	return out.sort((p, q) => p.len - q.len || p.blob - q.blob || p.ang - q.ang)
}

module.exports = { corridors, MARGIN, LEN }
