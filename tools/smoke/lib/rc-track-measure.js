'use strict'

/**
 * WO-1074 — the RC track rules re-measured from a track's points, independent of rc-track-check*.js (contract §2.1,
 * §2.7), plus the synthetic scenes the track smokes share. Used by smoke-wo1074-rc-server-tracks.test.js.
 *
 *   measure(t, scene, label) — ramps ≤ 18° and kinks ≤ 6°, level elsewhere, drops go down and land 3–8 m on (on the
 *     ground model at their own height), every point and the road across its width on the y-aware ground model, pads /
 *     boxes within the length's limits and off ramps / drops / the start line; §2.7: decks flat, ≥ 4 m wide, radius
 *     ≥ 6 m off floor level, the height field clear 0.6 m below and 1.0 m above them, plan overlaps ≥ 1.2 m apart in
 *     height, no checkpoint on or under a bridge nor where a car at the speed cap flies over it past a drop, and a
 *     room-long track's length / coverage / stage visit / straight grid.
 *   furnishedHall(opts) — a live-like 27 × 61 m hall with a stage and rows of 0.75 m tables, its height field built.
 *   §3 toy scale: measureToy(t, scene, label) — the toy rules from the grids' RLE (decoded here: decodeRle, occRule)
 *     plus every rule above in the unit frame (lengths ÷ scale, own wrappers); toyHall(opts) — furnishedHall at 0.1,
 *     built from triangles like the bake (opts.legs: legged tables a toy drives under). §3.1 tunnels: occRule carves
 *     the active track's corridors and holds tunnel segments to width/2; measureToy runs rc-tunnel-measure.js.
 */

const assert = require('node:assert/strict')
const Gr = require('../../../modules/rc-game/server/rc-ground')
const { createHeightField, fieldOf } = require('../../../modules/rc-game/server/rc-scene-height')
const { GRID_SLOTS, MIN_WIDTH, MIN_HALL_WIDTH, RADIUS_RAMP } = require('../../../modules/rc-game/server/rc-track-check')
const { START_CLEAR, BOX_LIFT, limitsFor } = require('../../../modules/rc-game/server/rc-track-check-deco')
const DK = require('../../../modules/rc-game/server/rc-track-check-deck')

const DEG = Math.PI / 180
const plan = (a, b) => Math.hypot(b[0] - a[0], b[2] - a[2])

/** Cyclic index range a → b (inclusive). */
function span(a, b, n) {
	const out = []
	for (let i = a; ; i = (i + 1) % n) {
		out.push(i)
		if (i === b) return out
	}
}

const circum = (a, b, c) => {
	const ab = plan(a, b), bc = plan(b, c), ca = plan(c, a)
	const cross = Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]))
	return cross < 1e-12 ? Infinity : (ab * bc * ca) / (2 * cross)
}

