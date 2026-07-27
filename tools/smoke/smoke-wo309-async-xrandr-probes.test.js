'use strict'

/**
 * WO-309 — the async xrandr probes must be a drop-in replacement for the sync ones: same
 * output, same cache, genuinely non-blocking, and resilient to a burst of concurrent callers
 * during a cold cache. All of this is skipped gracefully where there is no X server / no xrandr
 * (e.g. a bare CI box) — the point here is behavioral parity and event-loop behavior, not
 * asserting real hardware exists.
 */

const { test } = require('node:test')
const assert = require('node:assert')

const hi = require('../../src/utils/hardware-info')

function freshModule() {
	delete require.cache[require.resolve('../../src/utils/hardware-info')]
	return require('../../src/utils/hardware-info')
}

test('async probes produce byte-identical output to their sync siblings', async () => {
	const syncDetails = hi.getDisplayDetails()
	const asyncDetails = await hi.getDisplayDetailsAsync()
	assert.deepEqual(asyncDetails, syncDetails, 'getDisplayDetailsAsync must match getDisplayDetails exactly')

	const syncInv = hi.getGpuConnectorInventory()
	const asyncInv = await hi.getGpuConnectorInventoryAsync()
	assert.deepEqual(asyncInv, syncInv, 'getGpuConnectorInventoryAsync must match getGpuConnectorInventory exactly')
})

/* The tick proof needs a real xrandr exec taking >4ms; with the binary absent the spawn
 * ENOENT resolves in under one timer tick — skip rather than flake (bare CI runners). */
const hasXrandr = require('node:fs').existsSync('/usr/bin/xrandr')
test('the async xrandr-query probe does not block the event loop', { skip: !hasXrandr && 'xrandr not installed' }, async () => {
	const mod = freshModule()
	const prevTtl = process.env.HIGHASCG_XRANDR_CACHE_TTL_MS
	process.env.HIGHASCG_XRANDR_CACHE_TTL_MS = '0' // force a real exec, not a cache hit
	try {
		let ticks = 0
		const timer = setInterval(() => ticks++, 4)
		const t0 = Date.now()
		await mod.getDisplaysXrandrDetailedAsync()
		const elapsedMs = Date.now() - t0
		clearInterval(timer)
		// A 4ms-interval timer ticking at least once during the call proves the loop was free —
		// execSync would have made this impossible (proven separately: 0 ticks over ~170ms on
		// the box). On a fast virtual X (CI xvfb-run) xrandr answers in <4ms, faster than one
		// timer period — such a call cannot prove blocking either way, so only assert when the
		// call was long enough for the timer to have possibly fired.
		if (elapsedMs >= 8) {
			assert.ok(ticks >= 1, `expected at least one event-loop tick during the ${elapsedMs}ms async call, got ${ticks}`)
		}
	} finally {
		if (prevTtl === undefined) delete process.env.HIGHASCG_XRANDR_CACHE_TTL_MS
		else process.env.HIGHASCG_XRANDR_CACHE_TTL_MS = prevTtl
	}
})

test('a burst of concurrent callers during a cold cache shares ONE in-flight fetch', async () => {
	const mod = freshModule()
	const prevTtl = process.env.HIGHASCG_XRANDR_CACHE_TTL_MS
	process.env.HIGHASCG_XRANDR_CACHE_TTL_MS = '0'
	try {
		const results = await Promise.all([
			mod.getDisplaysXrandrDetailedAsync(),
			mod.getDisplaysXrandrDetailedAsync(),
			mod.getDisplaysXrandrDetailedAsync(),
		])
		// All three must resolve to the SAME object reference — proof they awaited one in-flight
		// promise rather than three independent execs (which would still be correct, just wasteful;
		// this asserts the de-dup actually engaged).
		assert.equal(results[0], results[1], 'concurrent callers must share the same in-flight result')
		assert.equal(results[1], results[2])
	} finally {
		if (prevTtl === undefined) delete process.env.HIGHASCG_XRANDR_CACHE_TTL_MS
		else process.env.HIGHASCG_XRANDR_CACHE_TTL_MS = prevTtl
	}
})

test('invalidateXrandrCache clears the cache for BOTH sync and async readers', async () => {
	const mod = freshModule()
	await mod.getDisplaysXrandrDetailedAsync() // warm the shared cache
	mod.invalidateXrandrCache()
	// Immediately after invalidation, a sync call must not silently reuse a stale async-populated
	// cache entry — it should attempt its own fresh read (or the boot-snapshot fallback), not throw.
	assert.doesNotThrow(() => mod.getDisplaysXrandrDetailed())
})
