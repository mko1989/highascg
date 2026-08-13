'use strict'

/**
 * WO-504 — the boot identification card must never land on the operator-GUI channel.
 *
 * Owner 13.08 (`todos13.08.26`): *"after reboot the operator ch starts with a test card on. then
 * needs me to enable and disable the tick for that screen in test card setup for it to disapper.
 * shouldnt happen at all."*
 *
 * `channelsForLedTestOutput` selected on `hasScreen || hasDecklinkOutput`. The operator-GUI channel
 * is a CEF surface displayed through a screen consumer (WO-243), so it matched `hasScreen` and got
 * the card painted on layer 999 like a program output. Auto-clear on Web-UI connect is a deliberate
 * no-op (the card must survive on real outputs until an operator dismisses it), so on the operator
 * channel it covered the UI after every reboot until the owner ticked/un-ticked that screen.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { channelsForLedTestOutput } = require('../../src/bootstrap/startup-led-test-pattern.js')

/** ch5 is the operator GUI: one operator_gui destination after four mains. */
function configWithOperatorGui() {
	return {
		screenDestinations: {
			version: 1,
			destinations: [
				{ id: 'd1', mode: 'pgm_prv', label: 'PGM/PRV 1', videoMode: '1080p5000', mainScreenIndex: 0 },
				{ id: 'd2', mode: 'pgm_only', label: 'PGM 2', videoMode: '1080p5000', mainScreenIndex: 1 },
				{ id: 'dog', mode: 'operator_gui', label: 'Operator GUI', videoMode: '1080p5000', mainScreenIndex: 0 },
			],
		},
	}
}

const CHANNELS = [
	{ index: 1, hasScreen: true, hasDecklinkOutput: false },
	{ index: 2, hasScreen: false, hasDecklinkOutput: false },
	{ index: 3, hasScreen: true, hasDecklinkOutput: true },
	{ index: 4, hasScreen: false, hasDecklinkOutput: true },
	{ index: 5, hasScreen: true, hasDecklinkOutput: false },
]

test('WO-504: the operator-GUI channel is excluded from the boot card', () => {
	const cfg = configWithOperatorGui()
	const { getChannelMap } = require('../../src/config/routing-map.js')
	const og = getChannelMap(cfg).operatorGuiChannels || []
	assert.ok(og.length > 0, 'fixture must actually allocate an operator_gui channel')

	const picked = channelsForLedTestOutput(CHANNELS, cfg).map((c) => c.index)
	for (const ch of og) {
		assert.ok(
			!picked.includes(ch),
			`THE BUG: operator channel ${ch} would get the boot card. picked=${JSON.stringify(picked)}`,
		)
	}
})

test('WO-504: every other real output still gets the card', () => {
	const cfg = configWithOperatorGui()
	const { getChannelMap } = require('../../src/config/routing-map.js')
	const og = new Set(getChannelMap(cfg).operatorGuiChannels || [])
	const picked = channelsForLedTestOutput(CHANNELS, cfg).map((c) => c.index)

	// Derived, not hardcoded: which channel the map allocates to operator_gui depends on how many
	// mains precede it, and pinning a literal index here would only test the fixture.
	const expected = CHANNELS.filter((c) => (c.hasScreen || c.hasDecklinkOutput) && !og.has(c.index)).map((c) => c.index)
	assert.deepEqual(picked, expected, 'exactly the non-operator outputs')
	assert.ok(expected.length > 0, 'the fixture must leave some real outputs to identify')
	assert.ok(!picked.includes(2), 'a channel with no output must never be picked')
})

test('WO-504: with no config nothing is excluded (pre-WO-504 behaviour preserved)', () => {
	const picked = channelsForLedTestOutput(CHANNELS).map((c) => c.index)
	assert.deepEqual(picked, [1, 3, 4, 5], 'absent config must not silently drop outputs')
})

test('WO-504: a config with no operator_gui destination excludes nothing', () => {
	const cfg = {
		screenDestinations: {
			version: 1,
			destinations: [{ id: 'd1', mode: 'pgm_prv', label: 'PGM/PRV 1', videoMode: '1080p5000', mainScreenIndex: 0 }],
		},
	}
	const picked = channelsForLedTestOutput(CHANNELS, cfg).map((c) => c.index)
	assert.deepEqual(picked, [1, 3, 4, 5])
})
