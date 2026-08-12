'use strict'

/**
 * WO-494 — deleting a pixel-mapping node must release the DeckLinks it fed.
 *
 * Owner 12.08: "i had a pixelmapping node connected to screen dest 1 and decklink 1 and 2, when i
 * removed the pixelmapping node, the decklink out 2 still was present in the caspar config".
 *
 * Same class as WO-491, one level worse: `handleRemoveDestination` at least existed as a place to
 * hook the release into, whereas deleting a mapping node had NO server handler at all — the client
 * rewrote the graph and POSTed the whole thing, landing in the generic `j.deviceGraph` branch which
 * only persists. Nothing released the DeckLink bindings.
 *
 * Why it stays hidden until the node goes: `screen_N_decklink_tiles` is generate-time only
 * (`pixel-mapping-config.js` writes it into `merged` and `delete`s `screen_N_decklink_device` on the
 * same pass), and the DeckLink projection refuses to touch a tiled screen. So while the node exists
 * the stale flat key is masked. Remove the node and the mask goes with it.
 *
 * Why DeckLink 2 and not 1: a mapping node's outputs are subregions of ONE program channel, so both
 * ports carry `outputBinding {type:'screen', index:1}` and collide on the single
 * `screen_1_decklink_device` slot — last writer wins.
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

const NODE = 'mapping_x1'

/**
 * Destination -> pixel-mapping node -> DeckLink 1 + DeckLink 2, exactly the owner's shape.
 * NB the destination connector id must be `dst_in_${destId}` — `resolvePixelMapFeedToProgramScreen`
 * resolves the feed by SLICING the id, not by reading `externalRef`.
 */
