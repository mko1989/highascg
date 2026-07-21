'use strict'

/**
 * The owner's box after building a real rig on the factory default: operator_gui at
 * mainScreenIndex 0, then Add-destination created pgm_prv at 1 and pgm_only at 2 — because the Add
 * button counted the operator_gui when picking the next slot, even though WO-243 says it never
 * occupies one. Screen count is max(index)+1, so index 0 was a hole and the generator emitted a
 * Screen 1 PGM+PRV pair no destination stood behind ("i still get these fucking stale channels").
 *
 * Two-sided fix: normalizeScreenDestinations compacts MAIN indices to dense 0..n-1 (heals stored
 * configs), and the client Add button counts main destinations only (stops creating new gaps).
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const defaults = require('../../src/config/defaults')
const { normalizeScreenDestinations } = require('../../src/config/screen-destinations')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const { buildConfigXml } = require('../../src/config/config-generator')

/** The owner's exact destination shape (ids shortened). */
function ownerDestinations() {
	return [
		{ id: 'gui', label: 'Operator GUI', mode: 'operator_gui', mainScreenIndex: 0, width: 1920, height: 1080, fps: 50 },
		{ id: 'main_a', label: 'PGM 1', mode: 'pgm_prv', mainScreenIndex: 1, videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
		{ id: 'main_b', label: 'PGM 2', mode: 'pgm_only', mainScreenIndex: 2, videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
	]
}

test('normalize compacts main indices across the operator_gui gap', () => {
	const out = normalizeScreenDestinations({ version: 1, destinations: ownerDestinations(), edidNotes: '' })
	const byId = Object.fromEntries(out.destinations.map((d) => [d.id, d]))
	assert.equal(byId.main_a.mainScreenIndex, 0, 'first real main takes the hole at 0')
	assert.equal(byId.main_b.mainScreenIndex, 1)
	assert.equal(byId.gui.mainScreenIndex, 0, 'non-main placement hint is left untouched')
})

test('generator emits no phantom pair for the owner exact config', () => {
	const app = JSON.parse(JSON.stringify(defaults))
	app.screenDestinations = { version: 1, destinations: ownerDestinations(), edidNotes: '' }
	app.casparServer = { ...app.casparServer, screen_count: 3, multiview_enabled: false, decklink_input_count: 0 }
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	app.deviceGraph = {
		version: 1,
		devices: [],
		connectors: [
			{ id: 'dst_in_gui', kind: 'destination_in', externalRef: 'gui' },
			{ id: 'dst_in_main_a', kind: 'destination_in', externalRef: 'main_a' },
			{ id: 'dst_in_main_b', kind: 'destination_in', externalRef: 'main_b' },
			{ id: 'gpu_p0', kind: 'gpu_out' },
			{ id: 'gpu_p2', kind: 'gpu_out' },
			{ id: 'dlsdi_3', kind: 'decklink_out' },
		],
		edges: [
			{ sourceId: 'dst_in_gui', sinkId: 'gpu_p2' },
			{ sourceId: 'dst_in_main_a', sinkId: 'gpu_p0' },
			{ sourceId: 'dst_in_main_b', sinkId: 'dlsdi_3' },
		],
	}

	const xml = buildConfigXml(buildCasparGeneratorFlatConfig(app))
	const chans = (xml.match(/HighAsCG: Caspar channel \d+: [^\n—]*/g) || []).map((s) => s.trim())

	assert.equal(
		chans.filter((c) => c.includes('program output (PGM)')).length,
		2,
		`exactly the two REAL mains — got:\n  ${chans.join('\n  ')}`,
	)
	assert.ok(!chans.some((c) => c.includes('Screen 3')), 'no Screen 3 — the gap must not inflate the count')
	assert.equal(chans.filter((c) => c.includes('preview output (PRV)')).length, 1, 'one PRV (pgm_prv only; pgm_only has none)')
	assert.equal(chans.filter((c) => c.includes('Operator GUI')).length, 1)
})

test('Add button skips non-main destinations when picking the next slot', async () => {
	const mod = await import(
		'file://' + path.join(__dirname, '..', '..', 'client', 'lib', 'screen-destination-index.js')
	)
	// Factory default: only the operator GUI exists. First real screen must take slot 0.
	assert.equal(mod.nextMainScreenIndex([{ mode: 'operator_gui', mainScreenIndex: 0 }], 'pgm_prv'), 0)
	// A main already at 0 → next is 1, and utility modes never take a slot.
	assert.equal(
		mod.nextMainScreenIndex(
			[{ mode: 'operator_gui', mainScreenIndex: 0 }, { mode: 'pgm_prv', mainScreenIndex: 0 }],
			'pgm_only',
		),
		1,
	)
	assert.equal(mod.nextMainScreenIndex([{ mode: 'pgm_prv', mainScreenIndex: 0 }], 'multiview'), 0)
	assert.equal(mod.nextMainScreenIndex([], 'pgm_prv'), 0)
})
