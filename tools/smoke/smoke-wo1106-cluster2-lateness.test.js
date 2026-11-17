'use strict'

/**
 * WO-1106 C21 — dest.* lateness (src/cluster/dest-actions.js lateBy) after a sender's clock step. The baseline is the
 * smallest (arrival − sender ts) seen; it used to only go down, so after the sender's clock stepped back every press
 * from it was refused 409 DEST_EXPIRED for up to 10 minutes (BASE_MS). Now a sender whose stamps stop rising in step
 * with arrival is rebased within a few presses, and the sender's stamper (call-replay-guard.js) keeps counting at its
 * clock's pace after a step back. A press read late after a freeze is still dropped. Offline: route stubs, fake clocks.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { boxConfig, quiet, clone } = require('./lib/cwc-fixtures')
const { createDestActions } = require('../../src/cluster/dest-actions')
const { createStamper } = require('../../src/cluster/call-replay-guard')

const DEST = 'dst_mw989wyz_1' // screen 2 of highascg5867
const peer = { id: 'X', name: 'srv-X' }

function receiver() {
	const cfg = clone(boxConfig('5867'))
	cfg.cluster = { channelsWhereCabled: true }
	const ctx = { config: cfg, log: () => {}, _wsBroadcast: () => {} }
	const ran = []
	const routes = { takeLook: async () => (ran.push(1), { status: 200, body: JSON.stringify({ ok: true }) }) }
	const w = { t: 5_000_000 }
	const a = createDestActions(ctx, { routes, wall: () => w.t }).actions
	const press = (ts, ttlMs = 1000) => a['dest.take']({ destId: DEST, sceneId: 'L', ttlMs }, peer, { ts })
	return { w, ran, press }
}

/** Presses every `gap` ms for `ms`, stamped by `stamp(t)` → how many were refused DEST_EXPIRED (and the first ones). */
async function run(r, stamp, { gap = 5000, ms = 10 * 60 * 1000, ttlMs = 1000 } = {}) {
	const refused = []
	for (let i = 0; i * gap < ms; i++) {
		r.w.t += gap
		const res = await r.press(stamp(r.w.t), ttlMs)
		if (res.status === 409 && res.body.code === 'DEST_EXPIRED') refused.push(i)
		else assert.equal(res.status, 200, JSON.stringify(res.body))
	}
	return refused
}

describe('WO-1106 C21 dest.* lateness baseline recovers from a sender clock step', () => {
	it('a sender clock 30 s back (stamps follow it): one press refused, not 10 minutes of them', async () => {
		await quiet(async () => {
			const r = receiver()
			const ahead = 180_000 // the sender's clock is 3 min ahead: never compared, only the step matters
			assert.deepEqual(await run(r, (t) => t + ahead - 20, { ms: 20_000 }), [], 'normal delivery')
			const refused = await run(r, (t) => t + ahead - 30_000 - 20)
			assert.ok(refused.length <= 1, `${refused.length} presses refused after the step (old code: every press for 10 min)`)
		})
	})

	it('an older sender whose stamp sticks at last + 1 until its clock catches up: a few presses, then it runs', async () => {
		await quiet(async () => {
			const r = receiver()
			let last = 0
			const clock = { off: 0 }
			const oldStamp = (t) => (last = Math.max(t + clock.off, last + 1)) // the stamper before WO-1106 C21
			assert.deepEqual(await run(r, oldStamp, { ms: 20_000 }), [])
			clock.off = -120_000 // its clock steps back 2 min: the stamp holds for 2 min, then follows the clock
			const refused = await run(r, oldStamp)
			assert.ok(refused.length <= 2, `${refused.length} presses refused`)
			assert.ok(refused.every((i) => i < 3), `only the first presses after the step: ${refused}`)
		})
	})

	it('this build\'s stamper keeps counting at the clock\'s pace after a step back: nothing refused', async () => {
		await quiet(async () => {
			const r = receiver()
			const sender = { t: 0 }
			const stamper = createStamper(() => sender.t, () => r.w.t) // its monotonic clock = real time
			const stamp = (t) => ((sender.t = t + sender.off), stamper.next('rx'))
			sender.off = 0
			assert.deepEqual(await run(r, stamp, { ms: 20_000 }), [])
			sender.off = -45_000
			assert.deepEqual(await run(r, stamp), [])
		})
	})

	it('presses read together after a freeze are still dropped, and the next press runs', async () => {
		await quiet(async () => {
			const r = receiver()
			assert.deepEqual(await run(r, (t) => t - 15, { ms: 20_000 }), [])
			const sentAt = r.w.t
			r.w.t += 6000 // frozen 6 s: three presses sent 300 ms apart are read at once
			const late = []
			for (let k = 1; k <= 3; k++) late.push(await r.press(sentAt + 300 * k - 15))
			assert.deepEqual(late.map((x) => x.body.code), ['DEST_EXPIRED', 'DEST_EXPIRED', 'DEST_EXPIRED'])
			const ranBefore = r.ran.length
			r.w.t += 2000
			assert.equal((await r.press(r.w.t - 15)).status, 200)
			assert.equal(r.ran.length, ranBefore + 1)
		})
	})

	it('a single late press between normal ones is dropped (unchanged)', async () => {
		await quiet(async () => {
			const r = receiver()
			assert.deepEqual(await run(r, (t) => t - 15, { ms: 20_000 }), [])
			r.w.t += 5000
			const late = await r.press(r.w.t - 4000)
			assert.equal(late.body.code, 'DEST_EXPIRED')
			assert.deepEqual(await run(r, (t) => t - 15, { ms: 20_000 }), [])
		})
	})
})

describe('WO-1106 C21 stamper after a clock step back', () => {
	it('counts on from the last stamp at the clock\'s pace (not last + 1 until the clock caught up)', () => {
		const c = { t: 1_000_000, m: 0 }
		const s = createStamper(() => c.t, () => c.m)
		const a = s.next('r')
		c.m += 2000
		c.t += 2000 - 60_000 // 2 s later the wall clock steps back a minute
		const b = s.next('r')
		assert.equal(b - a, 2000, 'the real 2 s, not +1')
		c.t += 5000
		c.m += 5000
		assert.equal(s.next('r') - b, 5000)
		c.t += 0
		assert.ok(s.next('r') > b + 5000, 'strictly rising inside one ms')
	})
})
