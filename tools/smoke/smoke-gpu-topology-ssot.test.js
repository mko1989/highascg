'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	resolveDefaultTopologyForGpu,
	resolveSocketCountForGpu,
} = require('../../src/utils/known-gpu-topology')
const { buildGpuPhysicalMap } = require('../../src/utils/gpu-physical-map')
const { handleGpuPortsReset } = require('../../src/api/system-hardware-gpu-ports')
const {
	topologyDiffers,
	reconcileTopologyWithLiveDisplays,
} = require('../../src/utils/gpu-topology-reconcile')
const { physicalPortIndexFromGpuConnector } = require('../../src/config/screen-consumer-port-resolve')
const { discoverGpuPhysicalTopologyFromXrandr } = require('../../src/utils/gpu-topology-xrandr')

const NVIDIA_595_XRANDR = [
	'DP-0 disconnected primary',
	'DP-1 disconnected',
	'HDMI-0 connected 1920x1080+0+0',
	'DP-2 connected 1920x1080+1920+0',
].join('\n')

describe('known-gpu-topology (WO-108 T108.4)', () => {
	it('__generic__ provides RTX-style four-socket default', () => {
		const rows = resolveDefaultTopologyForGpu(null)
		assert.equal(rows.length, 4)
		assert.equal(rows[1].dpA, 'HDMI-0')
		assert.ok(rows.every((r) => /^gpu_p\d+$/.test(r.physicalPortId)))
	})

	it('2-output model yields two sockets not four', () => {
		assert.equal(resolveSocketCountForGpu('2-output'), 2)
		const rows = resolveDefaultTopologyForGpu('2-output')
		assert.equal(rows.length, 2)
	})

	it('RTX PRO 4000 uses DP-only four-socket table', () => {
		const rows = resolveDefaultTopologyForGpu('NVIDIA RTX PRO 4000 Blackwell')
		assert.equal(rows.length, 4)
		assert.equal(rows[1].dpA, 'DP-2')
		assert.notEqual(rows[1].dpA, 'HDMI-0')
	})
})

describe('gpu topology SSOT (WO-108)', () => {
	it('effectiveTopology is authoritative for rear-panel socket count', () => {
		const config = {
			gpuPhysicalTopology: resolveDefaultTopologyForGpu('2-output'),
		}
		const map = buildGpuPhysicalMap({ config, displays: [], connectors: [] })
		assert.equal(map.effectiveTopology.length, 2)
	})

	it('reconcile does not assign the same live DP pair to two rear sockets', () => {
		const saved = resolveDefaultTopologyForGpu(null)
		const discovered = resolveDefaultTopologyForGpu('NVIDIA RTX PRO 4000 Blackwell')
		const displays = [
			{ name: 'DP-3', connected: true, resolution: '1920x1080' },
			{ name: 'DP-4', connected: true, resolution: '1920x1080' },
		]
		const eff = reconcileTopologyWithLiveDisplays(saved, displays, discovered)
		const pairKeys = eff.map((r) => `${r.dpA}/${r.dpB}`)
		const dp23Count = pairKeys.filter((k) => k === 'DP-2/DP-3').length
		assert.equal(dp23Count, 1, `expected one DP-2/DP-3 socket, got ${dp23Count}: ${pairKeys.join(', ')}`)
		const connectedSockets = eff.filter((r) =>
			[r.dpA, r.dpB].some((p) => p === 'DP-3' || p === 'DP-4'),
		)
		assert.equal(connectedSockets.length, 2)
	})

	it('creates gpu_unmapped rows for unmatched connected displays', () => {
		const topology = discoverGpuPhysicalTopologyFromXrandr(NVIDIA_595_XRANDR)
		const config = {
			gpuPhysicalTopology: topology.slice(0, 2),
			gpuPhysicalTopologyOperatorSaved: true,
		}
		const displays = [
			{ name: 'HDMI-0', connected: true, resolution: '1920x1080' },
			{ name: 'DP-2', connected: true, resolution: '1920x1080' },
			{ name: 'DP-99', connected: true, resolution: '1920x1080' },
		]
		const map = buildGpuPhysicalMap({ config, displays, connectors: [] })
		const unmapped = map.ports.filter((p) => p.unmapped)
		assert.ok(unmapped.some((p) => String(p.runtime?.activePort || '').includes('DP-99')))
	})

	it('gpu-ports-reset persists topology when persist=true', () => {
		const config = {}
		const cm = {
			get: () => ({ ...config }),
			save: (c) => {
				Object.assign(config, c)
				return true
			},
		}
		const res = handleGpuPortsReset(
			JSON.stringify({ persist: true }),
			{ config, configManager: cm },
		)
		const body = JSON.parse(String(res.body))
		assert.equal(body.ok, true)
		if (body.topology?.length) {
			assert.equal(body.persisted, true)
			assert.ok(Array.isArray(config.gpuPhysicalTopology))
			assert.equal(config.gpuPhysicalTopologyOperatorSaved, true)
		}
	})

	it('topologyDiffers detects pair changes between clients', () => {
		const a = [
			{ physicalPortId: 'gpu_p0', slotOrder: 0, dpA: 'DP-0', dpB: 'DP-1' },
			{ physicalPortId: 'gpu_p1', slotOrder: 1, dpA: 'DP-2', dpB: 'DP-3' },
		]
		const b = [
			{ physicalPortId: 'gpu_p0', slotOrder: 0, dpA: 'DP-2', dpB: 'DP-3' },
			{ physicalPortId: 'gpu_p1', slotOrder: 1, dpA: 'DP-0', dpB: 'DP-1' },
		]
		assert.equal(topologyDiffers(a, b), true)
		assert.equal(topologyDiffers(a, a), false)
	})

	it('screen_N consumer index follows gpu_p socket order', () => {
		assert.equal(physicalPortIndexFromGpuConnector({ id: 'gpu_p0' }), 1)
		assert.equal(physicalPortIndexFromGpuConnector({ id: 'gpu_p2' }), 3)
		assert.equal(physicalPortIndexFromGpuConnector({ id: 'gpu_p3' }), 4)
	})
})
