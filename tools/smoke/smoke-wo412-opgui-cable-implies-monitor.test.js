'use strict'

/**
 * WO-412 smoke — "when connecting operator gui to an output that output needs to
 * automatically enable operator monitor and disable always on top" (owner 03.08).
 *
 * The implied flags existed but were stamped on the MERGED generator config only
 * (`applyPhysicalPortConsumerFlagsToScreens`) — the APP config that the runtime display
 * session, kiosk placement and the Device-View tick read never got them, so the tick
 * stayed manual. `deriveOperatorGuiAppConfigPortFlags` derives the app-config patch and
 * the full-apply flow persists it.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const { deriveOperatorGuiAppConfigPortFlags } = require('../../src/config/screen-consumer-port-resolve')

test('WO-412: operator-GUI cable to gpu_p2 → port 3 single-select monitor + stacking flags', () => {
	const fixture = {
		screenDestinations: { destinations: [{ id: 'opgui', mode: 'operator_gui', mainScreenIndex: 0 }] },
		deviceGraph: {
			connectors: [
				{ id: 'dst_in_opgui', kind: 'destination_in', externalRef: 'opgui' },
				{ id: 'gpu_p2', kind: 'gpu_out' },
			],
			edges: [{ sourceId: 'dst_in_opgui', sinkId: 'gpu_p2' }],
		},
	}
	const { patch, guiPort } = deriveOperatorGuiAppConfigPortFlags(fixture)
	assert.equal(guiPort, 3)
	// Single-select — mirrors the inspector's own 1..4 loop, so a port that USED to carry
	// the GUI gets its operator_monitor flag cleared when the cable moves.
	assert.deepEqual(
		[1, 2, 3, 4].map((p) => patch[`screen_${p}_operator_monitor`]),
		[false, false, true, false],
	)
	assert.equal(patch.screen_3_always_on_top, false, 'consumer must stack BELOW Firefox (WO-263)')
	assert.equal(patch.screen_3_interactive, true, 'holes must pass pointer events through')
})

test('WO-412: no operator-GUI cable → no patch (never clobbers manual choices)', () => {
	assert.deepEqual(deriveOperatorGuiAppConfigPortFlags({}), { patch: {}, guiPort: null })
	const uncabled = {
		screenDestinations: { destinations: [{ id: 'opgui', mode: 'operator_gui', mainScreenIndex: 0 }] },
		deviceGraph: { connectors: [], edges: [] },
	}
	assert.deepEqual(deriveOperatorGuiAppConfigPortFlags(uncabled), { patch: {}, guiPort: null })
})

test('WO-412: full apply persists the patch into the app config', () => {
	const apply = read('src/utils/full-config-apply.js')
	assert.match(apply, /deriveOperatorGuiAppConfigPortFlags\(ctx\.config\)/, 'derived from the app config on every Apply')
	assert.match(apply, /ctx\.configManager\.save\(\{ \.\.\.ctx\.configManager\.get\(\), casparServer: cs \}\)/, 'persisted, not just in-memory')
})
