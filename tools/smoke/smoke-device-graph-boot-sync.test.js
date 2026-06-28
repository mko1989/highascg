'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeDeviceGraph } = require('../../src/config/device-graph')
const {
	buildLiveFromInventoryPayload,
	ensureDeviceGraphHardwareSyncFromLive,
} = require('../../src/bootstrap/device-graph-boot-sync')

test('buildLiveFromInventoryPayload maps gpu/decklink/audio', () => {
	const live = buildLiveFromInventoryPayload({
		gpu: { physicalMap: { ports: [{ physicalPortId: 'gpu_p0' }] } },
		decklink: { connectors: [{ index: 1, label: 'SDI' }] },
		audio: { alsa: [] },
	})
	assert.equal(live.gpu.physicalMap.ports[0].physicalPortId, 'gpu_p0')
	assert.equal(live.decklink.connectors.length, 1)
})

test('ensureDeviceGraphHardwareSyncFromLive replaces stale gpu_out ports', () => {
	const prev = process.env.HIGHASCG_BOOT_DEVICE_GRAPH_SYNC
	process.env.HIGHASCG_BOOT_DEVICE_GRAPH_SYNC = '1'
	try {
		const config = {
			deviceGraph: normalizeDeviceGraph({
				devices: [{ id: 'caspar_host', role: 'caspar_host', label: 'H' }],
				connectors: [
					{ id: 'gpu_p0', deviceId: 'caspar_host', kind: 'gpu_out', label: 'P0' },
					{ id: 'gpu_p1', deviceId: 'caspar_host', kind: 'gpu_out', label: 'P1' },
					{ id: 'gpu_p2', deviceId: 'caspar_host', kind: 'gpu_out', label: 'P2' },
					{ id: 'gpu_p3', deviceId: 'caspar_host', kind: 'gpu_out', label: 'P3' },
				],
				edges: [],
			}),
			gpuPhysicalTopology: [
				{ physicalPortId: 'gpu_p0', slotOrder: 0, dpA: 'DP-0', dpB: 'DP-1', connectorNumber: 0, location: 0 },
			],
		}
		const payload = {
			gpu: {
				displays: [],
				connectors: [],
				physicalMap: {
					ports: [
						{
							physicalPortId: 'gpu_p0',
							slotOrder: 0,
							pair: { dpA: 'DP-0', dpB: 'DP-1', name: 'DP-0/DP-1' },
							runtime: { activePort: 'DP-0', connected: true },
						},
					],
				},
			},
			decklink: { connectors: [] },
		}
		const saved = []
		const configManager = {
			get: () => ({ ...config }),
			save: (c) => {
				saved.push(c)
				return true
			},
		}
		const res = ensureDeviceGraphHardwareSyncFromLive({ config, configManager, payload, log: () => {} })
		assert.equal(res.updated, true)
		assert.equal(res.saved, true)
		const gpuOut = (config.deviceGraph.connectors || []).filter((c) => c.kind === 'gpu_out')
		assert.equal(gpuOut.length, 1)
		assert.equal(gpuOut[0].id, 'gpu_p0')
	} finally {
		if (prev === undefined) delete process.env.HIGHASCG_BOOT_DEVICE_GRAPH_SYNC
		else process.env.HIGHASCG_BOOT_DEVICE_GRAPH_SYNC = prev
	}
})

test('ensureDeviceGraphHardwareSyncFromLive respects disable env', () => {
	const prev = process.env.HIGHASCG_BOOT_DEVICE_GRAPH_SYNC
	process.env.HIGHASCG_BOOT_DEVICE_GRAPH_SYNC = '0'
	try {
		const config = { deviceGraph: normalizeDeviceGraph({}) }
		const res = ensureDeviceGraphHardwareSyncFromLive({
			config,
			payload: { gpu: { physicalMap: { ports: [{ physicalPortId: 'gpu_p0' }] } } },
		})
		assert.equal(res.skipped, true)
		assert.equal(res.updated, false)
	} finally {
		if (prev === undefined) delete process.env.HIGHASCG_BOOT_DEVICE_GRAPH_SYNC
		else process.env.HIGHASCG_BOOT_DEVICE_GRAPH_SYNC = prev
	}
})
