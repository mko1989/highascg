'use strict'

/**
 * WO-1074 v2 — a track's decoration (pure): checkpoints (§2.7: none on or under a bridge), the 10-slot start grid,
 * 2–4 boost pads and 2–3 rows of 3–4 item boxes (contract §2.1; a track over 100 m up to 6 pads / 5 rows, §2.7). Pads and box rows alternate along the free road (≥ 6 m from the start line, ≥ 2 m from
 * any ramp or drop — the same `featureFree` the validator uses), each on the straightest point near its share of the
 * lap. Points are emitted as given; nothing here changes the line.
 */

const G = require('./rc-track-geo')
const { featureFree, limitsFor, GRID_SLOTS } = require('./rc-track-check-deco')
const { bridgePoints, airPoints } = require('./rc-track-check-deck')
const { rampIndices } = require('./rc-ground')

const r3 = (v) => Math.round(v * 1000) / 1000
const BOX_LIFT = 0.5

/** The per-index bookkeeping featureFree needs. */
function context(t) {
	const n = t.points.length
	const P = G.plan(t.points)
	const { s, total: L } = G.arcLengths(P)
	const rampSeg = new Uint8Array(n), dropSeg = new Uint8Array(n), flight = new Uint8Array(n)
	for (const r of t.ramps) {
		const idx = rampIndices(r, n)
		for (let j = 0; j < idx.length - 1; j++) rampSeg[idx[j]] = 1
	}
	for (const d of t.drops) {
		for (let i = d.at, j = 0; i !== d.land; i = (i + 1) % n, j++) {
			dropSeg[i] = 1
			if (j) flight[i] = 1
		}
	}
	const Y = t.points.map((p) => p[1])
	const bridge = t.decks?.length ? bridgePoints(P, Y, n, t.width) : new Uint8Array(n)
	const air = airPoints(t, P, Y, n) // a drop's flight + as far as a fast car still flies too high for a gate
	return { P, s, L, n, rampSeg, dropSeg, flight, bridge, air }
}

const dirAt = (P, i) => {
	const n = P.length
	const a = P[i], b = P[(i + 1) % n]
	return [b[0] - a[0], b[1] - a[1]]
}

/** Ten staggered slots behind points[0] along the centre line, facing the driving direction. */
function startGrid(t) {
	const pts = G.plan(t.points)
	const n = pts.length
	const y = t.points[0][1]
	const out = []
	let i = 0, along = 0
	for (let k = 0; k < GRID_SLOTS; k++) {
		const want = 1.2 + k * 0.75
		for (;;) {
			if (i >= n) return null
			const a = pts[(n - i) % n], b = pts[(n - i - 1 + n) % n]
			const seg = G.dist(a, b)
			if (along + seg >= want) {
				const f = (want - along) / seg
				const x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f
				const tx = (a[0] - b[0]) / seg, tz = (a[1] - b[1]) / seg
				const side = (k % 2 === 0 ? 1 : -1) * (t.width / 4)
				out.push({ x: r3(x - tz * side), y, z: r3(z + tx * side), yaw: r3(G.yawOf(tx, tz)) })
				break
			}
			along += seg
			i++
		}
	}
	return out
}

function checkpoints(ctx) {
	const { n, L, air, bridge } = ctx
	const k = Math.max(4, Math.min(10, Math.round(L / 10)))
	const out = []
	for (let j = 0; j < k; j++) {
		let i = Math.round((j * n) / k)
		// never where a car flies over it (a drop) nor on / under a bridge (§2.7) — the first point past it
		while (i < n && (air[i] || bridge[i])) i++
		if (i >= n || (j + 1 < k && i >= Math.round(((j + 1) * n) / k) - 2)) continue // pushed onto the next one's place
		if (out.length && (i - out[out.length - 1] < 2 || i < out[out.length - 1])) continue
		out.push(i)
	}
	return out
}

