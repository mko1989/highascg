'use strict'

/**
 * WO-542 — todos14.08.26 items 8+9: flag time fields still showed raw milliseconds, and the
 * "jump to another flag" dropdown showed "label @ 1234ms" instead of "label - time".
 *
 * `fmtHms`/`parseHmsInput` (client/components/timeline-canvas-utils.js) are the millisecond
 * counterpart to the existing frame-based `fmtSmpte`/`parseTcInput` — a flag's jump target isn't
 * "at" any clip's fps, so a frame-accurate SMPTE format doesn't apply the way it does for clip
 * in/out points (which keep their existing frame-based display untouched — out of scope here).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { fmtHms, parseHmsInput } = require('../../client/components/timeline-canvas-utils.js')

describe('WO-542: fmtHms', () => {
	it('formats zero', () => {
		assert.equal(fmtHms(0), '00:00:00:000')
	})
	it('formats sub-second, seconds, minutes, hours', () => {
		assert.equal(fmtHms(456), '00:00:00:456')
		assert.equal(fmtHms(1500), '00:00:01:500')
		assert.equal(fmtHms(61000), '00:01:01:000')
		assert.equal(fmtHms(3661234), '01:01:01:234')
	})
	it('rounds and clamps negative to zero', () => {
		assert.equal(fmtHms(999.6), '00:00:01:000')
		assert.equal(fmtHms(-500), '00:00:00:000')
	})
})

describe('WO-542: parseHmsInput', () => {
	it('round-trips through fmtHms', () => {
		for (const ms of [0, 456, 1500, 61000, 3661234]) {
			assert.equal(parseHmsInput(fmtHms(ms), 0, 999999999), ms)
		}
	})
	it('accepts shorter forms (M:SS:mmm, SS:mmm, plain ms)', () => {
		assert.equal(parseHmsInput('1:01:000', 0, 999999999), 61000)
		assert.equal(parseHmsInput('01:000', 0, 999999999), 1000)
		assert.equal(parseHmsInput('1234', 0, 999999999), 1234)
	})
	it('accepts ++/-- relative offsets against the current value', () => {
		assert.equal(parseHmsInput('++500', 1000, 999999999), 1500)
		assert.equal(parseHmsInput('--500', 1000, 999999999), 500)
		assert.equal(parseHmsInput('--5000', 1000, 999999999), 0, 'clamped at 0, not negative')
	})
	it('clamps to totalMs and rejects garbage', () => {
		assert.equal(parseHmsInput('01:00:00:000', 0, 5000), 5000, 'clamped to the timeline duration')
		assert.equal(parseHmsInput('not a time', 0, 999999999), null)
		assert.equal(parseHmsInput('', 0, 999999999), null)
	})
})

describe('WO-542: flag inspector wiring', () => {
	const src = fs.readFileSync(
		path.join(__dirname, '../../client/components/inspector-panel-timeline-flag.js'),
		'utf8',
	)

	it('the jump-to-flag dropdown uses "label - time", not "label @ Nms"', () => {
		assert.match(src, /f\.label \|\| f\.type \|\| 'flag'\) \+ ' - ' \+ fmtHms\(f\.timeMs\)/)
		assert.doesNotMatch(src, /@ ' \+ Math\.round\(f\.timeMs\) \+ 'ms'/)
	})

	it('the jump-to-time field reads and writes hh:mm:ss:ms via fmtHms/parseHmsInput', () => {
		assert.match(src, /jumpInp\.value = flag\.jumpTimeMs.*fmtHms\(flag\.jumpTimeMs\)/)
		assert.match(src, /parseHmsInput\(raw, flag\.jumpTimeMs/)
		assert.doesNotMatch(src, /parseNumberInput/, 'no longer a plain-ms math field')
	})

	it('labels/hints say hh:mm:ss:ms, not "(ms)"', () => {
		assert.match(src, /Jump to time \(hh:mm:ss:ms\)/)
		assert.match(src, /set a time \(hh:mm:ss:ms\)/)
	})
})
