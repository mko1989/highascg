'use strict'

/**
 * Smoke — todos19.07.26 release: operator-GUI launcher startup timing probes (log-only).
 * The launch pipeline is timing-sensitive (Firefox kiosk spawn -> window map -> shape helper up
 * -> first rect report) and the probes make those phases journal-diagnosable. Covers:
 *  - functional: POST /api/operator-gui/layout logs ONE "timing: first rect report" line (first
 *    non-empty report only — no per-report log spam, and empty withdrawals never count),
 *  - source-level (house pattern from smoke-wo269-shape-log-dedupe): the spawn/window probes in
 *    operator-gui-launcher.js and the helper spawn/ready/first-write probes in
 *    operator-shape-overlay.js exist and stay log-only (`timing:` lines via the files' own log
 *    style, no new control flow around them).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { handlePost } = require('../../src/api/routes-operator-gui')

const src = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

describe('first rect report probe (routes-operator-gui.js)', () => {
	it('logs exactly once, only for a non-empty report, even with amcp disconnected', async () => {
		const lines = []
		const ctx = { amcp: null, log: (lvl, msg) => lines.push(`${lvl} ${msg}`) }
		const cells = [{ id: 'a', role: 'pgm', mainIndex: 0, rect: { x: 0, y: 0, w: 0.5, h: 0.5 } }]

		// Empty report (withdrawal) first — must NOT count as the first rect report.
		await handlePost('/api/operator-gui/layout', JSON.stringify({ cells: [] }), ctx)
		assert.equal(lines.filter((l) => l.includes('timing: first rect report')).length, 0)

		const res = await handlePost('/api/operator-gui/layout', JSON.stringify({ cells }), ctx)
		assert.equal(res.status, 200, 'amcp-disconnected report still answers ok/skipped')
		const timingLines = lines.filter((l) => l.includes('timing: first rect report'))
		assert.equal(timingLines.length, 1)
		assert.match(timingLines[0], /^info \[Operator GUI\] timing: first rect report t=\d+ cells=1$/)

		// Second report: no further timing line (once per server run).
		await handlePost('/api/operator-gui/layout', JSON.stringify({ cells }), ctx)
		assert.equal(lines.filter((l) => l.includes('timing: first rect report')).length, 1)
	})
})

describe('launcher probes (operator-gui-launcher.js) — source level', () => {
	const launcher = src('src/system/operator-gui-launcher.js')
	it('records t0 at kiosk spawn and probes each phase with ms-since-spawn', () => {
		assert.match(launcher, /launchSpawnAt = Date\.now\(\)\s*\n\s*probeLaunchPhase\(ctx\.log, 'kiosk spawned'/)
		assert.match(launcher, /probeLaunchPhase\(log, 'kiosk window found'/)
		assert.match(launcher, /probeLaunchPhase\(log, 'kiosk window positioned'\)/)
		assert.match(launcher, /timing: \$\{phase\} t=\$\{now\} \+\$\{dt\}ms/)
	})
})

describe('shape helper probes (operator-shape-overlay.js) — source level', () => {
	const feeder = src('src/system/operator-shape-overlay.js')
	it('probes helper ready (first stdout) and first rects written', () => {
		assert.match(feeder, /helperSpawnAt = Date\.now\(\)/)
		assert.match(feeder, /timing: ready \(first output\)/)
		assert.match(feeder, /timing: first rects written/)
	})
	it('first-write probe fires only after a successful stdin write (inside the try, after the cache set)', () => {
		assert.match(feeder, /_lastWrittenPayload = payload\s*\n\s*if \(!firstRectsWritten && lastRects\.length\)/)
	})
})