/** Pads and box rows along the free road → { pads, boxes } or null when there is not room for 2 pads + 2 rows. */
function items(t, ctx) {
	const { P, s, L, n } = ctx
	const half = t.width / 2
	// §2.7: a long track carries one pad per ~30 m and one row per ~35 m, inside the validator's limitsFor(L)
	const lim = limitsFor(L)
	const nPads = Math.min(lim.pads[1], L >= 90 ? Math.max(3, Math.round(L / 30)) : 2)
	const nRows = Math.min(lim.rows[1], L >= 70 ? Math.max(3, Math.round(L / 35)) : 2)
	const perRow = t.width >= 3.5 ? 4 : 3
	const free = (i, m) => featureFree(ctx, s[i]) && featureFree(ctx, (s[i] - m + L) % L) && featureFree(ctx, (s[i] + m) % L)
	const head = P.map((_, i) => {
		const [dx, dz] = dirAt(P, i)
		return Math.atan2(dz, dx)
	})
	const turn = head.map((h, i) => G.angleDiff(h, head[(i - 1 + n) % n]) + G.angleDiff(head[(i + 1) % n], h))
	const cand = []
	for (let i = 0; i < n; i++) if (free(i, 0.4)) cand.push(i)
	if (!cand.length) return null
	const kinds = []
	for (let p = nPads, r = nRows; p || r; ) {
		if (p && (kinds.length % 2 === 0 || !r)) kinds.push('pad'), p--
		else kinds.push('row'), r--
	}
	const gap = (a, b) => Math.min(Math.abs(a - b), L - Math.abs(a - b))
	const taken = [] // { kind, at }
	// pads ≥ 3 m apart, boxes ≥ 2 m from a pad, rows > 1 m apart (the validator's rules, plus a margin)
	const fits = (kind, at) => taken.every((q) => gap(q.at, at) >= (kind === q.kind ? (kind === 'pad' ? 3.2 : 1.8) : 2.4))
	for (const [j, kind] of kinds.entries()) {
		const want = cand[Math.floor(((j + 0.5) / kinds.length) * cand.length)]
		const order = [...cand].sort((a, b) => (gap(s[a], s[want]) + 4 * turn[a]) - (gap(s[b], s[want]) + 4 * turn[b]) || a - b)
		const i = order.find((c) => fits(kind, s[c]))
		if (i == null) return null
		taken.push({ kind, at: s[i], i })
	}
	taken.sort((a, b) => a.at - b.at)
	const pads = [], boxes = []
	for (const q of taken) {
		const [dx, dz] = dirAt(P, q.i)
		const p = t.points[q.i]
		if (q.kind === 'pad') {
			pads.push({ x: p[0], y: p[1], z: p[2], yaw: r3(G.yawOf(dx, dz)) })
			continue
		}
		const a = P[(q.i - 1 + n) % n], b = P[(q.i + 1) % n]
		const tl = G.dist(a, b) || 1
		const nx = -(b[1] - a[1]) / tl, nz = (b[0] - a[0]) / tl
		const qm = half - 0.45
		const offs = perRow === 4 ? [-qm, -qm / 3, qm / 3, qm] : [-qm, 0, qm]
		for (const o of offs) boxes.push({ id: boxes.length, x: r3(p[0] + nx * o), y: r3(p[1] + BOX_LIFT), z: r3(p[2] + nz * o) })
	}
	return { pads, boxes }
}

/** Track with points / ramps / drops → + checkpoints, grid, pads, boxes (null when they do not fit). */
function decorate(t, scene) {
	void scene
	const ctx = context(t)
	const cp = checkpoints(ctx)
	if (cp.length < 3) return null
	const grid = startGrid(t)
	if (!grid) return null
	const it = items(t, ctx)
	if (!it) return null
	return { ...t, checkpoints: cp, grid, pads: it.pads, boxes: it.boxes }
}

module.exports = { decorate }
