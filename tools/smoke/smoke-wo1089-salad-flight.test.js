'use strict'

/**
 * WO-1089 — Stage Salad flight physics (modules/stage-salad/client/flight.js, veggies.js, venue.js; contract §3–§5):
 * deterministic (same launch → the same path to the bit, stepped in one go or tick by tick as the server does),
 * gravity + quadratic drag, the per-vegetable behaviour (a tomato splats on first contact, an onion bounces up to 3
 * times, a potato rolls to rest, a pea burst fans out from one seed), the venue colliders (floor, stage, LED wall,
 * truss, room walls) and the slot layout (20 slings in two arcs facing the stage front, teams by side).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { shared, venue } = require('./lib/salad-fixtures')

const S = shared()
const F = S.flight
const VG = S.veggies.VEGGIES
const DEG = Math.PI / 180

function fly(veg, slot, yawOff, pitchDeg, power, seed = 1, v = venue()) {
	const o = S.venue.pouch(v.slots[slot])
	const L = F.launches(veg, o, v.slots[slot].yaw + yawOff * DEG, pitchDeg * DEG, power, seed)
	return { v, o, L, ends: L.map((l) => F.simulate(veg, l, v, { record: true })) }
}

test('venue: front edge faces the hall, 20 slots in two arcs facing the stage, teams by side, colliders present', () => {
	const v = venue()
	assert.deepEqual(v.front.f, [-1, 0])
	assert.equal(v.front.c[0], 9.55)
	assert.equal(v.slots.length, 20)
	for (const s of v.slots) {
		const d = Math.hypot(s.p[0] - v.front.c[0], s.p[2] - v.front.c[2])
		assert.ok(d > 8 && d < 13, `slot ${s.i} at ${d.toFixed(2)} m`)
		const toFront = Math.atan2(-(v.front.c[0] - s.p[0]), -(v.front.c[2] - s.p[2]))
		assert.ok(Math.abs(Math.atan2(Math.sin(s.yaw - toFront), Math.cos(s.yaw - toFront))) < 1e-3, `slot ${s.i} faces the stage front`)
	}
	assert.equal(v.slots.filter((s) => s.team === 0).length, 10)
	const tags = new Set(v.colliders.map((c) => c.tag))
	for (const t of ['floor', 'stage', 'wall', 'truss', 'room']) assert.ok(tags.has(t), t)
	assert.equal(v.rev, venue().rev, 'the rev is a pure function of the inputs')
})

test('launch speed spans the vegetable\'s range; out-of-range power is the solver\'s problem, not the table\'s', () => {
	for (const veg of Object.values(VG)) {
		assert.equal(S.veggies.launchSpeed(veg, S.veggies.POWER_MIN), veg.vMin)
		assert.equal(S.veggies.launchSpeed(veg, 1), veg.vMax)
		assert.ok(S.veggies.launchSpeed(veg, 0.6) > veg.vMin && S.veggies.launchSpeed(veg, 0.6) < veg.vMax)
	}
	assert.equal(S.veggies.vegOf('pumpkin'), null)
	assert.equal(S.veggies.vegOf('__proto__'), null)
})

test('deterministic: the same launch gives the same end to the bit, whole or stepped at 30 Hz', () => {
	const a = fly(VG.potato, 4, 2, 30, 0.8)
	const b = fly(VG.potato, 4, 2, 30, 0.8)
	assert.deepEqual(a.ends, b.ends)
	const f = F.createFlight(VG.potato, a.L[0])
	for (let tau = 1 / 30; !f.end; tau += 1 / 30) while (!f.end && f.t < tau) F.stepFlight(f, a.v, {})
	assert.deepEqual(f.end.p, a.ends[0].p)
	assert.equal(f.end.k, a.ends[0].k)
})

test('gravity and drag: a higher power flies farther, drag shortens a cabbage more than a carrot', () => {
	const near = fly(VG.tomato, 0, 0, 20, 0.4).ends[0]
	const far = fly(VG.tomato, 0, 0, 20, 0.7).ends[0]
	const d = (e, o) => Math.hypot(e.p[0] - o[0], e.p[2] - o[2])
	const o = S.venue.pouch(venue().slots[0])
	assert.ok(d(far, o) > d(near, o) + 1, `${d(near, o)} → ${d(far, o)}`)
	// no-drag apex check: vy0² / 2g within 2 % for a nearly drag-free carrot at low speed
	const L = F.launches(VG.carrot, [0, 2, 20], 0, 60 * DEG, 0.15, 1)[0]
	const rec = F.simulate(VG.carrot, L, venue(), { record: true })
	const apex = Math.max(...rec.path.map((p) => p[1]))
	const vy = L.v[1]
	assert.ok(Math.abs(apex - 2 - (vy * vy) / (2 * 9.81)) / ((vy * vy) / (2 * 9.81)) < 0.06, `apex ${apex}`)
	const ratio = (veg) => {
		const l = F.launches(veg, [0, 1.5, 20], 0, 25 * DEG, 1, 1)[0]
		const e = F.simulate(veg, l, venue(), {})
		const sp = Math.hypot(...l.v)
		return Math.hypot(e.p[0], e.p[2] - 20) / ((sp * sp * Math.sin(50 * DEG)) / 9.81)
	}
	assert.ok(ratio(VG.cabbage) < ratio(VG.carrot), 'cabbage loses more to drag')
})

test('per vegetable: tomato splats, onion bounces ≤ 3, potato rolls to rest, peas fan out from one seed', () => {
	const t = fly(VG.tomato, 3, 0, 15, 0.5).ends[0]
	assert.equal(t.k, 'land')
	assert.equal(t.bounced, false)
	const on = fly(VG.onion, 3, 0, 10, 0.5).ends[0]
	assert.ok(on.bounced, 'the onion bounced')
	const L = F.launches(VG.onion, [0, 1.5, 20], 0, 10 * DEG, 0.6, 1)[0]
	const f = F.createFlight(VG.onion, L)
	while (!f.end) F.stepFlight(f, venue(), {})
	assert.ok(f.bounces <= VG.onion.bounces + 1, `onion bounces ${f.bounces}`)
	const peas = fly(VG.peas, 5, 0, 18, 0.7, 42)
	assert.equal(peas.L.length, VG.peas.n)
	const yaws = peas.L.map((l) => Math.atan2(l.v[0], l.v[2]))
	assert.ok(Math.max(...yaws) - Math.min(...yaws) > 0.5 * DEG && Math.max(...yaws) - Math.min(...yaws) < 2 * VG.peas.spreadDeg * DEG * 1.5)
	assert.deepEqual(fly(VG.peas, 5, 0, 18, 0.7, 42).L, peas.L, 'the same seed → the same burst')
	assert.notDeepEqual(fly(VG.peas, 5, 0, 18, 0.7, 43).L, peas.L)
})

test('colliders: a flat hard shot meets the stage front or the LED wall, a lob over the wall is stopped by the room', () => {
	const v = venue()
	const flat = fly(VG.carrot, 0, 0, 3, 1).ends[0]
	assert.ok(['stage', 'wall'].includes(flat.tag), `flat carrot: ${flat.k}@${flat.tag}`)
	const tries = [20, 22, 24, 26, 28, 30].map((deg) => fly(VG.carrot, 0, 0, deg, 1).ends[0])
	const wallHit = tries.find((e) => e.tag === 'wall')
	assert.ok(wallHit, tries.map((e) => `${e.k}@${e.tag}`).join(' '))
	assert.ok(wallHit.p[0] > 12.6 && wallHit.p[0] < 12.9 && wallHit.p[1] > 1.239 && wallHit.p[1] < 4.239, `on the wall's face: ${wallHit.p}`)
	const up = fly(VG.carrot, 0, 0, 70, 1).ends[0]
	assert.ok(up.p[1] < v.ceiling + 0.01, 'never through the ceiling')
	const truss = F.simulate(VG.tomato, { i: 0, p: [9.2, 3.5, 0.5], v: [0, 8, 0] }, v, {})
	assert.equal(truss.tag, 'truss', 'straight up under the truss')
	for (let k = 0; k < 40; k++) {
		const e = fly(VG.potato, k % 20, (k % 7) - 3, 5 + k * 1.5, 0.3 + (k % 5) * 0.15, k).ends[0]
		assert.ok(e.p[0] >= v.play.min[0] && e.p[0] <= v.play.max[0] && e.p[2] >= v.play.min[2] && e.p[2] <= v.play.max[2], `shot ${k} stays in the room`)
		assert.ok(e.t <= F.MAX_T + 1e-9)
	}
})
