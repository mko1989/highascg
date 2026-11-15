'use strict'

/**
 * WO-1089 Stage Salad — the client's projectile book (modules/stage-salad/client/shots.js; contract
 * work/notes/stage-salad-contract.md §5 / §9 / §11):
 *  - the own release is drawn at once (seed 0) and reconciled with the server's `shot` echo: same launch → the
 *    prediction is kept; a different launch (rounding, a pea burst's seed) → the flight is replaced and caught up;
 *    a duplicate echo changes nothing; no echo → the shot fades after ORPHAN_MS (refused) without an event;
 *  - an `end` finishes its projectile at the server's `at` (one event with pts / part / streak / bank), a splatting
 *    vegetable leaves a ground mark (none on an umbrella), a hard one lies at rest then goes;
 *  - an `end` that arrives before its `shot` waits as a loose end and is attached; one for a projectile we never had
 *    becomes a vegetable-less event at `at`;
 *  - hold-at-contact: a flight touching a drawn avatar waits ≤ HOLD_MS for the verdict, then flies on (no second hold);
 *  - caps: ≤ MAX_LIVE projectiles (resting ones evicted first), ≤ MAX_MARKS marks fading over MARK_MS; clear() on a
 *    phase change drops flights and loose ends but keeps the marks.
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { SCENE, LIVE } = require('./lib/salad-fixtures')

const DIR = path.join(__dirname, '..', '..', 'modules', 'stage-salad', 'client')
const load = (f) => import(pathToFileURL(path.join(DIR, f)).href)

let S, V, F, VG, venue

before(async () => {
	S = await load('shots.js')
	V = await load('venue.js')
	F = await load('flight.js')
	VG = await load('veggies.js')
	venue = V.buildVenue(SCENE, LIVE)
})

const ME = 7
const slot = () => venue.slots[0]
const aimAt = (extra = 0) => ({ yaw: slot().yaw + extra, pitch: 0.35, power: 0.6 })

/** Where and when the flight really ends (no avatars), as the server would compute it. */
function realEnd(vegId, a, seed = 0, i = 0) {
	const veg = VG.VEGGIES[vegId]
	const l = F.launches(veg, V.pouch(slot()), a.yaw, a.pitch, a.power, seed)[i]
	return F.simulate(veg, l, venue, {})
}

function shotMsg(id, n, vegId, a, ts, seed = 0) {
	return { t: 'shot', id, n, veg: vegId, o: V.pouch(slot()), a: [a.yaw, a.pitch], p: a.power, ts, seed }
}

function run(book, from, to, step = 20, opts = {}) {
	const ev = []
	for (let t = from; t <= to; t += step) ev.push(...book.update(t, { dt: step / 1000, ...opts }))
	return ev
}

