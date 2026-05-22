'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	normalizeDeviceGraph,
	validateDeviceGraph,
	suggestConnectorsAndDevicesFromLive,
	mergeHardwareSync,
	addEdgeToGraph,
	edgeConnectAllowed,
	DEFAULT_DEVICE_ID,
	DEST_DEVICE_ID,
} = require('../../src/config/device-graph')

test('normalizeDeviceGraph has default host device', () => {
	const g = normalizeDeviceGraph({})
	assert.equal(g.devices[0].id, 'caspar_host')
	assert.equal(g.version, 1)
})

test('validateDeviceGraph catches missing connector for edge', () => {
	const g = normalizeDeviceGraph({
		devices: [{ id: 'a', role: 'caspar_host', label: 'A' }],
		connectors: [
			{ id: 'c1', deviceId: 'a', kind: 'gpu_out', label: '1' },
			{ id: 'c2', deviceId: 'a', kind: 'gpu_out', label: '2' },
		],
		edges: [{ id: 'e1', sourceId: 'c1', sinkId: 'missing' }],
	})
	const v = validateDeviceGraph(g)
	assert.equal(v.ok, false)
	assert.ok(v.errors.some((x) => x.includes('missing')))
})

test('validateDeviceGraph self-loop', () => {
	const g = normalizeDeviceGraph({
		devices: [{ id: 'a', role: 'caspar_host', label: 'A' }],
		connectors: [{ id: 'c1', deviceId: 'a', kind: 'x', label: '1' }],
		edges: [{ id: 'e1', sourceId: 'c1', sinkId: 'c1' }],
	})
	const v = validateDeviceGraph(g)
	assert.equal(v.ok, false)
	assert.ok(v.errors.some((x) => /self/.test(x)))
})

test('suggest + merge keeps custom connector', () => {
	const live = {
		gpu: { displays: [{ name: 'DP-1', resolution: '1920x1080' }] },
		decklink: { inputs: [], screenOutputs: [{ screen: 1, device: 0 }], multiviewDevice: 0 },
	}
	const sug = suggestConnectorsAndDevicesFromLive(live)
	assert.ok(sug.connectors.some((c) => c.kind === 'gpu_out'))
	const base = normalizeDeviceGraph({
		devices: [{ id: 'caspar_host', role: 'caspar_host', label: 'H' }],
		connectors: [
			{ id: 'custom1', deviceId: 'caspar_host', kind: 'usb_av', label: 'USB' },
			{ id: 'gpu_old', deviceId: 'caspar_host', kind: 'gpu_out', label: 'old' },
		],
		edges: [],
	})
	const merged = mergeHardwareSync(base, sug)
	const v = validateDeviceGraph(merged)
	assert.equal(v.ok, true)
	assert.ok(merged.connectors.some((c) => c.id === 'custom1'))
	assert.ok(merged.connectors.some((c) => c.kind === 'gpu_out' && c.externalRef === 'DP-1'))
	assert.equal(merged.connectors.some((c) => c.id === 'gpu_old'), false)
})

test('addEdge: destination feed ← caspar gpu out', () => {
	const g = normalizeDeviceGraph({
		devices: [
			{ id: DEFAULT_DEVICE_ID, role: 'caspar_host', label: 'C' },
			{ id: DEST_DEVICE_ID, role: 'destinations', label: 'Dst' },
		],
		connectors: [
			{ id: 'gpu_0', deviceId: DEFAULT_DEVICE_ID, kind: 'gpu_out', label: 'G' },
			{ id: 'dst_in_led1', deviceId: DEST_DEVICE_ID, kind: 'destination_in', label: 'LED', externalRef: 'led1' },
		],
		edges: [],
	})
	const a = addEdgeToGraph(g, 'dst_in_led1', 'gpu_0')
	assert.equal(a.ok, true)
	assert.equal((a.graph.edges || []).length, 1)
})

test('addEdge: caspar output → caspar output rejected', () => {
	const g = normalizeDeviceGraph({
		devices: [{ id: DEFAULT_DEVICE_ID, role: 'caspar_host', label: 'C' }],
		connectors: [
			{ id: 'gpu_a', deviceId: DEFAULT_DEVICE_ID, kind: 'gpu_out', label: 'A' },
			{ id: 'gpu_b', deviceId: DEFAULT_DEVICE_ID, kind: 'gpu_out', label: 'B' },
		],
		edges: [],
	})
	assert.equal(addEdgeToGraph(g, 'gpu_a', 'gpu_b').ok, false)
	assert.equal(edgeConnectAllowed(g, 'gpu_a', 'gpu_b').ok, false)
})
