'use strict'

/**
 * WO-1074 §3.1 — tunnels through tables re-measured from a world track's points and the grids' RLE, independent of
 * rc-track-check-tunnel.js / rc-toy-blobs.js (own carve, own blob flood, own geometry). Used by measureToy
 * (rc-track-measure.js) for every toy track that has `tunnels`.
 *   carveSet(g, line, r) — the cells whose centres lie within r of the plan polyline (Set of cell indices);
 *   tunnelCarves(t, scene) — Map(grid floor → Set) of the active track's carve on each grid;
 *   measureTunnels(t, scene, tag) — every §3.1 rule → [{ from, to, len (m), blobs: [bbox centre] }].
 */

const assert = require('node:assert/strict')
const { fieldOf } = require('../../../src/game/rc-scene-height')
const { decodeRle, segSquareDist } = require('./rc-track-measure')

const plan = (a, b) => Math.hypot(b[0] - a[0], b[2] - a[2])
const circum = (a, b, c) => {
	const A = plan(b, c), B = plan(a, c), C = plan(a, b)
	const cr = Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]))
	return cr < 1e-12 ? Infinity : (A * B * C) / (2 * cr)
}
const pointSeg = (p, a, b) => {
	const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz
	const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2)) : 0
	return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz)
}
const segSeg = (a, b, c, d) => {
	const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
	if (o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0) return 0
	return Math.min(pointSeg(a, c, d), pointSeg(b, c, d), pointSeg(c, a, b), pointSeg(d, a, b))
}

function carveSet(g, line, r) {
	const out = new Set()
	for (let k = 0; k < g.h; k++) {
		const z = g.z0 + (k + 0.5) * g.cell
		for (let i = 0; i < g.w; i++) {
			const x = g.x0 + (i + 0.5) * g.cell
			for (let j = 0; j + 1 < line.length; j++) {
				if (pointSeg([x, z], line[j], line[j + 1]) <= r) {
					out.add(k * g.w + i)
					break
				}
			}
		}
	}
	return out
}

/** The tunnel's grid: the one whose height is within 0.02 · scale of its first point. */
const gridOf = (scene, y) => scene.occ.find((g) => Math.abs(g.y - y) <= 0.02 * scene.scale + 1e-9)

/** Bounding-box carve (fast path of carveSet: only rows / columns the line's box + r covers). */
function carveFast(g, line, r) {
	const xs = line.map((p) => p[0]), zs = line.map((p) => p[1])
	const i0 = Math.max(0, Math.floor((Math.min(...xs) - r - g.x0) / g.cell)), i1 = Math.min(g.w - 1, Math.floor((Math.max(...xs) + r - g.x0) / g.cell))
	const k0 = Math.max(0, Math.floor((Math.min(...zs) - r - g.z0) / g.cell)), k1 = Math.min(g.h - 1, Math.floor((Math.max(...zs) + r - g.z0) / g.cell))
	const sub = { x0: g.x0 + i0 * g.cell, z0: g.z0 + k0 * g.cell, cell: g.cell, w: i1 - i0 + 1, h: k1 - k0 + 1 }
	const out = new Set()
	for (const q of carveSet(sub, line, r)) out.add((k0 + Math.floor(q / sub.w)) * g.w + i0 + (q % sub.w))
	return out
}

function tunnelCarves(t, scene) {
	const out = new Map()
	for (const q of t.tunnels || []) {
		const g = gridOf(scene, t.points[q.from][1])
		if (!g) continue
		const line = t.points.slice(q.from, q.to + 1).map((p) => [p[0], p[2]])
		if (!out.has(g.floor)) out.set(g.floor, new Set())
		for (const c of carveFast(g, line, t.width / 2 + g.cell)) out.get(g.floor).add(c)
	}
	return out
}

/** The 8-connected blocked component holding cell q0 → its cell bbox [i0, k0, i1, k1] and the cells (Set). */
function flood(g, bits, q0) {
	const cells = new Set([q0])
	const st = [q0]
	const b = [Infinity, Infinity, -1, -1]
	while (st.length) {
		const q = st.pop()
		const i = q % g.w, k = (q - i) / g.w
		b[0] = Math.min(b[0], i), b[1] = Math.min(b[1], k), b[2] = Math.max(b[2], i), b[3] = Math.max(b[3], k)
		for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) {
			const ii = i + di, kk = k + dk, p = kk * g.w + ii
			if (ii >= 0 && kk >= 0 && ii < g.w && kk < g.h && bits[p] && !cells.has(p)) cells.add(p), st.push(p)
		}
	}
	return { box: b, cells }
}

