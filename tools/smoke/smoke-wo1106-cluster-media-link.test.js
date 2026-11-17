'use strict'

/**
 * WO-1106 C20 / C26 — cluster-media-link.js: the poll sleep leaves no abort listener behind, and a queued copy that
 * wakes cancelled hands the transfer slot to the next one.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { getEventListeners } = require('node:events')
const { createPushJobs, sleep } = require('../../src/cluster/cluster-media-link')

describe('WO-1106 C20 poll sleep', () => {
	it('a sleep that runs out removes its abort listener (none pile up over a long copy)', async () => {
		const ctl = new AbortController()
		for (let i = 0; i < 40; i++) await sleep(1, ctl.signal)
		assert.equal(getEventListeners(ctl.signal, 'abort').length, 0)
	})

	it('an abort still ends the sleep at once', async () => {
		const ctl = new AbortController()
		const t0 = Date.now()
		const p = sleep(10000, ctl.signal)
		ctl.abort()
		await p
		assert.ok(Date.now() - t0 < 1000)
	})
})

describe('WO-1106 C26 transfer slot hand-on', () => {
	it('a waiter that wakes cancelled wakes the next one (it does not wait forever)', async () => {
		const ends = []
		const pushed = []
		const jobs = createPushJobs({
			push: (j) => {
				pushed.push(j.path)
				return new Promise((r) => ends.push(() => r({ ok: true })))
			},
		})
		const first = jobs.run({ path: 'a.mov', to: 'x', bytes: 1 })
		await new Promise((r) => setImmediate(r))
		const ctl = new AbortController()
		const second = jobs.run({ path: 'b.mov', to: 'x', bytes: 1 }, { signal: ctl.signal })
		const third = jobs.run({ path: 'c.mov', to: 'x', bytes: 1 })
		ctl.abort()
		ends.shift()()
		assert.equal((await first).state, 'done')
		assert.deepEqual(await second, { state: 'failed', error: 'cancelled' })
		const started = await Promise.race([
			new Promise((r) => {
				const t = setInterval(() => pushed.length === 2 && (clearInterval(t), r(true)), 5).unref()
			}),
			new Promise((r) => setTimeout(() => r(false), 1000).unref()),
		])
		assert.equal(started, true, 'the third copy started')
		assert.deepEqual(pushed, ['a.mov', 'c.mov'])
		ends.shift()()
		assert.equal((await third).state, 'done')
	})
})