function measure(t, scene, label) {
	const P = t.points, n = P.length
	const tag = `${label} ${t.id}`
	assert.ok(P.every((p) => p.length === 3), `${tag}: [x, y, z] points`)
	assert.ok(DK.KINDS.includes(t.kind), `${tag}: kind ${t.kind}`)
	assert.ok(t.width >= MIN_WIDTH && (t.floor === 'room' || t.floor === 'stage' || t.width >= MIN_HALL_WIDTH), `${tag}: width ${t.width}`)
	const s = [0]
	for (let i = 1; i < n; i++) s.push(s[i - 1] + plan(P[i - 1], P[i]))
	const L = s[n - 1] + plan(P[n - 1], P[0])
	assert.ok(Math.abs(L - t.length) < 0.05, `${tag}: length`)
	const gy = (x, z, y, o) => Gr.ground(scene, t, x, z, y, o)
	const rampSeg = new Set(), rampIdx = new Set(), dropSeg = new Set(), flight = new Set()
	for (const r of t.ramps) {
		const idx = span(r.from, r.to, n)
		idx.forEach((i) => rampIdx.add(i))
		idx.slice(0, -1).forEach((i) => rampSeg.add(i))
	}
	const pitch = (i) => Math.atan2(P[(i + 1) % n][1] - P[i][1], plan(P[i], P[(i + 1) % n]))
	for (const r of t.ramps) {
		const idx = span(r.from, r.to, n)
		for (const i of idx.slice(0, -1)) assert.ok(Math.abs(pitch(i)) <= 18 * DEG + 1e-6, `${tag}: slope ${(pitch(i) / DEG).toFixed(1)}° at ${i}`)
		const segs = [(r.from - 1 + n) % n, ...idx.slice(0, -1)]
		if (!t.drops.some((d) => d.at === r.to)) segs.push(r.to)
		for (let j = 1; j < segs.length; j++) assert.ok(Math.abs(pitch(segs[j]) - pitch(segs[j - 1])) <= 6 * DEG + 1e-6, `${tag}: kink at ${segs[j]}`)
		const peak = Math.max(...idx.map((i) => P[i][1] - Gr.floorGround(scene, P[i][0], P[i][2])))
		assert.ok(peak >= 0.1, `${tag}: a ramp that rises`)
		// the feet: no step > 2 cm onto or off the ramp anywhere across the road (5 mm either side of the square-cut end)
		for (const [e, o] of [[r.from, (r.from + 1) % n], ...(t.drops.some((d) => d.at === r.to) ? [] : [[r.to, (r.to - 1 + n) % n]])]) {
			const ux = (P[o][0] - P[e][0]) / plan(P[e], P[o]), uz = (P[o][2] - P[e][2]) / plan(P[e], P[o])
			for (const f of [-0.48, -0.25, 0, 0.25, 0.48]) {
				const x = P[e][0] - uz * f * t.width, z = P[e][2] + ux * f * t.width
				const out = gy(x - ux * 0.005, z - uz * 0.005, P[e][1]), inn = gy(x + ux * 0.005, z + uz * 0.005, P[e][1])
				assert.ok(Math.abs(inn - out) <= 0.02, `${tag}: a ${(inn - out).toFixed(3)} m step at the foot ${e}`)
			}
		}
	}
	for (const d of t.drops) {
		const idx = span(d.at, d.land, n)
		idx.slice(0, -1).forEach((i) => dropSeg.add(i))
		idx.slice(1, -1).forEach((i) => flight.add(i))
		const D = (s[d.land] - s[d.at] + L) % L
		assert.ok(D >= 3 - 1e-6 && D <= 8 + 1e-6, `${tag}: drop lands ${D.toFixed(2)} m on`)
		assert.ok(P[d.land][1] <= P[d.at][1] - Gr.WALL_STEP, `${tag}: a drop goes down`)
		assert.ok(Math.abs(P[d.land][1] - gy(P[d.land][0], P[d.land][2], P[d.land][1])) <= Gr.GROUND_TOL, `${tag}: lands on the ground`)
		assert.ok(!rampIdx.has(d.land) || t.ramps.some((r) => r.from === d.land), `${tag}: lands off a ramp`)
		for (const i of span((d.at - 1 + n) % n, (d.land + 1) % n, n).slice(1, -1)) {
			const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n]
			const cross = (b[0] - a[0]) * (c[2] - b[2]) - (b[2] - a[2]) * (c[0] - b[0])
			assert.ok(Math.abs(cross) / (plan(a, b) * plan(b, c)) < 0.5 / RADIUS_RAMP, `${tag}: a drop runs straight`)
		}
	}
	for (let i = 0; i < n; i++) {
		if (!rampSeg.has(i) && !dropSeg.has(i)) assert.ok(Math.abs(P[(i + 1) % n][1] - P[i][1]) <= Gr.GROUND_TOL, `${tag}: level off the ramps at ${i}`)
		// the ground model at the point's own height: the point on it, the road level across its width
		const g = gy(P[i][0], P[i][2], P[i][1])
		assert.ok(g != null && Math.abs(g - P[i][1]) <= Gr.GROUND_TOL, `${tag}: point ${i} y ${P[i][1]} vs ground ${g}`)
		const a = P[(i - 1 + n) % n], b = P[(i + 1) % n], l = plan(a, b)
		const nx = -(b[2] - a[2]) / l, nz = (b[0] - a[0]) / l
		for (const o of [-0.45, 0.45]) {
			const gs = gy(P[i][0] + nx * o * t.width, P[i][2] + nz * o * t.width, P[i][1])
			assert.ok(gs != null && Math.abs(gs - P[i][1]) <= 0.08, `${tag}: road not level across at ${i}`)
		}
	}
	// pads / boxes: counts within the length's limits, flat road (not a ramp), off ramps / drops / the start line
	assert.equal(t.grid.length, GRID_SLOTS)
	const lim = limitsFor(L)
	assert.ok(t.pads.length >= lim.pads[0] && t.pads.length <= lim.pads[1], `${tag}: ${t.pads.length} pads`)
	assert.ok(lim.pads[1] <= 6 && lim.rows[1] <= 5, `${tag}: §2.7 caps`)
	assert.ok(t.boxes.length >= 3 * lim.rows[0] && t.boxes.length <= 4 * lim.rows[1], `${tag}: ${t.boxes.length} boxes`)
	const near = (x, y, z) => P.reduce((best, p, i) => (Math.hypot(p[0] - x, 3 * (p[1] - y), p[2] - z) < Math.hypot(P[best][0] - x, 3 * (P[best][1] - y), P[best][2] - z) ? i : best), 0)
	const busy = new Set([...rampSeg, ...dropSeg, ...rampIdx])
	for (const [kind, list, lift] of [['pad', t.pads, [0, 0]], ['box', t.boxes, BOX_LIFT]]) {
		for (const q of list) {
			const car = q.y - lift[1] - Gr.GROUND_TOL
			const i = near(q.x, car, q.z)
			const g = gy(q.x, q.z, car)
			assert.ok(Math.abs(g - gy(q.x, q.z, car, { ramps: false })) <= Gr.GROUND_TOL, `${tag}: ${kind} on a ramp`)
			assert.ok(q.y - g >= lift[0] - Gr.GROUND_TOL && q.y - g <= lift[1] + Gr.GROUND_TOL, `${tag}: ${kind} height`)
			assert.ok(Math.min(s[i], L - s[i]) >= START_CLEAR - 0.6, `${tag}: ${kind} ${s[i].toFixed(1)} m from the start line`)
			for (let k = -2; k <= 2; k++) assert.ok(!busy.has((i + k + n) % n), `${tag}: ${kind} on / at a ramp or a drop`)
		}
	}
	assert.equal(new Set(t.boxes.map((b) => b.id)).size, t.boxes.length)
	// every checkpoint counts for a car at the 24 m/s cap off a drop's lip (client gravity 20 m/s²): over it ≤ the
	// gate's 1.3 m (modules/rc-game/client/track-math.js GATE_ABOVE), or it has already landed (a gate on the ground)
	for (const d of t.drops) {
		for (const c of t.checkpoints) {
			const k = (c - d.at + n) % n
			const dist = (s[c] - s[d.at] + L) % L
			if (k === 0 || dist > 30) continue
			const over = P[d.at][1] - 10 * (dist / 24) ** 2 - P[c][1]
			assert.ok(over <= 1.3 && k >= (d.land - d.at + n) % n, `${tag}: checkpoint ${c} ${dist.toFixed(1)} m past a lip: a fast car flies ${over.toFixed(2)} m over it`)
		}
	}
	measureDecks(t, scene, tag, s, L)
}

