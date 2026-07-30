'use strict'

/**
 * Offline smoke — WO-396: cold GET /api/device-view must not re-probe DeckLink hardware.
 *
 * Root causes guarded here:
 * 1. The inventory collector read only TODAY'S Caspar log, but the "Decklink devices found:"
 *    block is written at Caspar's LAST START — after midnight the inventory carried [] and
 *    the snapshot's expensive fallbacks ran on every cold request.
 * 2. The fallback ran the ~1.2 s live ffmpeg probe (guaranteed to fail while Caspar holds
 *    the single-open cards) BEFORE the log parse that succeeds, and cached nothing.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

describe('inventory collector uses the multi-day log scanner (WO-396)', () => {
	const src = read('src/bootstrap/system-inventory-file.js')

	it('delegates to decklink-enum probeDecklinkFromCasparLog', () => {
		assert.match(src, /probeDecklinkFromCasparLog\(\{ maxBytes: 4 \* 1024 \* 1024 \}\)/)
	})

	it('the single-day parser is gone', () => {
		assert.doesNotMatch(src, /parseDecklinkDevicesFromCasparLog|resolveCasparLogPath/,
			'today-only log reading regresses the inventory short-circuit after midnight')
	})
})

describe('snapshot DeckLink fallback: log-parse first, probe last, result cached (WO-396)', () => {
	const src = read('src/api/device-view-snapshot.js')

	it('probes the log BEFORE the live ffmpeg probe', () => {
		const logIdx = src.indexOf('probeDecklinkFromCasparLog({ maxBytes')
		const probeIdx = src.indexOf('probeDecklinkHardware({ timeoutMs')
		assert.ok(logIdx > 0 && probeIdx > 0, 'both fallbacks must exist')
		assert.ok(logIdx < probeIdx,
			'live probe first = ~1.2 s guaranteed-fail on a running playout box')
	})

	it('caches the resolved hardware and exports the invalidator', () => {
		assert.match(src, /DECKLINK_HW_CACHE_TTL_MS/)
		const Snapshot = require('../../src/api/device-view-snapshot')
		assert.equal(typeof Snapshot.invalidateDecklinkHwCache, 'function')
	})

	it('the route clears the cache on fresh=1', () => {
		const route = read('src/api/routes-device-view.js')
		assert.match(route, /invalidateDecklinkHwCache\(\)/)
	})
})