/** §3.1 "table-like": compact 0.8–3.5 m, off the grid edge, ≥ 0.1 m off a higher floor, roofed ≥ 0.3 m (half its middle). */
function blobOk(g, scene, F, box, tag) {
	const r = [g.x0 + box[0] * g.cell, g.z0 + box[1] * g.cell, g.x0 + (box[2] + 1) * g.cell, g.z0 + (box[3] + 1) * g.cell]
	const sx = r[2] - r[0], sz = r[3] - r[1]
	assert.ok(sx >= 0.8 - 1e-9 && sz >= 0.8 - 1e-9 && sx <= 3.5 + 1e-9 && sz <= 3.5 + 1e-9, `${tag}: blob ${sx.toFixed(2)} × ${sz.toFixed(2)} m (0.8–3.5)`)
	assert.ok(box[0] > 0 && box[1] > 0 && box[2] < g.w - 1 && box[3] < g.h - 1, `${tag}: the blob touches the hall's edge`)
	for (const f of scene.floors.filter((q) => q.y > g.y + 0.05)) {
		const hit = r[0] < f.rect[2] + 0.1 && r[2] > f.rect[0] - 0.1 && r[1] < f.rect[3] + 0.1 && r[3] > f.rect[1] - 0.1
		assert.ok(!hit, `${tag}: the blob is the ${f.id} side`)
	}
	assert.ok(F, `${tag}: a roof needs the height field`)
	const mx = sx / 4, mz = sz / 4
	let n = 0, roof = 0
	for (let z = r[1] + mz + F.cell / 2; z <= r[3] - mz; z += F.cell) for (let x = r[0] + mx + F.cell / 2; x <= r[2] - mx; x += F.cell) {
		n++
		if (Number.isFinite(F.bottomAbove(x, z, g.y + 0.3))) roof++
	}
	assert.ok(n && roof / n >= 0.5, `${tag}: the blob has no roof ≥ 0.3 m (${roof}/${n})`)
	return [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2]
}