/** §2.7 re-measured: decks, bridges, checkpoints off bridges, room-long rules. */
function measureDecks(t, scene, tag, s, L) {
	const P = t.points, n = P.length, half = t.width / 2
	const floors = scene.floors || []
	const field = fieldOf(scene)
	const deckPt = new Uint8Array(n)
	for (const d of t.decks || []) {
		assert.ok(t.width >= 4, `${tag}: a deck ≥ 4 m wide`)
		const idx = span(d.from, d.to, n)
		for (const i of idx) {
			deckPt[i] = 1
			assert.ok(Math.abs(P[i][1] - P[d.from][1]) <= Gr.GROUND_TOL, `${tag}: deck ${d.from}→${d.to} flat at ${i}`)
		}
		const level = floors.some((f) => Math.abs(f.y - P[d.from][1]) <= Gr.GROUND_TOL)
		for (const i of idx.slice(1, -1)) {
			if (!level) assert.ok(circum(P[(i - 1 + n) % n], P[i], P[(i + 1) % n]) >= 6 - 1e-3, `${tag}: deck radius at ${i}`)
			const g = Gr.floorGround(scene, P[i][0], P[i][2])
			assert.ok(level || P[i][1] - g >= 0.6, `${tag}: deck ≥ 0.6 m over the floor at ${i}`)
			if (field) assert.ok(!field.bandHit(P[i][0], P[i][2], half, Math.max(g + 0.05, P[i][1] - 0.6), P[i][1] + 1), `${tag}: the scene within 0.6 m below / 1 m above deck point ${i}`)
		}
	}
	// plan overlaps (well apart along the lap) are bridges: ≥ 1.2 m apart in height; no checkpoint on or under one
	const under = new Uint8Array(n)
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < n; j++) {
			if (Math.min(Math.abs(s[i] - s[j]), L - Math.abs(s[i] - s[j])) < 3 * t.width) continue
			const d = plan(P[i], P[j]), dy = Math.abs(P[i][1] - P[j][1])
			if (d < half) assert.ok(dy >= 1.2, `${tag}: ribbons ${i} / ${j} overlap ${dy.toFixed(2)} m apart`)
			if (d < t.width && dy >= 1.2) under[i] = 1
		}
	}
	for (const c of t.checkpoints) assert.ok(!under[c], `${tag}: checkpoint at ${c} on / under a bridge`)
	if (t.kind !== 'room-long') return
	const hall = floors.find((f) => f.id === 'hall'), st = floors.find((f) => f.id === 'stage')
	const w = hall.rect[2] - hall.rect[0], dd = hall.rect[3] - hall.rect[1]
	assert.ok(L >= Math.min(120, 2.2 * Math.max(w, dd)) - 1e-6, `${tag}: room-long ${L.toFixed(1)} m`)
	const xs = P.map((p) => p[0]), zs = P.map((p) => p[2])
	const ex = Math.max(...xs) - Math.min(...xs), ez = Math.max(...zs) - Math.min(...zs)
	const [eL, eS] = w >= dd ? [ex, ez] : [ez, ex]
	assert.ok(eL >= 0.7 * Math.max(w, dd) && eS >= 0.5 * Math.min(w, dd), `${tag}: covers ${eL.toFixed(1)} × ${eS.toFixed(1)} m`)
	if (st) assert.ok(P.some((p) => Math.abs(p[1] - st.y) <= Gr.GROUND_TOL && Gr.floorGround(scene, p[0], p[2]) === st.y), `${tag}: visits the stage`)
	assert.equal(DK.GRID_STRAIGHT, 14, 'the validator checks the contract\'s 14 m straight')
	let back = 0
	for (let i = n - 1; back < 14; i--) {
		back += plan(P[i], P[(i + 1) % n])
		const h0 = Math.atan2(P[0][2] - P[n - 1][2], P[0][0] - P[n - 1][0]), h = Math.atan2(P[(i + 1) % n][2] - P[i][2], P[(i + 1) % n][0] - P[i][0])
		assert.ok(Math.abs(Math.atan2(Math.sin(h - h0), Math.cos(h - h0))) <= 3 * DEG && P[i][1] === P[0][1], `${tag}: the grid's 14 m straight at ${i}`)
	}
}