describe('WO-1089 Salad client: own shots', () => {
	it('drawn at once; an identical echo keeps the prediction; a duplicate echo is ignored', () => {
		const book = new S.ShotBook({ venue, meId: ME })
		const a = aimAt()
		const prs = book.addOwn({ n: 1, veg: 'tomato', o: V.pouch(slot()), ...a, sNow: 1000 })
		assert.equal(prs.length, 1)
		assert.equal(prs[0].own, true)
		assert.equal(prs[0].sts, null)
		run(book, 1000, 1100)
		const f = prs[0].f
		const t0 = f.t
		assert.ok(t0 > 0.05, 'already flying before the echo')
		book.onShot(shotMsg(ME, 1, 'tomato', a, 1040), 1100)
		assert.equal(book.live.length, 1, 'no second copy')
		assert.equal(prs[0].f, f, 'prediction kept')
		assert.equal(prs[0].sts, 1040)
		book.onShot(shotMsg(ME, 1, 'tomato', aimAt(0.2), 1050), 1100)
		assert.equal(prs[0].f, f, 'duplicate echo changes nothing')
	})

	it('a different launch replaces the flight and catches it up; a pea burst takes the server seed', () => {
		const book = new S.ShotBook({ venue, meId: ME })
		const a = aimAt()
		const [pr] = book.addOwn({ n: 2, veg: 'potato', o: V.pouch(slot()), ...a, sNow: 0 })
		run(book, 0, 200)
		const t0 = pr.f.t
		const b = { ...a, yaw: a.yaw + 0.05 }
		book.onShot(shotMsg(ME, 2, 'potato', b, 30), 200)
		assert.ok(Math.abs(pr.f.t - t0) < 0.02, 'caught up to the same flight time')
		const want = F.createFlight(VG.VEGGIES.potato, F.launches(VG.VEGGIES.potato, V.pouch(slot()), b.yaw, b.pitch, b.power, 0)[0])
		while (want.t < pr.f.t - 1e-9) F.stepFlight(want, venue)
		assert.ok(Math.hypot(...want.p.map((v, i) => v - pr.f.p[i])) < 1e-6, 'on the server launch')

		const peas = book.addOwn({ n: 3, veg: 'peas', o: V.pouch(slot()), ...a, sNow: 0 })
		assert.equal(peas.length, 5)
		const fs = peas.map((p) => p.f)
		book.onShot(shotMsg(ME, 3, 'peas', a, 10, 987654), 50)
		assert.ok(peas.every((p, i) => p.f !== fs[i]), 'every pea re-launched with the server seed')
		const L = F.launches(VG.VEGGIES.peas, V.pouch(slot()), a.yaw, a.pitch, a.power, 987654)
		assert.equal(L.length, 5)
		for (const p of peas) {
			const want = F.createFlight(VG.VEGGIES.peas, L[p.i])
			while (want.t < p.f.t - 1e-9) F.stepFlight(want, venue)
			assert.ok(Math.hypot(...want.p.map((v, k) => v - p.f.p[k])) < 1e-6, `pea ${p.i} on the server's spread`)
		}
	})

	it('no echo → gone after ORPHAN_MS without an event', () => {
		const book = new S.ShotBook({ venue, meId: ME })
		book.addOwn({ n: 4, veg: 'tomato', o: V.pouch(slot()), ...aimAt(), sNow: 0 })
		const ev = run(book, 0, S.ORPHAN_MS + 100)
		assert.equal(book.live.length, 0)
		assert.equal(ev.length, 0)
	})

	it('an `end` finishes it at the server time with the score; a tomato leaves a mark', () => {
		const book = new S.ShotBook({ venue, meId: ME })
		const a = aimAt()
		book.addOwn({ n: 5, veg: 'tomato', o: V.pouch(slot()), ...a, sNow: 0 })
		book.onShot(shotMsg(ME, 5, 'tomato', a, 20), 60)
		const e = realEnd('tomato', a)
		const at = 20 + e.t * 1000
		book.onEnd({ t: 'end', id: ME, n: 5, i: 0, k: 'hit', p: e.p, at, tid: 0, part: 'head', pts: 150, streak: 2, bank: false })
		const before = run(book, 0, at - 40)
		assert.equal(before.length, 0, 'not before the server time')
		const ev = run(book, at - 20, at + 60)
		assert.equal(ev.length, 1)
		assert.deepEqual([ev[0].k, ev[0].part, ev[0].pts, ev[0].streak, ev[0].own, ev[0].veg.id], ['hit', 'head', 150, 2, true, 'tomato'])
		assert.deepEqual(ev[0].p, e.p)
		assert.equal(book.live.length, 0, 'a splat is gone')
		assert.equal(book.marks.length, 0, 'a hit on the avatar marks the avatar, not the floor')
		book.addOwn({ n: 6, veg: 'tomato', o: V.pouch(slot()), ...a, sNow: 0 })
		book.onShot(shotMsg(ME, 6, 'tomato', a, 0), 0)
		book.onEnd({ t: 'end', id: ME, n: 6, i: 0, k: 'land', p: e.p, at: e.t * 1000 })
		run(book, 0, e.t * 1000 + 40)
		assert.equal(book.marks.length, 1, 'a landed tomato marks the floor')
		assert.equal(S.ShotBook.markAlpha(book.marks[0], book.marks[0].at), 1)
		assert.equal(S.ShotBook.markAlpha(book.marks[0], book.marks[0].at + S.MARK_MS), 0)
	})

	it('a potato lands and rests, then goes; an umbrella end drops it and leaves no mark', () => {
		const book = new S.ShotBook({ venue, meId: ME })
		const a = aimAt()
		const e = realEnd('potato', a)
		book.onShot(shotMsg(ME, 7, 'potato', a, 0), 0)
		book.onEnd({ t: 'end', id: ME, n: 7, i: 0, k: 'land', p: e.p, at: e.t * 1000 })
		run(book, 0, e.t * 1000 + 20)
		assert.equal(book.live[0].state, 'rest')
		run(book, e.t * 1000 + 40, e.t * 1000 + S.REST_MS + 100, 100)
		assert.equal(book.live.length, 0)
		book.onShot(shotMsg(ME, 8, 'tomato', a, 0), 0)
		book.onEnd({ t: 'end', id: ME, n: 8, i: 0, k: 'land', p: [10, 2, 3], at: 300, tag: 'umbrella', tid: 0 })
		const ev = run(book, 0, 400)
		assert.equal(ev[0].tag, 'umbrella')
		assert.equal(book.marks.length, 0)
	})
})

