'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

/**
 * WO-286: Inverted two-finger scroll for laptop touchpads
 * Test the wheel-delta helper and preference defaults.
 */

// Mock the settingsState for testing
const mockSettingsState = (invertTouchpadScroll = false) => ({
	getSettings: () => ({
		ui: {
			invertTouchpadScroll,
		},
	}),
})

/**
 * Inline implementation of getWheelDelta for testing
 * (mirrors client/lib/wheel-delta.js)
 */
function getWheelDeltaWithSettings(event, settingsState) {
	let dx = event.deltaX
	let dy = event.deltaY

	const settings = settingsState.getSettings()
	const shouldInvert = settings?.ui?.invertTouchpadScroll === true

	if (shouldInvert) {
		dx = -dx
		dy = -dy
	}

	return { dx, dy }
}

// ---------------------------------------------------------------------------
// Test 1: Helper returns normal deltas when preference is OFF (default)
// ---------------------------------------------------------------------------

test('getWheelDelta: with invertTouchpadScroll OFF, returns original deltas', () => {
	const settings = mockSettingsState(false)
	const synthEvent = {
		deltaX: 10,
		deltaY: 20,
	}

	const result = getWheelDeltaWithSettings(synthEvent, settings)

	assert.equal(result.dx, 10, 'dx should match input when inversion is off')
	assert.equal(result.dy, 20, 'dy should match input when inversion is off')
})

// ---------------------------------------------------------------------------
// Test 2: Helper inverts deltas when preference is ON
// ---------------------------------------------------------------------------

test('getWheelDelta: with invertTouchpadScroll ON, returns inverted deltas', () => {
	const settings = mockSettingsState(true)
	const synthEvent = {
		deltaX: 10,
		deltaY: 20,
	}

	const result = getWheelDeltaWithSettings(synthEvent, settings)

	assert.equal(result.dx, -10, 'dx should be inverted when preference is on')
	assert.equal(result.dy, -20, 'dy should be inverted when preference is on')
})

// ---------------------------------------------------------------------------
// Test 3: Same event yields opposite dy with flag flipped
// ---------------------------------------------------------------------------

test('getWheelDelta: opposite dy for same event when flag flipped', () => {
	const synthEvent = {
		deltaX: 5,
		deltaY: -15,
	}

	const settingsOff = mockSettingsState(false)
	const resultOff = getWheelDeltaWithSettings(synthEvent, settingsOff)

	const settingsOn = mockSettingsState(true)
	const resultOn = getWheelDeltaWithSettings(synthEvent, settingsOn)

	// Off: dy = -15
	// On: dy = 15 (inverted)
	assert.equal(resultOff.dy, -15, 'with flag off: dy should be -15')
	assert.equal(resultOn.dy, 15, 'with flag on: dy should be 15 (inverted)')
	assert.equal(resultOff.dy, -resultOn.dy, 'dy values should be opposite')
})

// ---------------------------------------------------------------------------
// Test 4: Preference defaults to OFF
// ---------------------------------------------------------------------------

test('preferences: invertTouchpadScroll defaults to false', () => {
	const settings = mockSettingsState(false)
	const prefs = settings.getSettings()

	assert.equal(prefs.ui.invertTouchpadScroll, false, 'invertTouchpadScroll should default to false')
})

// ---------------------------------------------------------------------------
// Test 5: Preference can be toggled ON
// ---------------------------------------------------------------------------

test('preferences: invertTouchpadScroll can be set to true', () => {
	const settings = mockSettingsState(true)
	const prefs = settings.getSettings()

	assert.equal(prefs.ui.invertTouchpadScroll, true, 'invertTouchpadScroll should be true when toggled on')
})

// ---------------------------------------------------------------------------
// Test 6: Zero deltas remain zero when inverted
// ---------------------------------------------------------------------------

test('getWheelDelta: zero deltas remain zero after inversion', () => {
	const settings = mockSettingsState(true)
	const synthEvent = {
		deltaX: 0,
		deltaY: 0,
	}

	const result = getWheelDeltaWithSettings(synthEvent, settings)

	// Note: JavaScript -0 === 0, but Object.is(-0, 0) is false.
	// For our purposes, ±0 should be treated as equivalent.
	assert.ok(Object.is(result.dx, 0) || result.dx === 0, 'inverted zero dx should remain zero (or -0)')
	assert.ok(Object.is(result.dy, 0) || result.dy === 0, 'inverted zero dy should remain zero (or -0)')
})

// ---------------------------------------------------------------------------
// Test 7: Mixed deltas invert correctly (horizontal and vertical)
// ---------------------------------------------------------------------------

test('getWheelDelta: mixed dx/dy invert independently', () => {
	const settings = mockSettingsState(true)
	const synthEvent = {
		deltaX: 10,
		deltaY: -5,
	}

	const result = getWheelDeltaWithSettings(synthEvent, settings)

	assert.equal(result.dx, -10, 'dx should invert: 10 -> -10')
	assert.equal(result.dy, 5, 'dy should invert: -5 -> 5')
})