function measureTunnels(t, scene, tag) {
	const list = t.tunnels || []
	const P = t.points, n = P.length, w = t.width, half = w / 2, s = scene.scale
	assert.ok(Array.isArray(list) && list.length <= 3, `${tag}: at most 3 tunnels`)
	const S = [0]
	for (let i = 1; i <= n; i++) S.push(S[i - 1] + plan(P[i - 1], P[i % n]))
	const L = S[n]
	const fwd = (a, b) => (b - a + L) % L
	const F = fieldOf(scene)
	const busyPt = new Uint8Array(n)
	for (const r of [...(t.ramps || []), ...(t.decks || [])]) for (let i = r.from; i !== (r.to + 1) % n; i = (i + 1) % n) busyPt[i] = 1
	for (const d of t.drops || []) busyPt[d.at] = busyPt[(d.at + 1) % n] = 1
	const out = []
	let last = -1
	for (const [k, q] of list.entries()) {
		const tg = `${tag} tunnel ${k}`
		assert.ok(Number.isInteger(q.from) && Number.isInteger(q.to) && q.from > last && q.from < q.to && q.to < n, `${tg}: range ${q.from}–${q.to}`)
		last = q.to
		const g = gridOf(scene, P[q.from][1])
		assert.ok(g, `${tg}: on a grid's floor`)
		const f = scene.floors.find((x) => x.id === g.floor)
		const len = S[q.to] - S[q.from]
		assert.ok(len >= 0.6 - 1e-6 && len <= 4 + 1e-6, `${tg}: ${len.toFixed(3)} m long (0.6–4)`)
		// what it cuts: blocked cells of table-like blobs only
		const bits = decodeRle(g)
		const line = P.slice(q.from, q.to + 1).map((p) => [p[0], p[2]])
		const cut = [...carveFast(g, line, half + g.cell)].filter((c) => bits[c])
		assert.ok(cut.length > 0, `${tg}: cuts no blocked cell`)
		const blobs = [], seen = new Set()
		for (const c of cut) {
			if (seen.has(c)) continue
			const b = flood(g, bits, c)
			for (const x of b.cells) seen.add(x)
			blobs.push(blobOk(g, scene, F, b.box, tg))
		}
		// level, no ramp / deck / drop inside or within 2 widths of a portal; radius inside ≥ 2 × the floor's minimum
		const win = (m) => (i) => fwd((S[q.from] - m * w + L) % L, S[i]) <= len + 2 * m * w + 1e-9
		const in2 = win(2)
		for (let i = 0; i < n; i++) {
			if (!in2(i)) continue
			assert.ok(!busyPt[i], `${tg}: a ramp, deck or drop within 2 widths at ${i}`)
			assert.ok(Math.abs(P[i][1] - f.y) <= 0.02 * s + 1e-9, `${tg}: not level at ${i}`)
		}
		const rMin = 2 * (f.id === 'stage' ? 1.8 : 3) * s
		for (let i = q.from; i <= q.to; i++) for (const m of [1, 2]) assert.ok(circum(P[(i - m + n) % n], P[i], P[(i + m) % n]) >= rMin - 1e-6, `${tg}: radius < ${rMin} m at ${i}`)
		// both portals open onto 2 widths of straight, free in the uncarved grid
		for (const [dir, i0] of [[-1, q.from], [1, q.to]]) {
			for (let i = (i0 + dir + n) % n; fwd(...(dir < 0 ? [S[i], S[i0]] : [S[i0], S[i]])) <= 2 * w + 1e-9; i = (i + dir + n) % n) {
				assert.ok(i < q.from || i > q.to, `${tg}: portal stretch wraps into the tunnel`)
				assert.ok(!list.some((o) => i >= o.from && i <= o.to), `${tg}: a portal runs into another tunnel at ${i}`)
				assert.ok(circum(P[(i - 1 + n) % n], P[i], P[(i + 1) % n]) >= 8 * s - 1e-6, `${tg}: the portal stretch bends at ${i}`)
				const j = (i - dir + n) % n, r = half + g.cell
				const a = [P[i][0], P[i][2]], b = [P[j][0], P[j][2]]
				const kz = (v) => Math.floor((v - g.z0) / g.cell), ix = (v) => Math.floor((v - g.x0) / g.cell)
				for (let kk = Math.max(0, kz(Math.min(a[1], b[1]) - r) - 1); kk <= Math.min(g.h - 1, kz(Math.max(a[1], b[1]) + r) + 1); kk++) {
					for (let ii = Math.max(0, ix(Math.min(a[0], b[0]) - r) - 1); ii <= Math.min(g.w - 1, ix(Math.max(a[0], b[0]) + r) + 1); ii++) {
						if (!bits[kk * g.w + ii]) continue
						const d = segSquareDist(a, b, g.x0 + ii * g.cell, g.z0 + kk * g.cell, g.cell)
						assert.ok(d >= r - 1e-9, `${tg}: the portal at ${i} is not on free floor (${d.toFixed(4)} m)`)
					}
				}
			}
		}
		// no start line, checkpoint, grid slot, pad or box inside or within a width of a portal
		const in1 = (at) => fwd((S[q.from] - w + L) % L, at) <= len + 2 * w + 1e-9
		const nearAt = (o) => S[P.reduce((b, p, i) => (Math.hypot(p[0] - o.x, p[2] - o.z) < Math.hypot(P[b][0] - o.x, P[b][2] - o.z) ? i : b), 0)]
		assert.ok(!in1(0), `${tg}: the start line is inside or by a portal`)
		for (const c of t.checkpoints || []) assert.ok(!in1(S[c]), `${tg}: checkpoint ${c} inside or by a portal`)
		for (const [kind, os] of [['grid slot', t.grid], ['pad', t.pads], ['box', t.boxes]]) for (const o of os || []) assert.ok(!in1(nearAt(o)), `${tg}: a ${kind} inside or by a portal`)
		// never crosses / runs beside another part of the track
		const far = (i) => !in2(i) && !in2((i + 1) % n)
		for (let i = q.from; i < q.to; i++) for (let j = 0; j < n; j++) {
			if (!far(j)) continue
			const d = segSeg([P[i][0], P[i][2]], [P[i + 1][0], P[i + 1][2]], [P[j][0], P[j][2]], [P[(j + 1) % n][0], P[(j + 1) % n][2]])
			assert.ok(d >= 2 * (half + g.cell) - 1e-9, `${tg}: segment ${j} passes ${d.toFixed(3)} m from the tunnel`)
		}
		out.push({ from: q.from, to: q.to, len, blobs })
	}
	return out
}

module.exports = { carveSet, carveFast, tunnelCarves, measureTunnels }
