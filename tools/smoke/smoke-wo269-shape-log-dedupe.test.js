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

	it('cache is set on successful send (POST/DELETE)', () => {
		assert.match(lib, /_lastSentJson = json\s*\n\s*\} catch/)
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

	it('alreadyRunning is computed BEFORE ensureSpawned (fresh spawn always gets payload)', () => {
		const alreadyRunningIdx = feeder.indexOf('const alreadyRunning = isRunning()')
		const ensureSpawnedIdx = feeder.indexOf('const p = ensureSpawned(log)')
		assert.ok(alreadyRunningIdx > 0 && ensureSpawnedIdx > alreadyRunningIdx,
			'alreadyRunning must be checked before spawn to allow fresh process to receive payload')
	})

	it('skips identical payloads only while the helper is already alive', () => {
		assert.match(feeder, /const alreadyRunning = isRunning\(\)/)
		assert.match(feeder, /if \(!opts\.force && alreadyRunning && payload === _lastWrittenPayload\) return/)
	})

	it('cache is set on successful write (after p.stdin.write)', () => {
		assert.match(feeder, /p\.stdin\.write\(payload \+ '\\n'\)\s*\n\s*_lastWrittenPayload = payload/)
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

	it('emits repeat summary when line changes (before new-line log)', () => {
		const code = helper
		// Find the pattern: repeat summary on change, THEN new line log, THEN parse
		const repeatPattern = code.indexOf('log(f"stdin line repeated')
		const changeBlock = code.indexOf('else:', repeatPattern)
		const newLineLogAfterChange = code.indexOf('log(f"stdin line received:', changeBlock)
		assert.ok(changeBlock > 0 && newLineLogAfterChange > changeBlock,
			'repeat summary and last_stdin_line reset must occur before new-line log on payload change')
	})

	it('tracks last_stdin_line to detect repeats', () => {
		assert.match(helper, /last_stdin_line = line/)
	})

	it('keeps the WO-262 log-before-parse guarantee for NEW payloads', () => {
		const idx = helper.indexOf('log(f"stdin line received:')
		// Match the CALL, not the destructuring arity — the payload gains fields over time (WO-283
		// added `helperOpen`). What this test guards is the ORDER: log the raw line first, parse
		// second, so a payload that crashes the parser is still visible in the helper log.
		const parseIdx = helper.indexOf('= parse_line(line)')
		assert.ok(idx > 0 && parseIdx > idx, 'new-line log must still precede parse_line')
	})

	it('does NOT compress timing probes from the feeder (one-shot, not stdin repeats)', () => {
		// Timing probes like "timing: ready" and "timing: first rects written" come from feeder's
		// stdout handler, not from stdin, so the repeat compression (which only looks at stdin lines)
		// never touches them. This is correct by design — they're logged when first received.
		// Verify feeder doesn't apply repeat compression to its own timing probes:
		const feeder = src('src/system/operator-shape-overlay.js')
		// Timing probes are logged directly from child.stdout.on('data') via log?.('info', ...)
		// They're NOT affected by stdin repeat compression (which is python-side only)
		assert.match(feeder, /if \(!helperFirstOutputSeen\) {[\s\S]*?helperFirstOutputSeen = true/)
		assert.match(feeder, /if \(!firstRectsWritten && lastRects\.length\) {[\s\S]*?firstRectsWritten = true/)
	})
})
