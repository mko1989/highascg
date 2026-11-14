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
 */

const assert = require('node:assert/strict')
const Gr = require('../../../src/game/rc-ground')
const { createHeightField, fieldOf } = require('../../../src/game/rc-scene-height')
const { GRID_SLOTS, MIN_WIDTH, MIN_HALL_WIDTH, RADIUS_RAMP } = require('../../../src/game/rc-track-check')
const { START_CLEAR, BOX_LIFT, limitsFor } = require('../../../src/game/rc-track-check-deco')
const DK = require('../../../src/game/rc-track-check-deck')

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
	// gate's 1.3 m (game/rc/track-math.js GATE_ABOVE), or it has already landed (a gate on the ground)
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

module.exports = { measure, span, plan, furnishedHall }