describe('WO-1089 Salad client: others, loose ends, holds, caps', () => {
	it("others' shots appear from the echo; an early `end` waits as a loose end", () => {
		const book = new S.ShotBook({ venue, meId: ME })
		const a = aimAt()
		const e = realEnd('carrot', a)
		book.onEnd({ t: 'end', id: 3, n: 9, i: 0, k: 'land', p: e.p, at: 500 + e.t * 1000 })
		assert.equal(book.loose.length, 1)
		book.onShot(shotMsg(3, 9, 'carrot', a, 500), 520)
		assert.equal(book.loose.length, 0)
		assert.equal(book.live[0].own, false)
		assert.ok(book.live[0].end)
		const ev = run(book, 520, 600 + e.t * 1000)
		assert.equal(ev.length, 1)
		assert.equal(ev[0].own, false)
		book.onEnd({ t: 'end', id: 4, n: 1, i: 0, k: 'hit', p: [1, 2, 3], at: 5000, part: 'body', tid: 0 })
		const lone = run(book, 4900, 5100)
		assert.equal(lone.length, 1)
		assert.equal(lone[0].veg, null, 'an end alone names no vegetable')
		assert.equal(book.loose.length, 0)
		book.onShot({ ...shotMsg(5, 1, 'tomato', a, 0) }, 10000)
		assert.equal(book.live.length, 0, 'a stale shot (older than a flight) is skipped')
	})

	it('hold-at-contact: waits ≤ HOLD_MS for the verdict, then flies on; with the verdict it finishes there', () => {
		const book = new S.ShotBook({ venue, meId: ME })
		const a = aimAt()
		let calls = 0
		const hitTest = (p0, p1) => (calls++, p1[0] - V.pouch(slot())[0] > 3 ? { u: 0, p: p1.slice(), n: [0, 1, 0], tid: 0, part: 'body' } : null)
		book.onShot(shotMsg(ME, 10, 'tomato', a, 0), 0)
		const pr = book.live[0]
		let held = null
		for (let t = 0; t < 1500 && !held; t += 10) {
			book.update(t, { hitTest, dt: 0.01 })
			if (pr.state === 'hold') held = t
		}
		assert.ok(held != null, 'held at the avatar')
		assert.ok(calls > 0)
		const hp = pr.p.slice()
		book.update(held + S.HOLD_MS / 2, { hitTest, dt: 0.01 })
		assert.deepEqual(pr.p, hp, 'waiting in place')
		book.update(held + S.HOLD_MS + 20, { hitTest, dt: 0.01 })
		assert.equal(pr.state, 'fly', 'no verdict → flies on')
		assert.equal(pr.noHit, true)
		book.update(held + S.HOLD_MS + 200, { hitTest, dt: 0.01 })
		assert.notEqual(pr.state, 'hold', 'no second hold')

		const b2 = new S.ShotBook({ venue, meId: ME })
		b2.onShot(shotMsg(ME, 11, 'tomato', a, 0), 0)
		const q = b2.live[0]
		let t = 0
		while (q.state !== 'hold' && t < 1500) b2.update((t += 10), { hitTest, dt: 0.01 })
		b2.onEnd({ t: 'end', id: ME, n: 11, i: 0, k: 'hit', p: q.p.slice(), at: t - 5, part: 'body', tid: 0, pts: 50 })
		const ev = b2.update(t + 30, { hitTest, dt: 0.01 })
		assert.equal(ev.length, 1)
		assert.equal(ev[0].pts, 50)
	})

	it('caps: ≤ MAX_LIVE live (resting first out), ≤ MAX_MARKS marks; clear() keeps the marks', () => {
		const book = new S.ShotBook({ venue, meId: ME })
		const a = aimAt()
		const e = realEnd('potato', a)
		book.onShot(shotMsg(1, 1, 'potato', a, 0), 0)
		book.onEnd({ t: 'end', id: 1, n: 1, i: 0, k: 'land', p: e.p, at: e.t * 1000 })
		run(book, 0, e.t * 1000 + 20)
		const resting = book.live[0]
		assert.equal(resting.state, 'rest')
		const t1 = e.t * 1000 + 40
		for (let n = 2; n < 2 + S.MAX_LIVE; n++) book.onShot(shotMsg(1, n, 'tomato', a, t1), t1)
		assert.equal(book.live.length, S.MAX_LIVE)
		assert.ok(!book.live.includes(resting), 'the resting one went first')
		const te = realEnd('tomato', a)
		for (let n = 100; n < 100 + S.MAX_MARKS + 8; n++) {
			book.onShot(shotMsg(2, n, 'tomato', a, 0), 0)
			book.onEnd({ t: 'end', id: 2, n, i: 0, k: 'land', p: te.p, at: te.t * 1000 })
			book.update(te.t * 1000 + 10, { dt: 0.01 })
		}
		assert.equal(book.marks.length, S.MAX_MARKS)
		book.onEnd({ t: 'end', id: 9, n: 9, i: 0, k: 'land', p: [0, 0, 0], at: 1e9 })
		book.clear()
		assert.equal(book.live.length, 0)
		assert.equal(book.loose.length, 0)
		assert.equal(book.marks.length, S.MAX_MARKS, 'splats on the floor stay')
		book.update(te.t * 1000 + S.MARK_MS + 100, {})
		assert.equal(book.marks.length, 0, 'marks fade out')
	})
})