function configWithMappingNodeOnTwoDecklinks() {
	const decklink = (id, dev) => ({
		id,
		deviceId: 'caspar_host',
		kind: 'decklink_io',
		externalRef: String(dev),
		// What marking the port as an output leaves behind — POSITIONAL, and identical on both.
		caspar: { ioDirection: 'out', outputBinding: { type: 'screen', index: 1 }, bus: 'pgm', mainIndex: 0 },
	})
	return {
		screenDestinations: {
			version: 1,
			destinations: [
				{ id: 'dst_a', label: 'Screen 1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '1080p5000', width: 3840, height: 1080, fps: 50 },
			],
		},
		deviceGraph: {
			version: 1,
			devices: [
				{ id: 'caspar_host', role: 'caspar_host', label: 'Caspar / HighAsCG host' },
				{ id: 'destinations', role: 'destinations', label: 'Screen destinations' },
				{
					id: NODE,
					role: 'pixel_mapping',
					label: 'Pixel Mapping 1',
					settings: {
						numOutputs: 2,
						outputs: [
							{ id: 'out_1', mode: '1080p5000', label: 'Output 1' },
							{ id: 'out_2', mode: '1080p5000', label: 'Output 2' },
						],
						mappings: [
							{ outputId: 'out_1', srcX: 0, srcY: 0, width: 1920, height: 1080 },
							{ outputId: 'out_2', srcX: 1920, srcY: 0, width: 1920, height: 1080 },
						],
					},
				},
			],
			connectors: [
				{ id: 'dst_in_dst_a', deviceId: 'destinations', kind: 'destination_in', externalRef: 'dst_a' },
				{ id: `${NODE}_in`, deviceId: NODE, kind: 'pixel_map_in', label: 'Input Feed' },
				{ id: `${NODE}_out_1`, deviceId: NODE, kind: 'pixel_map_out', index: 0, label: 'Output 1' },
				{ id: `${NODE}_out_2`, deviceId: NODE, kind: 'pixel_map_out', index: 1, label: 'Output 2' },
				decklink('dlsdi_1', 1),
				decklink('dlsdi_2', 2),
			],
			edges: [
				{ id: 'e1', sourceId: 'dst_in_dst_a', sinkId: `${NODE}_in` },
				{ id: 'e2', sourceId: `${NODE}_out_1`, sinkId: 'dlsdi_1' },
				{ id: 'e3', sourceId: `${NODE}_out_2`, sinkId: 'dlsdi_2' },
			],
		},
		casparServer: {
			...defaults.casparServer,
			screen_count: 1,
			multiview_enabled: false,
			decklink_input_count: 0,
			live_audio_input_count: 0,
			// Both ports wrote this same slot; DeckLink 2 wrote last.
			screen_1_decklink_device: 2,
		},
	}
}

function generatorAppFrom(config) {
	const app = JSON.parse(JSON.stringify(defaults))
	app.casparServer = { ...app.casparServer, ...config.casparServer }
	app.screenDestinations = config.screenDestinations
	app.deviceGraph = config.deviceGraph
	app.streamingChannel = { enabled: false }
	app.rtmp = { enabled: false }
	return app
}

const decklinkConsumerDevices = (xml) =>
	[...xml.matchAll(/<decklink>[\s\S]*?<\/decklink>/g)]
		.map((m) => m[0])
		.flatMap((b) => [...b.matchAll(/<device>(\d+)<\/device>/g)].map((d) => parseInt(d[1], 10)))

test('WO-494 baseline: with the node wired, the DeckLinks are tiled and the flat key is masked', () => {
	const config = configWithMappingNodeOnTwoDecklinks()
	const flat = buildCasparGeneratorFlatConfig(generatorAppFrom(config))
	assert.equal(flat.screen_1_decklink_device, undefined, 'the tiles pass deletes the flat key at generate time')
	assert.ok(Array.isArray(flat.screen_1_decklink_tiles) && flat.screen_1_decklink_tiles.length === 2, 'two tiles')
	assert.deepEqual(
		decklinkConsumerDevices(buildConfigXml(flat)).sort(),
		[1, 2],
		'both cards appear, as one tiled consumer + synced port',
	)
})

test('WO-494: removing the node releases the flat screen binding', () => {
	const config = configWithMappingNodeOnTwoDecklinks()
	const ctx = { config, configManager: mockConfigManager(config), log: () => {} }

	const res = CRUD.handleRemoveMappingNode({ removeMappingNode: { id: NODE } }, ctx)
	assert.equal(res.ok, true, res.error || '')

	assert.equal(
		parseInt(String(ctx.config.casparServer.screen_1_decklink_device || '0'), 10) || 0,
		0,
		'nothing feeds these cards any more',
	)
})

test('WO-494: both DeckLink connectors lose their stale positional binding but survive as ports', () => {
	const config = configWithMappingNodeOnTwoDecklinks()
	const ctx = { config, configManager: mockConfigManager(config), log: () => {} }
	CRUD.handleRemoveMappingNode({ removeMappingNode: { id: NODE } }, ctx)

	for (const id of ['dlsdi_1', 'dlsdi_2']) {
		const c = (ctx.config.deviceGraph.connectors || []).find((x) => String(x?.id) === id)
		assert.ok(c, `${id} must survive — it is a physical port`)
		assert.equal(c.caspar?.outputBinding ?? null, null, `${id} must not keep a binding to a node that is gone`)
		assert.equal(c.caspar?.ioDirection, 'out', `${id} is still physically an output`)
	}
	assert.equal(
		(ctx.config.deviceGraph.devices || []).some((d) => String(d?.id) === NODE),
		false,
		'the node itself is gone',
	)
})

test('WO-494: no <decklink> consumer is emitted on EITHER card after removal', () => {
	const config = configWithMappingNodeOnTwoDecklinks()
	const ctx = { config, configManager: mockConfigManager(config), log: () => {} }
	CRUD.handleRemoveMappingNode({ removeMappingNode: { id: NODE } }, ctx)

	const xml = buildConfigXml(buildCasparGeneratorFlatConfig(generatorAppFrom(ctx.config)))
	assert.deepEqual(
		decklinkConsumerDevices(xml),
		[],
		'the owner saw DeckLink 2 survive here; DeckLink 1 must not survive either',
	)
})

test('WO-494 control: a DeckLink owned by a plain destination cable is left alone', () => {
	const config = configWithMappingNodeOnTwoDecklinks()
	// A third card cabled straight to the destination, nothing to do with the node.
	config.deviceGraph.connectors.push({
		id: 'dlsdi_5',
		deviceId: 'caspar_host',
		kind: 'decklink_io',
		externalRef: '5',
		caspar: { ioDirection: 'out', outputBinding: { type: 'screen', index: 1 } },
	})
	config.deviceGraph.edges.push({ id: 'e9', sourceId: 'dst_in_dst_a', sinkId: 'dlsdi_5' })

	const ctx = { config, configManager: mockConfigManager(config), log: () => {} }
	CRUD.handleRemoveMappingNode({ removeMappingNode: { id: NODE } }, ctx)

	const c = (ctx.config.deviceGraph.connectors || []).find((x) => String(x?.id) === 'dlsdi_5')
	assert.deepEqual(c.caspar?.outputBinding, { type: 'screen', index: 1 }, 'still cabled, still bound')

	const xml = buildConfigXml(buildCasparGeneratorFlatConfig(generatorAppFrom(ctx.config)))
	assert.deepEqual(decklinkConsumerDevices(xml), [5], 'DeckLink 5 keeps its consumer; 1 and 2 do not')
})

test('WO-494: an unknown node id is reported, not silently accepted', () => {
	const config = configWithMappingNodeOnTwoDecklinks()
	const ctx = { config, configManager: mockConfigManager(config), log: () => {} }
	const res = CRUD.handleRemoveMappingNode({ removeMappingNode: { id: 'nope' } }, ctx)
	assert.ok(res.error, 'a typo must not look like a successful delete')
})

test('WO-494: the client asks the server to remove the node instead of POSTing a whole graph', () => {
	const fs = require('fs')
	const path = require('path')
	const src = fs.readFileSync(path.resolve(__dirname, '../../client/lib/mapping-node-service.js'), 'utf8')
	const fn = src.slice(src.indexOf('export async function deleteMappingNode'))
	const body = fn.slice(0, fn.indexOf('\n}\n'))
	assert.match(body, /removeMappingNode/, 'deleteMappingNode must use the dedicated endpoint')
	assert.equal(
		/saveDeviceGraph\(/.test(body),
		false,
		'a whole-graph POST can never be made safe — the server cannot tell a deletion from any other edit',
	)
})
