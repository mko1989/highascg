'use strict'

/**
 * WO-515 — Apply must tell the operator when a layout cannot physically work.
 *
 * Owner 13.08, after replicating the .37 config onto the dev box: *"i lost the gui and looking at
 * signals coming into switcher it has wrong resolutions."* Measured on that box: a 6144x1536
 * always-on-top PGM screen consumer at 0,0 on a desktop that is only 5760x1080 (four 1920x1080
 * outputs), covering the operator GUI at 3840,0. Apply produced that silently.
 *
 * Also re-homes WO-507's DeckLink warnings. They were written to `config.__generatorWarn`, which
 * nothing ever set — dead code from the day they were written. The guard worked, but a dropped SDI
 * output with no explanation is the same silent-config failure the guard exists to prevent.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

const {
	screenRectsFromConfig,
	collectScreenLayoutWarnings,
	collectDecklinkBindingWarnings,
} = require('../../src/config/screen-layout-guard.js')

/** The dev box, reproduced: 6144x1536 PGM over a 5760x1080 desktop, GUI at 3840. */
function devBoxConfig() {
	return {
		screen_1_custom_width: 6144,
		screen_1_custom_height: 1536,
		screen_1_x: 0,
		screen_1_y: 0,
		screen_1_device: 1,
		screen_3_custom_width: 1920,
		screen_3_custom_height: 1080,
		screen_3_x: 3840,
		screen_3_y: 0,
		screen_3_device: 1,
	}
}

test('WO-515: a screen extending past the desktop is reported', () => {
	const w = collectScreenLayoutWarnings(devBoxConfig(), { desktop: { width: 5760, height: 1080 } })
	assert.ok(
		w.some((m) => /Screen 1 .*extends past the 5760x1080 desktop/.test(m)),
		`expected a desktop-overrun warning, got ${JSON.stringify(w)}`,
	)
})

test('WO-515: two screens overlapping on one device is reported', () => {
	const w = collectScreenLayoutWarnings(devBoxConfig(), { desktop: { width: 5760, height: 1080 } })
	assert.ok(
		w.some((m) => /Screen 1 and screen 3 overlap on display device 1/.test(m)),
		`the operator GUI was hidden under the PGM window; got ${JSON.stringify(w)}`,
	)
})

test('WO-515: overlap is NOT reported across different display devices', () => {
	const cfg = devBoxConfig()
	cfg.screen_3_device = 2
	const w = collectScreenLayoutWarnings(cfg, {})
	assert.ok(!w.some((m) => /overlap/.test(m)), 'separate X devices have separate coordinate spaces')
})

test('WO-515: an unknown desktop skips the extent check rather than guessing', () => {
	const w = collectScreenLayoutWarnings(devBoxConfig(), {})
	assert.ok(!w.some((m) => /extends past/.test(m)), 'no probe, no claim')
})

test('WO-515: a layout that fits produces no warnings at all', () => {
	const cfg = {
		screen_1_custom_width: 1920,
		screen_1_custom_height: 1080,
		screen_1_x: 0,
		screen_1_device: 1,
		screen_2_custom_width: 1920,
		screen_2_custom_height: 1080,
		screen_2_x: 1920,
		screen_2_device: 1,
	}
	assert.deepEqual(collectScreenLayoutWarnings(cfg, { desktop: { width: 3840, height: 1080 } }), [])
})

test('WO-515: screenRectsFromConfig ignores screens with no dimensions', () => {
	assert.deepEqual(screenRectsFromConfig({ screen_1_x: 10 }), [], 'a screen with no size is not a rect')
	assert.equal(screenRectsFromConfig(devBoxConfig()).length, 2)
})

test('WO-515: an output bound to an INPUT card is reported (WO-507, now visible)', () => {
	const cfg = { screen_1_decklink_device: 3 }
	const app = {
		deviceGraph: {
			connectors: [
				{ id: 'dlsdi_1', kind: 'decklink_io', externalRef: '1', caspar: { ioDirection: 'out' } },
				{ id: 'dlsdi_3', kind: 'decklink_io', externalRef: '3', caspar: { ioDirection: 'in' } },
			],
		},
	}
	const w = collectDecklinkBindingWarnings(cfg, app)
	assert.ok(
		w.some((m) => /Screen 1 is bound to DeckLink 3, which is configured as an INPUT/.test(m)),
		`the drop must be explained, not silent; got ${JSON.stringify(w)}`,
	)
})

test('WO-515: one card claimed twice is reported (WO-509/514 made visible)', () => {
	const cfg = { screen_1_decklink_tiles: [{ device: 1 }], screen_2_decklink_device: 1 }
	const w = collectDecklinkBindingWarnings(cfg, { deviceGraph: { connectors: [] } })
	assert.ok(
		w.some((m) => /DeckLink 1 is claimed by .* and .*cannot open one card twice/.test(m)),
		`got ${JSON.stringify(w)}`,
	)
})

test('WO-515: a sane DeckLink layout warns about nothing', () => {
	const cfg = { screen_1_decklink_device: 1, screen_2_decklink_device: 2 }
	assert.deepEqual(collectDecklinkBindingWarnings(cfg, { deviceGraph: { connectors: [] } }), [])
})

test('WO-515: the guard is wired into the Apply plan and cannot break Apply', () => {
	const src = read('src/api/device-view-apply.js')
	assert.match(src, /collectScreenLayoutWarnings/, 'the plan must call the guard')
	assert.match(src, /collectDecklinkBindingWarnings/)
	// Warnings, not blockers: overlapping windows are legitimate (operator GUI under a PGM hole).
	assert.doesNotMatch(src, /blockers\.push\(\.\.\.collect/, 'the guard must never block an Apply')
	const guarded = /try \{[\s\S]*?collectScreenLayoutWarnings[\s\S]*?\} catch/.test(src)
	assert.ok(guarded, 'a throwing guard must not take down an Apply that would otherwise work')
})

test('WO-515: the dead __generatorWarn channel is gone', () => {
	const src = read('src/config/config-generator-consumer-attach-screen.js')
	assert.doesNotMatch(src, /__generatorWarn/, 'nothing ever set it — those warnings never fired')
})