/**
 * A live-like furnished hall: 27 × 61 m hall (y 0), a 0.58 m stage across its front with clutter at its back, rows of
 * 1.6 m tables 0.75 m high from z 12 on; opts.truss: a truss band at that height over the whole hall; opts.ceiling:
 * { y, z0 } a ceiling at y over z ≥ z0. → { floors, obstacles, bounds, field, heights }.
 */
function furnishedHall(opts = {}) {
	const hall = { id: 'hall', y: 0, rect: [-12.6, -11.9, 14.4, 49.6] }
	const stage = { id: 'stage', y: 0.58, rect: [-7.3, -9.1, 10.7, 0.86] }
	const obstacles = []
	for (let x = -9.5; x <= 12; x += 3.2) for (let z = 13; z <= 47; z += 3.2) obstacles.push({ min: [x - 0.8, 0, z - 0.8], max: [x + 0.8, 0.75, z + 0.8] })
	for (let x = -6.5; x <= 9.5; x += 2.5) obstacles.push({ min: [x - 0.5, 0.58, -8.8], max: [x + 0.5, 2.2, -6.5] }) // backline
	const field = createHeightField(hall.rect, hall.y)
	const tall = []
	if (opts.truss) tall.push({ min: [hall.rect[0], opts.truss, hall.rect[1]], max: [hall.rect[2], opts.truss + 0.4, hall.rect[3]] })
	if (opts.ceiling) tall.push({ min: [hall.rect[0], opts.ceiling.y, opts.ceiling.z0], max: [hall.rect[2], opts.ceiling.y + 0.3, hall.rect[3]] })
	for (const o of [...obstacles, ...tall]) field.box(o.min, o.max)
	field.clearBelow(stage.rect, stage.y)
	return { floors: [hall, stage], obstacles, bounds: { min: [-12.6, 0, -11.9], max: [14.4, 8, 49.6] }, field, heights: field.toJSON() }
}

