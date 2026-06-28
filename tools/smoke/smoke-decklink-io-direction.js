'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	normalizeDecklinkIoDirection,
	isDecklinkIoOutputSink,
	isDecklinkIoIn,
	DECKLINK_IO_UNASSIGNED,
} = require('../../src/config/decklink-io-direction')
const { suggestConnectorsAndDevicesFromLive, edgeConnectAllowed, addEdgeToGraph, DEFAULT_DEVICE_ID, DEST_DEVICE_ID } = require('../../src/config/device-graph')
const { applyDecklinkOutputOnDestinationEdge } = require('../../src/api/device-view-decklink-wiring')

test('normalizeDecklinkIoDirection defaults to unassigned', () => {
	assert.equal(normalizeDecklinkIoDirection({}), DECKLINK_IO_UNASSIGNED)
	assert.equal(normalizeDecklinkIoDirection({ ioDirection: '' }), DECKLINK_IO_UNASSIGNED)
	assert.equal(normalizeDecklinkIoDirection({ ioDirection: 'in' }), 'in')
	assert.equal(normalizeDecklinkIoDirection({ ioDirection: 'out' }), 'out')
})

test('hardware discovery creates unassigned decklink_io ports', () => {
	const live = {
		gpu: { displays: [] },
		decklink: {
			inputs: [],
			screenOutputs: [{ screen: 1, device: 0 }],
			multiviewDevice: 0,
			hardware: { connectors: [{ index: 1, name: 'DeckLink 4K' }] },
		},
	}
	const sug = suggestConnectorsAndDevicesFromLive(live, { casparServer: { decklink_input_count: 0 } })
	const dl = sug.connectors.find((c) => c.id === 'dlsdi_1')
	assert.ok(dl)
	assert.equal(dl.kind, 'decklink_io')
	assert.equal(normalizeDecklinkIoDirection(dl.caspar), DECKLINK_IO_UNASSIGNED)
	assert.equal(sug.connectors.some((c) => c.kind === 'decklink_in'), false)
})

test('destination may cable to unassigned SDI and promotes to output', () => {
	const graph = {
		version: 1,
		devices: [
			{ id: DEFAULT_DEVICE_ID, role: 'caspar_host', label: 'Host' },
			{ id: DEST_DEVICE_ID, role: 'destinations', label: 'Dst' },
		],
		connectors: [
			{
				id: 'dlsdi_1',
				deviceId: DEFAULT_DEVICE_ID,
				kind: 'decklink_io',
				index: 0,
				label: 'SDI 1',
				externalRef: '1',
				caspar: { ioDirection: DECKLINK_IO_UNASSIGNED },
			},
			{
				id: 'dst_in_pgm1',
				deviceId: DEST_DEVICE_ID,
				kind: 'destination_in',
				label: 'PGM 1',
				externalRef: 'pgm1',
			},
		],
		edges: [],
	}
	const conn = graph.connectors[0]
	assert.equal(isDecklinkIoOutputSink(conn), true)
	assert.equal(isDecklinkIoIn(conn), false)
	assert.equal(edgeConnectAllowed(graph, 'dst_in_pgm1', 'dlsdi_1').ok, true)

	const ctx = {
		config: {
			casparServer: { decklink_input_count: 0, screen_count: 1 },
			screenDestinations: {
				destinations: [{ id: 'pgm1', label: 'PGM 1', mainScreenIndex: 0, mode: 'pgm_only' }],
			},
			deviceGraph: graph,
		},
		configManager: {
			get() {
				return JSON.parse(JSON.stringify(ctx.config))
			},
			save(next) {
				Object.assign(ctx.config, next)
			},
		},
	}

	const wired = applyDecklinkOutputOnDestinationEdge(ctx, graph, 'dst_in_pgm1', 'dlsdi_1')
	assert.equal(wired.changed, true)
	const updated = ctx.config.deviceGraph.connectors.find((c) => c.id === 'dlsdi_1')
	assert.equal(normalizeDecklinkIoDirection(updated.caspar), 'out')
	assert.equal(updated.caspar.outputBinding.type, 'screen')
	assert.equal(ctx.config.casparServer.screen_1_decklink_device, 1)

	const edgeResult = addEdgeToGraph(wired.graph, 'dst_in_pgm1', 'dlsdi_1')
	assert.equal(edgeResult.ok, true)
})
