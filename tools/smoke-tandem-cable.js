'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeDeviceGraph, PH_DEVICE_ID, DEFAULT_DEVICE_ID } = require('../src/config/device-graph')
const {
	upsertTandemPathFromCableConnectors,
	buildTandemPathIdForCable,
	inferMainIndexFromSourceConnector,
} = require('../src/config/tandem-from-device-cable')
const { normalizeTandemTopology } = require('../src/config/tandem-topology')

test('path id: screen1 decklink + PH 4', () => {
	const src = { id: 'dlo_s1', deviceId: DEFAULT_DEVICE_ID, kind: 'decklink_out' }
	const snk = { id: 'ph_4', deviceId: PH_DEVICE_ID, kind: 'ph_in', externalRef: '4' }
	assert.equal(buildTandemPathIdForCable(src, snk), 'dv_m0_ph4')
	assert.equal(inferMainIndexFromSourceConnector(src), 0)
})

test('path id: screen2', () => {
	const src = { id: 'dlo_s2', deviceId: DEFAULT_DEVICE_ID, kind: 'decklink_out' }
	const snk = { deviceId: PH_DEVICE_ID, kind: 'ph_in', externalRef: '1' }
	assert.equal(inferMainIndexFromSourceConnector(src), 1)
	assert.equal(buildTandemPathIdForCable(src, snk), 'dv_m1_ph1')
})

test('upsert adds signalPath', () => {
	const g = normalizeDeviceGraph({
		devices: [
			{ id: DEFAULT_DEVICE_ID, role: 'caspar_host', label: 'C' },
			{ id: PH_DEVICE_ID, role: 'pixelhue_switcher', label: 'P' },
		],
		connectors: [
			{ id: 'dlo_s1', deviceId: DEFAULT_DEVICE_ID, kind: 'decklink_out', label: 'S1' },
			{ id: 'ph7', deviceId: PH_DEVICE_ID, kind: 'ph_in', label: 'H', externalRef: '7' },
		],
		edges: [{ id: 'e1', sourceId: 'dlo_s1', sinkId: 'ph7' }],
	})
	const t0 = normalizeTandemTopology({ version: 1, destinations: [], signalPaths: [], edidNotes: '' })
	const t1 = upsertTandemPathFromCableConnectors(t0, g, 'dlo_s1', 'ph7')
	const p = t1.signalPaths.find((x) => x.id === 'dv_m0_ph7')
	assert.ok(p)
	assert.equal(p.phInterfaceId, 7)
	assert.equal(p.caspar.mainIndex, 0)
})