// ---- §3 toy scale --------------------------------------------------------------------------------------------------

/** A grid's RLE (free, blocked, free … from the first cell) → Uint8Array (1 = blocked); throws on a bad sum. */
function decodeRle(g) {
	const bits = new Uint8Array(g.w * g.h)
	let at = 0
	g.rle.forEach((len, k) => {
		assert.ok(Number.isInteger(len) && len >= 0, `rle run ${k}`)
		if (k % 2) bits.fill(1, at, at + len)
		at += len
	})
	assert.equal(at, g.w * g.h, `${g.floor}: the RLE covers w × h`)
	return bits
}

/** Exact plan distance between segment a→b and the square [sx, sx + c] × [sz, sz + c]. */
function segSquareDist(a, b, sx, sz, c) {
	const inSq = (p) => p[0] >= sx && p[0] <= sx + c && p[1] >= sz && p[1] <= sz + c
	if (inSq(a) || inSq(b)) return 0
	const C = [[sx, sz], [sx + c, sz], [sx + c, sz + c], [sx, sz + c]]
	const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
	for (let k = 0; k < 4; k++) {
		const p = C[k], q = C[(k + 1) % 4]
		if (o(a, b, p) * o(a, b, q) <= 0 && o(p, q, a) * o(p, q, b) <= 0) return 0
	}
	const ps = (p, u, v) => {
		const dx = v[0] - u[0], dz = v[1] - u[1], l2 = dx * dx + dz * dz
		const t = l2 ? Math.max(0, Math.min(1, ((p[0] - u[0]) * dx + (p[1] - u[1]) * dz) / l2)) : 0
		return Math.hypot(p[0] - u[0] - t * dx, p[1] - u[1] - t * dz)
	}
	let d = Infinity
	for (const p of C) d = Math.min(d, ps(p, a, b))
	for (const p of [a, b]) for (let k = 0; k < 4; k++) d = Math.min(d, ps(p, C[k], C[(k + 1) % 4]))
	return d
}

/**
 * Contract §3 "Obstacles at toy height", measured from the RLE: every road segment in a floor's car band (an end at
 * floor.y − 0.02·s … + 0.5·s, its middle over the floor) keeps its centre line ≥ width/2 + 1 cell from every
 * blocked cell of that floor; a deck has no blocked cell within width/2 under it. → the smallest margin seen (m).
 */
