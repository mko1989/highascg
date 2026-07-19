'use strict'

/**
 * WO-269: identical-payload dedupe across the three shape-overlay layers.
 * Offline-only. The client lib is ESM-with-side-effects and the feeder spawns a python child on
 * first write, so all three layers are asserted at source level (house pattern from smoke-wo255)
 * — the invariants are structural: skip-when-unchanged, force-on-recovery, cache resets.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO = path.join(__dirname, '../..')

function src(rel) {
	return fs.readFileSync(path.join(REPO, rel), 'utf8')
}

describe('WO-269 T269.1: client sendLayout dedupe', () => {
	const lib = src('client/lib/operator-gui-mode.js')

	it('skips identical payloads unless forced', () => {
		assert.match(lib, /if \(!force && json === _lastSentJson\) return/)
	})

	it('recovery resend (reconnect/nudge/heartbeat) forces', () => {
		assert.match(lib, /void sendLayout\(effectiveCells\(\), \{ force: true \}\)/)
	})

	it('cache clears on send failure and in the test reset', () => {
		assert.match(lib, /catch \(e\) \{\s*\n\s*_lastSentJson = null/)
		assert.match(lib, /_lastSentJson = null\s*\n\s*if \(_heartbeatTimer\)/)
	})
})

describe('WO-269 T269.2: feeder stdin dedupe', () => {
	const feeder = src('src/system/operator-shape-overlay.js')

	it('skips identical payloads only while the helper is already alive', () => {
		assert.match(feeder, /const alreadyRunning = isRunning\(\)/)
		assert.match(feeder, /if \(!opts\.force && alreadyRunning && payload === _lastWrittenPayload\) return/)
	})

	it('reapply (Caspar reconnect) forces a rewrite', () => {
		assert.match(feeder, /updateShapeRects\(lastMonitor, lastRects \|\| \[\], \{ \.\.\.opts, force: true \}\)/)
	})

	it('cache clears on write failure and on stop', () => {
		const clearSites = feeder.match(/_lastWrittenPayload = null/g) || []
		assert.ok(clearSites.length >= 2, 'expected cache reset in both the catch and stop paths')
	})
})

describe('WO-269 T269.3: helper repeat compression', () => {
	const helper = src('tools/runtime/operator-shape-overlay.py')

	it('counts unchanged repeats and logs a summary instead of every line', () => {
		assert.match(helper, /if line == last_stdin_line:/)
		assert.match(helper, /stdin line repeated x\{stdin_repeat_count\} \(unchanged, suppressed\)/)
		assert.match(helper, /REPEAT_SUMMARY_SEC = 60\.0/)
	})

	it('keeps the WO-262 log-before-parse guarantee for NEW payloads', () => {
		const idx = helper.indexOf('log(f"stdin line received:')
		const parseIdx = helper.indexOf('monitor, rects, channel, title_marker = parse_line(line)')
		assert.ok(idx > 0 && parseIdx > idx, 'new-line log must still precede parse_line')
	})
})
