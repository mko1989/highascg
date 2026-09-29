'use strict'

/**
 * WO-573 — `resolveScreenDimsFromTopology` must never let `operator_gui` win a real screen's
 * topology lookup.
 *
 * WO-573 root-caused DP-2 staying at EDID 1920x1080@60 instead of the configured 5760x1728@50:
 * `resolveScreenDimsFromTopology` (os-layout-calculator-helpers.js) filtered destinations with an
 * inline `mode !== 'multiview' && mode !== 'stream'` check that did NOT exclude `operator_gui`.
 * `dst_operator_gui` always carries a `mainScreenIndex` (a placement hint per
 * `isMainBusDestinationMode`'s doc, not a main-bus claim) — when that value collided with a real
 * screen's `mainScreenIndex` and operator_gui was listed first, `Array.prototype.find` silently
 * handed the real screen operator_gui's 1920x1080 dims instead of its own.
 *
 * WO-573's actual fix was config-only (move operator_gui's mainScreenIndex to 2, off 0/1) —
 * effective, but the collision remains one bad `mainScreenIndex` edit away from recurring. This
 * test pins the code-level fix: the topology lookup now uses the canonical
 * `isMainBusDestinationMode` (screen-destinations.js), which already excludes `operator_gui`.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { resolveScreenDimsFromTopology, resolveMultiviewDimsFromTopology } = require('../../src/utils/os-layout-calculator-helpers.js')

function configWithDestinations(destinations) {
	return { screenDestinations: { destinations } }
}

/** `normalizeDestination` only keeps raw width/height when videoMode is 'custom' — otherwise it
 * overwrites them from the preset (defaults to 1080p5000's 1920x1080), same as every real
 * screen_destinations.json entry with a non-standard raster (see config/screen_destinations.json). */
function customDest(id, mode, mainScreenIndex, width, height) {
	return { id, mode, mainScreenIndex, videoMode: 'custom', width, height }
}

test('WO-573: operator_gui colliding on mainScreenIndex 0, listed FIRST, must not win screen 1 dims', () => {
	const config = configWithDestinations([
		customDest('dst_operator_gui', 'operator_gui', 0, 1920, 1080),
		customDest('dst_main', 'pgm_only', 0, 5760, 1728),
	])
	const dims = resolveScreenDimsFromTopology(config, 1)
	assert.deepEqual(dims, { width: 5760, height: 1728 }, 'the real screen must win, not operator_gui')
})

test('WO-573: same collision, operator_gui listed SECOND — must still not win (regression against order-dependence)', () => {
	const config = configWithDestinations([
		customDest('dst_main', 'pgm_only', 0, 5760, 1728),
		customDest('dst_operator_gui', 'operator_gui', 0, 1920, 1080),
	])
	const dims = resolveScreenDimsFromTopology(config, 1)
	assert.deepEqual(dims, { width: 5760, height: 1728 })
})

test('WO-573: current live-config shape (operator_gui parked at index 2) still resolves both real screens correctly', () => {
	const config = configWithDestinations([
		customDest('dst_operator_gui', 'operator_gui', 2, 1920, 1080),
		customDest('dst_main', 'pgm_only', 1, 5760, 1728),
		customDest('dst_kolko', 'pgm_only', 0, 1920, 2304),
	])
	assert.deepEqual(resolveScreenDimsFromTopology(config, 1), { width: 1920, height: 2304 })
	assert.deepEqual(resolveScreenDimsFromTopology(config, 2), { width: 5760, height: 1728 })
})

test('WO-573: a screen index with no real destination (only operator_gui at that index) resolves to null, not operator_gui dims', () => {
	const config = configWithDestinations([customDest('dst_operator_gui', 'operator_gui', 0, 1920, 1080)])
	assert.equal(resolveScreenDimsFromTopology(config, 1), null)
})

test('WO-573: resolveMultiviewDimsFromTopology was never affected — operator_gui has its own mode, not "multiview"', () => {
	const config = configWithDestinations([
		customDest('dst_operator_gui', 'operator_gui', 0, 1920, 1080),
		customDest('dst_mv', 'multiview', 0, 3840, 1080),
	])
	assert.deepEqual(resolveMultiviewDimsFromTopology(config, 1), { width: 3840, height: 1080 })
})