function occRule(t, scene, tag) {
	const s = scene.scale, P = t.points, n = P.length, half = t.width / 2
	const deck = new Uint8Array(n), tube = new Uint8Array(n)
	for (const d of t.decks || []) for (const i of span(d.from, d.to, n).slice(0, -1)) deck[i] = 1
	for (const q of t.tunnels || []) tube.fill(1, q.from, q.to) // §3.1: inside, the ribbon itself keeps clear
	const carves = t.tunnels?.length ? require('./rc-tunnel-measure').tunnelCarves(t, scene) : new Map()
	let margin = Infinity
	for (const g of scene.occ) {
		const f = scene.floors.find((q) => q.id === g.floor)
		assert.ok(f && Math.abs(f.y - g.y) < 1e-9, `${tag}: grid ${g.floor} on its floor`)
		const bits = decodeRle(g)
		for (const c of carves.get(g.floor) || []) bits[c] = 0
		const band = (y) => y >= f.y - 0.02 * s - 1e-9 && y <= f.y + 0.5 * s + 1e-9
		const inside = (p) => p[0] >= f.rect[0] && p[0] <= f.rect[2] && p[2] >= f.rect[1] && p[2] <= f.rect[3]
		for (let i = 0; i < n; i++) {
			const p = P[i], q = P[(i + 1) % n]
			const onBand = (band(p[1]) || band(q[1])) && inside([(p[0] + q[0]) / 2, 0, (p[2] + q[2]) / 2])
			const over = deck[i] && Gr.floorGround(scene, (p[0] + q[0]) / 2, (p[2] + q[2]) / 2) === f.y
			if (!onBand && !over) continue
			const r = onBand && !tube[i] ? half + g.cell : half
			const a = [p[0], p[2]], b = [q[0], q[2]]
			const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - r - g.x0) / g.cell)), i1 = Math.min(g.w - 1, Math.floor((Math.max(a[0], b[0]) + r - g.x0) / g.cell))
			const k0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - r - g.z0) / g.cell)), k1 = Math.min(g.h - 1, Math.floor((Math.max(a[1], b[1]) + r - g.z0) / g.cell))
			for (let k = k0; k <= k1; k++) {
				for (let c = i0; c <= i1; c++) {
					if (!bits[k * g.w + c]) continue
					const d = segSquareDist(a, b, g.x0 + c * g.cell, g.z0 + k * g.cell, g.cell)
					assert.ok(d >= r - 1e-9, `${tag}: segment ${i} ${d.toFixed(4)} m from a blocked cell of the ${g.floor} (needs ${r.toFixed(3)})`)
					margin = Math.min(margin, d - r)
				}
			}
		}
	}
	return margin
}

/** A unit-frame copy (every length ÷ s) of a world scene, its height field queried through a wrapper of its own. */
function unitScene(scene, s) {
	const d = (v) => v / s
	const F = fieldOf(scene)
	const field = F && {
		bandHit: (x, z, h, lo, hi) => F.bandHit(x * s, z * s, h * s, lo * s, hi * s),
		topBelow: (x, z, y) => F.topBelow(x * s, z * s, y * s) / s,
		bottomAbove: (x, z, y) => F.bottomAbove(x * s, z * s, y * s) / s,
	}
	return { floors: scene.floors.map((f) => ({ ...f, y: d(f.y), rect: f.rect.map(d) })), obstacles: (scene.obstacles || []).map((o) => ({ min: o.min.map(d), max: o.max.map(d) })),
		bounds: scene.bounds && { min: scene.bounds.min.map(d), max: scene.bounds.max.map(d) }, field }
}

const unitTrack = (t, s) => {
	const xyz = (o) => ({ ...o, x: o.x / s, y: o.y / s, z: o.z / s })
	return { ...t, points: t.points.map((p) => p.map((v) => v / s)), width: t.width / s, length: t.length / s, grid: t.grid.map(xyz), pads: t.pads.map(xyz), boxes: t.boxes.map(xyz) }
}

