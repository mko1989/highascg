'use strict'

/**
 * The two xrandr probes are execSync on the GET /api/device-view path, so they block the whole
 * single-threaded server. They were the only sync hardware probes in the repo with no timeout,
 * so a wedged X server would hang the process forever. Guard that they stay bounded.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const SRC = path.join(__dirname, '..', '..', 'src', 'utils', 'hardware-info.js')

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
