'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	normalizeDeviceGraph,
	validateDeviceGraph,
	graphFromTandemTopology,
	suggestConnectorsAndDevicesFromLive,
	mergeHardwareSync,
	addEdgeToGraph,
	edgeConnectAllowed,
	DEFAULT_DEVICE_ID,
	PH_DEVICE_ID,
} = require('../src/config/device-graph')

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

test('graphFromTandemTopology baseline', () => {
	const t = { version: 1, destinations: [], signalPaths: [{ id: 'p1' }], edidNotes: '' }
	const g = graphFromTandemTopology(t)
	const v = validateDeviceGraph(g)
	assert.equal(v.ok, true)
	assert.ok(g._meta && g._meta.tandemPathCount >= 1)
})

test('suggest + merge keeps custom connector', () => {
	const live = {
		gpu: { displays: [{ name: 'DP-1', resolution: '1920x1080' }] },
		decklink: { inputs: [], screenOutputs: [{ screen: 1, device: 0 }], multiviewDevice: 0 },
		pixelhue: { available: false },
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

test('addEdge: caspar out → ph in', () => {
	const g = normalizeDeviceGraph({
		devices: [
			{ id: DEFAULT_DEVICE_ID, role: 'caspar_host', label: 'C' },
			{ id: PH_DEVICE_ID, role: 'pixelhue_switcher', label: 'P' },
		],
		connectors: [
			{ id: 'gpu_0', deviceId: DEFAULT_DEVICE_ID, kind: 'gpu_out', label: 'G' },
			{ id: 'ph_1', deviceId: PH_DEVICE_ID, kind: 'ph_in', label: 'H', externalRef: '1' },
		],
		edges: [],
	})
	const a = addEdgeToGraph(g, 'gpu_0', 'ph_1')
	assert.equal(a.ok, true)
	const v = validateDeviceGraph(a.graph)
	assert.equal(v.ok, true)
	assert.equal((a.graph.edges || []).length, 1)
})

test('addEdge: wrong order rejected', () => {
	const g = normalizeDeviceGraph({
		devices: [
			{ id: DEFAULT_DEVICE_ID, role: 'caspar_host', label: 'C' },
			{ id: PH_DEVICE_ID, role: 'pixelhue_switcher', label: 'P' },
		],
		connectors: [
			{ id: 'gpu_0', deviceId: DEFAULT_DEVICE_ID, kind: 'gpu_out', label: 'G' },
			{ id: 'ph_1', deviceId: PH_DEVICE_ID, kind: 'ph_in', label: 'H' },
		],
		edges: [],
	})
	const r = addEdgeToGraph(g, 'ph_1', 'gpu_0')
	assert.equal(r.ok, false)
	assert.equal(edgeConnectAllowed(g, 'ph_1', 'gpu_0').ok, false)
})
