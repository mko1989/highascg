'use strict'

/**
 * WO-280 — Caspar JPEG compose preview: single-flight join + capped backoff.
 *
 * Pure logic only: no ffmpeg, no Caspar, no network, no filesystem. The single-flight
 * factory is a resolvable promise we control; the backoff is a pure function.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
	BACKOFF_BASE_MS,
	BACKOFF_MAX_MS,
	computeBackoffDelayMs,
	createSingleFlight,
	createBackoffGate,
} = require('../../src/preview/compose-preview-backpressure')

/** Deferred promise helper — lets a test hold a "generation" open. */
function deferred() {
	let resolve
	let reject
	const promise = new Promise((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

// ---------------------------------------------------------------------------
// Single-flight join
// ---------------------------------------------------------------------------

describe('WO-280 single-flight', () => {
	it('runs the factory once for concurrent callers on the same key', async () => {
		const sf = createSingleFlight()
		const d = deferred()
		let calls = 0
		const factory = () => {
			calls += 1
			return d.promise
		}

		// 25 concurrent clients asking for the same frame (one 40 ms frame at 25 fps).
		const joined = Array.from({ length: 25 }, () => sf.run('img:1', factory))

		assert.equal(calls, 1, 'factory must run exactly once for 25 concurrent joiners')
		assert.equal(sf.size(), 1, 'exactly one in-flight entry regardless of client count')
		assert.equal(sf.has('img:1'), true)

		d.resolve({ etag: 'W/"1-2"' })
		const results = await Promise.all(joined)
		assert.equal(results.length, 25)
		for (const r of results) {
			assert.deepEqual(r, { etag: 'W/"1-2"' }, 'every joiner gets the single generation result')
		}
	})

	it('keeps distinct keys independent and bounded by key count, not caller count', async () => {
		const sf = createSingleFlight()
		const d1 = deferred()
		const d2 = deferred()
		let c1 = 0
		let c2 = 0

		const a = [sf.run(1, () => (c1++, d1.promise)), sf.run(1, () => (c1++, d1.promise))]
		const b = [sf.run(2, () => (c2++, d2.promise)), sf.run(2, () => (c2++, d2.promise))]

		assert.equal(c1, 1)
		assert.equal(c2, 1)
		assert.equal(sf.size(), 2, 'two channels in flight, four callers')

		d1.resolve('one')
		d2.resolve('two')
		assert.deepEqual(await Promise.all(a), ['one', 'one'])
		assert.deepEqual(await Promise.all(b), ['two', 'two'])
	})

	it('evicts the entry when the generation settles so the next request starts fresh', async () => {
		const sf = createSingleFlight()
		let calls = 0
		const first = await sf.run('img:1', () => {
			calls += 1
			return Promise.resolve('a')
		})
		assert.equal(first, 'a')
		assert.equal(sf.size(), 0, 'settled generation must not stay in the map (no unbounded growth)')

		const second = await sf.run('img:1', () => {
			calls += 1
			return Promise.resolve('b')
		})
		assert.equal(second, 'b')
		assert.equal(calls, 2, 'a sequential request runs a new generation')
		assert.equal(sf.size(), 0)
	})

	it('propagates a rejection to every joiner and still evicts the key', async () => {
		const sf = createSingleFlight()
		const d = deferred()
		let calls = 0
		const joined = [
			sf.run('img:9', () => (calls++, d.promise)),
			sf.run('img:9', () => (calls++, d.promise)),
		]
		assert.equal(calls, 1)

		d.reject(new Error('Compose preview file empty'))
		const settled = await Promise.allSettled(joined)
		assert.deepEqual(
			settled.map((s) => s.status),
			['rejected', 'rejected'],
		)
		assert.equal(settled[0].reason.message, 'Compose preview file empty')
		assert.equal(sf.size(), 0, 'a failed generation must not pin the key forever')
	})

	it('rejects rather than throwing when the factory throws synchronously', async () => {
		const sf = createSingleFlight()
		await assert.rejects(
			() =>
				sf.run('img:1', () => {
					throw new Error('boom')
				}),
			/boom/,
		)
		assert.equal(sf.size(), 0)
	})
})

// ---------------------------------------------------------------------------
// Backoff schedule
// ---------------------------------------------------------------------------

describe('WO-280 backoff schedule', () => {
	it('is exponential from the base and capped at the ceiling', () => {
		const schedule = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => computeBackoffDelayMs(n))
		assert.deepEqual(schedule, [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000])
		assert.equal(schedule[0], BACKOFF_BASE_MS)
		assert.equal(Math.max(...schedule), BACKOFF_MAX_MS)
	})

	it('is monotonically non-decreasing and never exceeds the cap', () => {
		let prev = 0
		for (let n = 1; n <= 64; n++) {
			const d = computeBackoffDelayMs(n)
			assert.ok(d >= prev, `delay must not shrink at n=${n} (${d} < ${prev})`)
			assert.ok(d <= BACKOFF_MAX_MS, `delay must stay capped at n=${n}`)
			prev = d
		}
	})

	it('returns 0 for a healthy key and for junk input', () => {
		assert.equal(computeBackoffDelayMs(0), 0)
		assert.equal(computeBackoffDelayMs(-3), 0)
		assert.equal(computeBackoffDelayMs(undefined), 0)
		assert.equal(computeBackoffDelayMs(NaN), 0)
	})

	it('honours custom base/max/factor', () => {
		const opts = { baseMs: 250, maxMs: 2000, factor: 3 }
		assert.deepEqual(
			[1, 2, 3, 4, 5].map((n) => computeBackoffDelayMs(n, opts)),
			[250, 750, 2000, 2000, 2000],
		)
	})

	it('matches the client mirror exactly', async () => {
		const client = await import('../../client/lib/compose-preview-backpressure.js')
		assert.equal(client.BACKOFF_BASE_MS, BACKOFF_BASE_MS)
		assert.equal(client.BACKOFF_MAX_MS, BACKOFF_MAX_MS)
		for (let n = 0; n <= 12; n++) {
			assert.equal(
				client.computeBackoffDelayMs(n),
				computeBackoffDelayMs(n),
				`client and server backoff diverge at n=${n}`,
			)
		}
	})
})

// ---------------------------------------------------------------------------
// Backoff gate: one log line per state change, never per frame
// ---------------------------------------------------------------------------

describe('WO-280 backoff gate', () => {
	it('blocks attempts inside the window and allows them once it expires', () => {
		const gate = createBackoffGate()
		const t0 = 1_000_000

		assert.equal(gate.canAttempt(1, t0), true, 'healthy key is always attemptable')

		const f1 = gate.recordFailure(1, t0)
		assert.equal(f1.delayMs, 1000)
		assert.equal(gate.canAttempt(1, t0 + 999), false, 'blocked inside the window')
		assert.equal(gate.canAttempt(1, t0 + 1000), true, 'allowed once the window expires')

		const f2 = gate.recordFailure(1, t0 + 1000)
		assert.equal(f2.delayMs, 2000, 'second consecutive failure doubles the delay')
		assert.equal(gate.canAttempt(1, t0 + 2999), false)
		assert.equal(gate.canAttempt(1, t0 + 3000), true)
	})

	it('reports changed=true only on the healthy->degraded and degraded->healthy edges', () => {
		const gate = createBackoffGate()
		const t0 = 0

		// A 25 fps channel failing for a full second = 25 failures, but only ONE log line.
		const edges = []
		for (let i = 0; i < 25; i++) {
			const r = gate.recordFailure(3, t0 + i * 40)
			if (r.changed) edges.push(`degraded@${i}`)
		}
		assert.deepEqual(edges, ['degraded@0'], 'exactly one degrade edge across 25 failures')
		assert.equal(gate.failures(3), 25)

		const ok = gate.recordSuccess(3)
		assert.equal(ok.changed, true, 'recovery is a state change')
		assert.equal(ok.failures, 25)

		// Repeated successes on a healthy key are not state changes.
		for (let i = 0; i < 10; i++) {
			assert.equal(gate.recordSuccess(3).changed, false)
		}
		assert.equal(gate.failures(3), 0)
	})

	it('drops recovered keys so the map is bounded by failing keys only', () => {
		const gate = createBackoffGate()
		gate.recordFailure(1)
		gate.recordFailure(2)
		gate.recordFailure(3)
		assert.equal(gate.size(), 3)
		gate.recordSuccess(1)
		gate.recordSuccess(2)
		assert.equal(gate.size(), 1, 'healthy channels hold no entry')
		gate.recordSuccess(3)
		assert.equal(gate.size(), 0)
	})

	it('tracks channels independently', () => {
		const gate = createBackoffGate()
		const t0 = 5000
		gate.recordFailure(1, t0)
		gate.recordFailure(1, t0)
		gate.recordFailure(2, t0)
		assert.equal(gate.delayMs(1), 2000)
		assert.equal(gate.delayMs(2), 1000)
		assert.equal(gate.canAttempt(2, t0 + 1500), true)
		assert.equal(gate.canAttempt(1, t0 + 1500), false)
	})
})

// ---------------------------------------------------------------------------
// Client visibility backpressure
// ---------------------------------------------------------------------------

describe('WO-280 client visibility backpressure', () => {
	it('slows the meta poll when the tab is hidden', async () => {
		const { resolvePollIntervalMs, POLL_VISIBLE_MS, POLL_HIDDEN_MS } = await import(
			'../../client/lib/compose-preview-backpressure.js'
		)
		assert.equal(resolvePollIntervalMs('visible'), POLL_VISIBLE_MS)
		assert.equal(resolvePollIntervalMs(undefined), POLL_VISIBLE_MS)
		assert.equal(resolvePollIntervalMs('hidden'), POLL_HIDDEN_MS)
		assert.ok(POLL_HIDDEN_MS > POLL_VISIBLE_MS * 10, 'hidden poll must be dramatically slower')
	})

	it('drops all but one WS frame push per gap while hidden', async () => {
		const { shouldAcceptFramePush, PUSH_HIDDEN_MIN_GAP_MS } = await import(
			'../../client/lib/compose-preview-backpressure.js'
		)

		// 25 fps of pushes for 10 s while the tab is hidden.
		let lastAccepted = 0
		let accepted = 0
		for (let i = 0; i < 250; i++) {
			const now = 1_000_000 + i * 40
			if (shouldAcceptFramePush('hidden', lastAccepted, now)) {
				accepted += 1
				lastAccepted = now
			}
		}
		assert.equal(accepted, 1, '10 s of 25 fps pushes must collapse to a single fetch while hidden')

		// The same stream while visible is accepted unconditionally.
		let visibleAccepted = 0
		let lastVisible = 0
		for (let i = 0; i < 250; i++) {
			const now = 1_000_000 + i * 40
			if (shouldAcceptFramePush('visible', lastVisible, now)) {
				visibleAccepted += 1
				lastVisible = now
			}
		}
		assert.equal(visibleAccepted, 250, 'visible tabs are not rate limited here')

		// Once the gap elapses, a hidden tab refreshes again.
		assert.equal(shouldAcceptFramePush('hidden', 1000, 1000 + PUSH_HIDDEN_MIN_GAP_MS - 1), false)
		assert.equal(shouldAcceptFramePush('hidden', 1000, 1000 + PUSH_HIDDEN_MIN_GAP_MS), true)
	})
})
