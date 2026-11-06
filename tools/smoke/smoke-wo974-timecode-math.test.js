'use strict'

/**
 * WO-974: SMPTE timecode math (24 / 25 / 29.97 drop-frame / 30) used by LTC in, LTC out and the chase.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const T = require('../../src/timecode/timecode-math')

const tc = (h, m, s, f) => ({ h, m, s, f })

describe('WO-974: fps modes', () => {
	it('maps the settings values onto the four LTC modes', () => {
		assert.equal(T.fpsMode(24).key, '24')
		assert.equal(T.fpsMode('25').key, '25')
		assert.equal(T.fpsMode(29.97).key, '29.97df')
		assert.equal(T.fpsMode('29.97df').df, true)
		assert.equal(T.fpsMode(30).df, false)
		assert.equal(T.fpsMode('bogus').key, '25')
	})
})

describe('WO-974: non-drop frame ↔ timecode', () => {
	for (const fps of [24, 25, 30]) {
		it(`${fps} fps round-trips every frame of the first 2 minutes and the 24 h wrap`, () => {
			for (let n = 0; n < fps * 120; n++) assert.equal(T.tcToFrames(T.framesToTc(n, fps), fps), n)
			assert.deepEqual(T.framesToTc(fps * 3600 + 1, fps), { h: 1, m: 0, s: 0, f: 1, df: false })
			assert.equal(T.framesPerDay(fps), fps * 86400)
			assert.deepEqual(T.framesToTc(T.framesPerDay(fps), fps), { h: 0, m: 0, s: 0, f: 0, df: false })
			assert.deepEqual(T.framesToTc(-1, fps), { h: 23, m: 59, s: 59, f: fps - 1, df: false })
		})
	}
})

describe('WO-974: 29.97 drop-frame', () => {
	const DF = '29.97df'
	it('skips ;00 and ;01 at each minute except every tenth', () => {
		assert.equal(T.formatTc(T.framesToTc(1799, DF)), '00:00:59;29')
		assert.equal(T.formatTc(T.framesToTc(1800, DF)), '00:01:00;02')
		assert.equal(T.formatTc(T.framesToTc(17981, DF)), '00:09:59;29')
		assert.equal(T.formatTc(T.framesToTc(17982, DF)), '00:10:00;00', 'minute 10 keeps ;00')
		assert.equal(T.formatTc(T.framesToTc(17983, DF)), '00:10:00;01')
		assert.equal(T.formatTc(T.framesToTc(17982 + 1800, DF)), '00:11:00;02')
	})
	it('1 h of wall time is 107892 frames = 01:00:00;00 (the DF guarantee)', () => {
		assert.equal(T.tcToFrames(tc(1, 0, 0, 0), DF), 107892)
		assert.equal(T.formatTc(T.framesToTc(107892, DF)), '01:00:00;00')
		assert.ok(Math.abs(T.framesToMs(107892, DF) - 3600000) < 3700, 'DF stays within ~3.6 s/h of wall time')
		assert.equal(T.framesPerDay(DF), 2589408)
	})
	it('round-trips every frame of the first 11 minutes and around the 24 h wrap', () => {
		for (let n = 0; n < 17982 + 1900; n++) assert.equal(T.tcToFrames(T.framesToTc(n, DF), DF), n)
		const day = T.framesPerDay(DF)
		for (let n = day - 2000; n < day; n++) assert.equal(T.tcToFrames(T.framesToTc(n, DF), DF), n)
	})
	it('a dropped label maps onto the next real frame', () => {
		assert.equal(T.tcToFrames(tc(0, 1, 0, 0), DF), 1800)
		assert.equal(T.tcToFrames(tc(0, 1, 0, 1), DF), 1800)
		assert.equal(T.tcToFrames(tc(0, 1, 0, 2), DF), 1800)
	})
})

describe('WO-974: ms, parsing, deltas', () => {
	it('ms ↔ frames at the real rate', () => {
		assert.equal(T.msToFrames(1000, 25), 25)
		assert.equal(T.msToFrames(39.99, 25), 0)
		assert.equal(T.msToFrames(40, 25), 1)
		assert.equal(T.msToFrames(1001, '29.97df'), 30)
		assert.equal(T.formatTc(T.msToTc(3600000, 25)), '01:00:00:00')
		assert.equal(T.tcToMs(tc(0, 0, 1, 12), 24), 1500)
	})
	it('parses : ; . separators and range-checks against a mode', () => {
		assert.deepEqual(T.parseTc('01:02:03:04'), { h: 1, m: 2, s: 3, f: 4, df: false })
		assert.equal(T.parseTc('01:02:03;04').df, true)
		assert.equal(T.parseTc('01:02:03.04').f, 4)
		assert.equal(T.parseTc('01:02:03:25', 25), null)
		assert.equal(T.parseTc('24:00:00:00'), null)
		assert.equal(T.parseTc('1:2:3:4'), null)
		assert.equal(T.parseTc('00:00:00:29', '29.97df').df, true)
	})
	it('frameDelta takes the short way round midnight', () => {
		const day = T.framesPerDay(25)
		assert.equal(T.frameDelta(day - 1, 0, 25), 1)
		assert.equal(T.frameDelta(0, day - 1, 25), -1)
		assert.equal(T.frameDelta(100, 175, 25), 75)
	})
})
