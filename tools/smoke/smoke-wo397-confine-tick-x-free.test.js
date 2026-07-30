'use strict'

/**
 * Offline smoke — WO-397: the 8 s pointer-confine watchdog tick must be X-FREE.
 *
 * Root cause guarded: each tick recomputed the full layout → `xrandr --verbose` + `--query`
 * spawns → two ~180 ms X-server freezes every 8.000 s (probe-proven mouse lag). The steady
 * tick must short-circuit on the cached active rect + daemon liveness BEFORE any layout
 * computation, and the xrandr cache TTL must exceed the slowest periodic caller.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

describe('pointer-confine steady tick is X-free (WO-397)', () => {
	const src = read('src/system/pointer-confine.js')

	it('the watchdog marks its recheck as steadyTick', () => {
		assert.match(src, /startPointerConfine\(watchConfig, \{ \.\.\.\(watchOpts \|\| \{\}\), steadyTick: true \}\)/)
	})

	it('the steadyTick fast path runs BEFORE calculateLayoutPositions', () => {
		const fastIdx = src.indexOf('opts.steadyTick && activeConfineRect')
		const layoutIdx = src.indexOf('opts.layout || calculateLayoutPositions(config)')
		assert.ok(fastIdx > 0, 'steadyTick fast path must exist')
		assert.ok(layoutIdx > 0, 'layout computation must exist for transition callers')
		assert.ok(fastIdx < layoutIdx, 'fast path after the layout call would still fork xrandr every 8 s')
	})

	it('the active rect is cleared on stop so a dead confine cannot serve a stale fast path', () => {
		const stopFn = src.slice(src.indexOf('function stopPointerConfine'), src.indexOf('function isPointerConfineActive'))
		assert.match(stopFn, /activeConfineRect = null/)
	})
})

describe('xrandr cache TTL outlives the periodic callers (WO-397)', () => {
	it('default TTL is 60 s (was 3 s — every 8 s watchdog tick was a guaranteed miss)', () => {
		const src = read('src/utils/hardware-info-xrandr.js')
		assert.match(src, /HIGHASCG_XRANDR_CACHE_TTL_MS \|\| '60000'/)
	})

	it('nvidia-smi GPU model is memoized (ran 3× per layout computation)', () => {
		const src = read('src/utils/hardware-info.js')
		assert.match(src, /_gpuModelMemo/)
	})
})
