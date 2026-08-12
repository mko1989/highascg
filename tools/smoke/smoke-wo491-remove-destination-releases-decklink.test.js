'use strict'

/**
 * WO-491 — deleting a destination must release the DeckLink it was cabled to.
 *
 * Cabling a DeckLink to a destination (`applyDecklinkOutputOnDestinationEdge`) writes TWO pieces of
 * POSITIONAL state: `connector.caspar.outputBinding = { type: 'screen', index: mainScreenIndex + 1 }`
 * and `casparServer.screen_N_decklink_device`. Removing the destination pruned only the graph EDGE
 * (`pruneDestinationFromGraph` drops the destination's own connectors), so both survived.
 *
 * That matters because `normalizeScreenDestinations` COMPACTS `mainScreenIndex`: delete the
 * destination at index 0 and the one at index 1 slides down into index 0 — i.e. into `screen_1` —
 * and inherits a DeckLink output it was never cabled to. The generator re-asserts it from the
 * connector's stale `outputBinding` even after the flat key is cleared, so both have to go.
 *
 * This is the deletion half of WO-275, which only released a device when some OTHER target claimed
 * it. Nothing claims a deleted destination's DeckLink, so it stayed bound forever.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const defaults = require('../../src/config/defaults')
const CRUD = require('../../src/api/device-view-crud')
const { buildConfigXml } = require('../../src/config/config-generator')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')

function mockConfigManager(initial) {
	let store = JSON.parse(JSON.stringify(initial))
	return { get: () => store, save: (next) => { store = next } }
}

/** Two PGM/PRV destinations; DeckLink 3 cabled to the FIRST one, exactly as the UI would leave it. */
function configWithDecklinkOnFirstDestination() {
	return {
		screenDestinations: {
			version: 1,
			destinations: [
				{ id: 'dst_a', label: 'PGM 1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
				{ id: 'dst_b', label: 'PGM 2', mainScreenIndex: 1, mode: 'pgm_prv', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
			],
		},
		deviceGraph: {
			version: 1,
			devices: [
				{ id: 'caspar_host', role: 'caspar_host', label: 'Caspar / HighAsCG host' },
				{ id: 'destinations', role: 'destinations', label: 'Screen destinations' },
			],
			connectors: [
				{ id: 'dst_in_a', deviceId: 'destinations', kind: 'destination_in', externalRef: 'dst_a' },
				{ id: 'dst_in_b', deviceId: 'destinations', kind: 'destination_in', externalRef: 'dst_b' },
				{
					id: 'dlsdi_3',
					deviceId: 'caspar_host',
					kind: 'decklink_io',
					externalRef: '3',
					// What cabling to dst_a leaves behind — note the POSITIONAL index.
					caspar: { ioDirection: 'out', outputBinding: { type: 'screen', index: 1 }, bus: 'pgm', mainIndex: 0 },
				},
			],
			edges: [{ id: 'e1', sourceId: 'dst_in_a', sinkId: 'dlsdi_3' }],
		},
		casparServer: {
			...defaults.casparServer,
			screen_count: 2,
			multiview_enabled: false,
			decklink_input_count: 0,
			live_audio_input_count: 0,
			screen_1_decklink_device: 3,
			screen_1_decklink_replace_screen: false,
		},
	}
}

/** Full app shape the generator expects, from a post-mutation ctx.config. */
function generatorAppFrom(config) {
	const app = JSON.parse(JSON.stringify(defaults))
	app.casparServer = { ...app.casparServer, ...config.casparServer }
	app.screenDestinations = config.screenDestinations
	app.deviceGraph = config.deviceGraph
	app.streamingChannel = { enabled: false }
	app.rtmp = { enabled: false }
	return app
}

function decklinkConsumersOnDevice(xml, device) {
	return [...xml.matchAll(/<decklink>[\s\S]*?<\/decklink>/g)]
		.map((m) => m[0])
		.filter((b) => new RegExp(`<device>${device}</device>`).test(b))
}

test('WO-491: removing the destination that owned a DeckLink releases the flat screen binding', () => {
	const config = configWithDecklinkOnFirstDestination()
	const ctx = { config, configManager: mockConfigManager(config), log: () => {} }

	const res = CRUD.handleRemoveDestination({ removeDestination: { id: 'dst_a' } }, ctx)
	assert.equal(res.ok, true)

	assert.equal(
		parseInt(String(ctx.config.casparServer.screen_1_decklink_device || '0'), 10) || 0,
		0,
		'screen_1 must not keep pointing at DeckLink 3 once its destination is gone',
	)
})

test('WO-491: the DeckLink connector loses its stale positional outputBinding', () => {
	const config = configWithDecklinkOnFirstDestination()
	const ctx = { config, configManager: mockConfigManager(config), log: () => {} }

	CRUD.handleRemoveDestination({ removeDestination: { id: 'dst_a' } }, ctx)

	const dl = (ctx.config.deviceGraph.connectors || []).find((c) => String(c?.id) === 'dlsdi_3')
	assert.ok(dl, 'the physical DeckLink connector itself must survive — only its binding goes')
	assert.equal(
		dl.caspar?.outputBinding ?? null,
		null,
		'a binding created by cabling to dst_a is meaningless once dst_a is deleted; leaving it lets the generator re-assert screen_1',
	)
})

test('WO-491: the surviving destination does not inherit the deleted one\'s DeckLink', () => {
	const config = configWithDecklinkOnFirstDestination()
	const ctx = { config, configManager: mockConfigManager(config), log: () => {} }

	CRUD.handleRemoveDestination({ removeDestination: { id: 'dst_a' } }, ctx)

	// dst_b compacted from mainScreenIndex 1 into 0 — i.e. it is now screen_1.
	const survivor = ctx.config.screenDestinations.destinations.find((d) => d.id === 'dst_b')
	assert.ok(survivor, 'dst_b must survive')
	assert.equal(survivor.mainScreenIndex, 0, 'compaction moved dst_b into the slot dst_a vacated')

	const xml = buildConfigXml(buildCasparGeneratorFlatConfig(generatorAppFrom(ctx.config)))
	assert.equal(
		decklinkConsumersOnDevice(xml, 3).length,
		0,
		'nothing is cabled to DeckLink 3 any more, so no <decklink> consumer may be emitted on it',
	)
})

test('WO-491: a DeckLink cabled to a destination that SURVIVES is left completely alone', () => {
	const config = configWithDecklinkOnFirstDestination()
	const ctx = { config, configManager: mockConfigManager(config), log: () => {} }

	// Delete the OTHER destination — the one with no DeckLink.
	const res = CRUD.handleRemoveDestination({ removeDestination: { id: 'dst_b' } }, ctx)
	assert.equal(res.ok, true)

	assert.equal(
		parseInt(String(ctx.config.casparServer.screen_1_decklink_device || '0'), 10) || 0,
		3,
		'dst_a still owns DeckLink 3 — removing an unrelated destination must not release it',
	)
	const dl = (ctx.config.deviceGraph.connectors || []).find((c) => String(c?.id) === 'dlsdi_3')
	assert.deepEqual(dl.caspar?.outputBinding, { type: 'screen', index: 1 }, 'binding must survive')

	const xml = buildConfigXml(buildCasparGeneratorFlatConfig(generatorAppFrom(ctx.config)))
	assert.equal(decklinkConsumersOnDevice(xml, 3).length, 1, 'dst_a keeps its one DeckLink consumer')
})
