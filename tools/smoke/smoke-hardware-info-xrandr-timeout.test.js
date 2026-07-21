'use strict'

/**
 * The two xrandr probes used to be execSync on the GET /api/device-view path, so they blocked the
 * whole single-threaded server. They were the only sync hardware probes in the repo with no
 * timeout at all, so a wedged X server would hang the process forever. Timeout added (this file's
 * first guard); WO-309 then gave the hot path (device-view-snapshot.js) genuinely non-blocking
 * async siblings (getDisplaysXrandrDetailedAsync/getDisplaysXrandrVerboseRawAsync and the
 * getDisplayDetailsAsync/getGpuConnectorInventoryAsync entry points built on them), sharing the
 * SAME cache as the sync versions. The sync functions themselves remain — 20+ other callers
 * (bootstrap scripts, layout math called from inside synchronous config-generation code) were
 * never the measured problem and are deliberately left untouched; see WO-309 for the full
 * caller enumeration and why converting them would be scope creep with no measured benefit.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const SRC = path.join(__dirname, '..', '..', 'src', 'utils', 'hardware-info.js')
const SNAPSHOT_SRC = path.join(__dirname, '..', '..', 'src', 'api', 'device-view-snapshot.js')

test('every execSync in hardware-info.js passes a timeout', () => {
	const src = fs.readFileSync(SRC, 'utf8')

	/* Slice each execSync( ... ) options object by brace matching rather than regex, so this cannot
	 * be fooled by a `timeout:` that belongs to a neighbouring call. */
	const calls = []
	for (let i = src.indexOf('execSync('); i !== -1; i = src.indexOf('execSync(', i + 1)) {
		let depth = 0
		let end = -1
		for (let j = i + 'execSync('.length - 1; j < src.length; j++) {
			if (src[j] === '(') depth++
			else if (src[j] === ')') {
				depth--
				if (depth === 0) { end = j; break }
			}
		}
		assert.notEqual(end, -1, 'unbalanced execSync( call')
		calls.push(src.slice(i, end + 1))
	}

	assert.ok(calls.length >= 3, `expected the known execSync probes, found ${calls.length}`)
	for (const call of calls) {
		const cmd = (call.match(/execSync\(\s*['"`]([^'"`]+)/) || [])[1] || call.slice(0, 60)
		assert.match(
			call,
			/timeout\s*:/,
			`execSync("${cmd}") has no timeout — a wedged probe hangs the entire server, ` +
				'including AMCP and every WS client',
		)
	}
})

test('the xrandr timeout leaves headroom over the measured healthy cost', () => {
	const { XRANDR_TIMEOUT_MS } = require('../../src/utils/hardware-info')
	if (XRANDR_TIMEOUT_MS === undefined) return // not exported; the source check above is the guard
	assert.ok(XRANDR_TIMEOUT_MS >= 1000, 'too tight: healthy xrandr measured ~90ms, slow boxes are worse')
	assert.ok(XRANDR_TIMEOUT_MS <= 10000, 'too loose to bound a wedged X server usefully')
})

test('the async xrandr probes also carry the timeout (execFileAsync, same options)', () => {
	const src = fs.readFileSync(SRC, 'utf8')
	for (const fn of ['getDisplaysXrandrVerboseRawAsync', 'getDisplaysXrandrDetailedAsync']) {
		const start = src.indexOf(`async function ${fn}`)
		assert.notEqual(start, -1, `${fn} must exist`)
		const end = src.indexOf('\n}', start)
		const body = src.slice(start, end)
		assert.match(body, /timeout\s*:\s*XRANDR_TIMEOUT_MS/, `${fn} must pass the same timeout as the sync version`)
	}
})

test('WO-309: the GET /api/device-view hot path uses the ASYNC probes, not execSync directly', () => {
	const src = fs.readFileSync(SNAPSHOT_SRC, 'utf8')
	assert.match(
		src,
		/require\(['"]\.\.\/utils\/hardware-info['"]\)/,
		'device-view-snapshot.js must still get its probes from hardware-info.js',
	)
	assert.match(src, /getDisplayDetailsAsync/, 'buildLiveSnapshot must use the async display-details entry point')
	assert.match(src, /getGpuConnectorInventoryAsync/, 'buildLiveSnapshot must use the async connector-inventory entry point')
	assert.ok(!/\bgetDisplayDetails\(\)/.test(src), 'the sync getDisplayDetails() must not be called here — it blocks the event loop')
	assert.ok(!/\bgetGpuConnectorInventory\(\)/.test(src), 'the sync getGpuConnectorInventory() must not be called here')
})

test('the sync and async xrandr-detailed paths share one cache (WO-309): a sync call warms the cache for the async path', async () => {
	delete require.cache[require.resolve('../../src/utils/hardware-info')]
	const hi = require('../../src/utils/hardware-info')
	// Whichever runs first should populate the shared cache; call sync first here.
	let syncOk = true
	try {
		hi.getDisplaysXrandrDetailed()
	} catch {
		syncOk = false // no X server in this test environment — still fine, see below
	}
	const before = Date.now()
	const asyncResult = await hi.getDisplaysXrandrDetailedAsync()
	const elapsed = Date.now() - before
	if (syncOk) {
		// A warm cache hit resolves near-instantly; a fresh exec takes tens of ms at minimum.
		assert.ok(elapsed < 30, `expected a cache hit (<30ms), took ${elapsed}ms — cache is not shared`)
	}
	assert.ok(asyncResult === null || typeof asyncResult === 'object')
})