/** §3: a toy track re-measured — its own toy rules in metres, then every v2 / §2.7 rule in the unit frame. → margin (m). */
function measureToy(t, scene, label) {
	const s = scene.scale, tag = `${label} ${t.id}`
	assert.ok(s > 0 && s < 1, `${tag}: a toy scene`)
	assert.ok(t.width >= 0.3 - 1e-9 && t.width <= 0.45 + 1e-9, `${tag}: width ${t.width} m (0.30–0.45)`)
	assert.ok(t.points.length >= 60 && t.points.length <= 2500, `${tag}: ${t.points.length} points`)
	assert.ok(Number.isInteger(t.laps) && t.laps >= 1 && t.laps <= 20, `${tag}: laps ${t.laps}`)
	for (let i = 0; i < t.points.length; i++) assert.ok(plan(t.points[i], t.points[(i + 1) % t.points.length]) <= 0.5 * t.width + 1e-9, `${tag}: spacing at ${i}`)
	const margin = occRule(t, scene, tag)
	if (t.tunnels) require('./rc-tunnel-measure').measureTunnels(t, scene, tag)
	measure(unitTrack(t, s), unitScene(scene, s), label)
	return margin
}

/** The 12 triangles of a box → cb(x0, y0, z0, x1, … z2) per triangle. */
function boxTris(min, max, cb) {
	const [x0, y0, z0] = min, [x1, y1, z1] = max
	const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]
	const F = [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1], [3, 2, 6], [3, 6, 7], [0, 3, 7], [0, 7, 4], [1, 5, 6], [1, 6, 2]]
	for (const [a, b, c] of F) cb(...v[a], ...v[b], ...v[c])
}

/**
 * furnishedHall at toy scale 0.1, built as the bake builds it (triangles → occupancy grids per floor + the toy height
 * field): opts.legs — the tables are a 3 cm top at 0.72 m on four 5 cm legs (a toy drives under them), else solid
 * blocks to the floor (tablecloths). → { scale, floors, obstacles: [], bounds, field, occ (live grids), tables }.
 */
function toyHall(opts = {}) {
	const { createOcc } = require('../../../modules/rc-game/server/rc-scene-occ')
	const s = 0.1
	const hall = { id: 'hall', y: 0, rect: [-12.6, -11.9, 14.4, 49.6] }
	const stage = { id: 'stage', y: 0.58, rect: [-7.3, -9.1, 10.7, 0.86] }
	const boxes = [], tables = []
	for (let x = -9.5; x <= 12; x += 3.2) {
		for (let z = 13; z <= 47; z += 3.2) {
			tables.push([x - 0.8, z - 0.8, x + 0.8, z + 0.8])
			if (!opts.legs) boxes.push({ min: [x - 0.8, 0, z - 0.8], max: [x + 0.8, 0.75, z + 0.8] })
			else {
				boxes.push({ min: [x - 0.8, 0.72, z - 0.8], max: [x + 0.8, 0.75, z + 0.8] })
				for (const dx of [-0.75, 0.7]) for (const dz of [-0.75, 0.7]) boxes.push({ min: [x + dx, 0, z + dz], max: [x + dx + 0.05, 0.72, z + dz + 0.05] })
			}
		}
	}
	for (let x = -6.5; x <= 9.5; x += 2.5) boxes.push({ min: [x - 0.5, 0.58, -8.8], max: [x + 0.5, 2.2, -6.5] }) // backline
	boxes.push({ min: [-12.6, 0, 49.4], max: [14.4, 3, 49.6] }) // the far wall
	const field = createHeightField(hall.rect, hall.y, { cell: 0.5 * s, bin: 0.25 * s, eps: 0.05 * s, deflate: true })
	const occ = [hall, stage].map((f) => createOcc(f, { cell: 0.3 * s, lo: 0.05 * s, hi: 0.6 * s }))
	for (const b of boxes) boxTris(b.min, b.max, (...v) => {
		for (const g of occ) g.tri(...v)
		field.tri(...v)
	})
	occ[0].clear(stage.rect, 0.02)
	field.clearBelow(stage.rect, stage.y)
	return { scale: s, floors: [hall, stage], obstacles: [], bounds: { min: [-12.6, 0, -11.9], max: [14.4, 3.6, 49.6] }, field, occ, tables }
}

module.exports = { measure, span, plan, furnishedHall, measureToy, occRule, decodeRle, segSquareDist, toyHall, boxTris }
