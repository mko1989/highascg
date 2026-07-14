'use strict'

/**
 * WO-186 — HMS (HH:MM:SS) input helper for countdown timer control panel.
 * Covers pure conversion functions between seconds and { hours, minutes, seconds } objects.
 *
 * Run: node --test tools/smoke/smoke-duration-hms-input.test.js
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	secondsToHms,
	hmsToSeconds,
} = require('../../client/lib/duration-hms-input.js')

describe('WO-186 — secondsToHms', () => {
	it('converts zero seconds', () => {
		const result = secondsToHms(0)
		assert.deepEqual(result, { hours: 0, minutes: 0, seconds: 0 })
	})

	it('converts simple seconds (< 60)', () => {
		const result = secondsToHms(30)
		assert.deepEqual(result, { hours: 0, minutes: 0, seconds: 30 })
	})

	it('converts minutes and seconds', () => {
		const result = secondsToHms(125) // 2 min 5 sec
		assert.deepEqual(result, { hours: 0, minutes: 2, seconds: 5 })
	})

	it('converts hours, minutes, and seconds', () => {
		const result = secondsToHms(3661) // 1 hour 1 min 1 sec
		assert.deepEqual(result, { hours: 1, minutes: 1, seconds: 1 })
	})

	it('converts large durations (multiple hours)', () => {
		const result = secondsToHms(36000) // 10 hours
		assert.deepEqual(result, { hours: 10, minutes: 0, seconds: 0 })
	})

	it('handles fractional seconds (truncates)', () => {
		const result = secondsToHms(125.9)
		assert.deepEqual(result, { hours: 0, minutes: 2, seconds: 5 })
	})

	it('handles negative input (clamps to zero)', () => {
		const result = secondsToHms(-100)
		assert.deepEqual(result, { hours: 0, minutes: 0, seconds: 0 })
	})

	it('handles null/undefined (treats as zero)', () => {
		assert.deepEqual(secondsToHms(null), { hours: 0, minutes: 0, seconds: 0 })
		assert.deepEqual(secondsToHms(undefined), { hours: 0, minutes: 0, seconds: 0 })
	})

	it('handles 59:59 edge case', () => {
		const result = secondsToHms(3599) // 59 min 59 sec
		assert.deepEqual(result, { hours: 0, minutes: 59, seconds: 59 })
	})

	it('handles 99:59:59 (near max)', () => {
		const result = secondsToHms(359999) // 99 hours 59 min 59 sec
		assert.deepEqual(result, { hours: 99, minutes: 59, seconds: 59 })
	})
})

describe('WO-186 — hmsToSeconds', () => {
	it('converts zero time', () => {
		assert.equal(hmsToSeconds(0, 0, 0), 0)
	})

	it('converts seconds only', () => {
		assert.equal(hmsToSeconds(0, 0, 30), 30)
	})

	it('converts minutes and seconds', () => {
		assert.equal(hmsToSeconds(0, 2, 5), 125)
	})

	it('converts hours, minutes, and seconds', () => {
		assert.equal(hmsToSeconds(1, 1, 1), 3661)
	})

	it('converts large durations (multiple hours)', () => {
		assert.equal(hmsToSeconds(10, 0, 0), 36000)
	})

	it('clamps hours to 0-99', () => {
		assert.equal(hmsToSeconds(150, 0, 0), 99 * 3600) // Clamped to 99
		assert.equal(hmsToSeconds(-5, 0, 0), 0) // Clamped to 0
	})

	it('clamps minutes to 0-59', () => {
		assert.equal(hmsToSeconds(0, 75, 0), 59 * 60) // Clamped to 59
		assert.equal(hmsToSeconds(0, -5, 0), 0) // Clamped to 0
	})

	it('clamps seconds to 0-59', () => {
		assert.equal(hmsToSeconds(0, 0, 75), 59) // Clamped to 59
		assert.equal(hmsToSeconds(0, 0, -5), 0) // Clamped to 0
	})

	it('handles fractional input (truncates)', () => {
		assert.equal(hmsToSeconds(1.9, 2.9, 3.9), 1 * 3600 + 2 * 60 + 3)
	})

	it('handles null/undefined (treats as zero)', () => {
		assert.equal(hmsToSeconds(null, null, null), 0)
		assert.equal(hmsToSeconds(undefined, undefined, undefined), 0)
		assert.equal(hmsToSeconds(1, null, 5), 1 * 3600 + 5)
	})

	it('handles max values: 99:59:59', () => {
		assert.equal(hmsToSeconds(99, 59, 59), 99 * 3600 + 59 * 60 + 59)
	})
})

describe('WO-186 — round-trip conversion', () => {
	it('round-trips secondsToHms → hmsToSeconds for typical durations', () => {
		const testCases = [0, 1, 30, 60, 125, 3661, 36000, 359999]
		for (const secs of testCases) {
			const hms = secondsToHms(secs)
			const roundTrip = hmsToSeconds(hms.hours, hms.minutes, hms.seconds)
			assert.equal(roundTrip, secs, `Round-trip failed for ${secs}`)
		}
	})

	it('round-trips hmsToSeconds → secondsToHms for typical times', () => {
		const testCases = [
			[0, 0, 0],
			[1, 2, 3],
			[10, 30, 45],
			[99, 59, 59],
		]
		for (const [h, m, s] of testCases) {
			const secs = hmsToSeconds(h, m, s)
			const hms = secondsToHms(secs)
			assert.deepEqual(hms, { hours: h, minutes: m, seconds: s }, `Round-trip failed for ${h}:${m}:${s}`)
		}
	})
})
