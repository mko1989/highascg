'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { topologyRowsEqual, ensureGpuPhysicalTopologyFromXrandr, discoverGpuPhysicalTopologyFromXrandr } = require('../../src/utils/gpu-topology-xrandr')

const NVIDIA_595_XRANDR = [
	'DP-0 disconnected primary',
	'DP-1 disconnected',
	'HDMI-0 connected 1920x1080+0+0',
	'DP-2 connected 1920x1080+1920+0',
].join('\n')

describe('gpu topology boot persist', () => {
	it('does not overwrite operator-saved topology when discovery differs', () => {
		const discovered = discoverGpuPhysicalTopologyFromXrandr(NVIDIA_595_XRANDR)
		const config = {
			gpuPhysicalTopologyOperatorSaved: true,
			gpuPhysicalTopology: [
				{ physicalPortId: 'gpu_p0', slotOrder: 0, dpA: 'DP-99', dpB: '', connectorNumber: 0, location: 0 },
			],
		}
		const saved = [...config.gpuPhysicalTopology]
		const result = ensureGpuPhysicalTopologyFromXrandr({
			config,
			log: () => {},
			xrandrRaw: NVIDIA_595_XRANDR,
		})
		assert.equal(result.updated, false)
		assert.ok(topologyRowsEqual(config.gpuPhysicalTopology, saved))
		assert.ok(Array.isArray(result.suggested))
		assert.equal(result.suggested[0].dpA, discovered[0].dpA)
	})

	it('auto-persists discovery on fresh machine without operator marker', () => {
		const config = {}
		const cm = {
			get: () => ({ ...config }),
			save: (c) => {
				Object.assign(config, c)
				return true
			},
		}
		const result = ensureGpuPhysicalTopologyFromXrandr({
			config,
			configManager: cm,
			log: () => {},
			xrandrRaw: NVIDIA_595_XRANDR,
		})
		assert.equal(result.updated, true)
		assert.ok(Array.isArray(config.gpuPhysicalTopology))
		assert.ok(config.gpuPhysicalTopology.length >= 2)
	})
})
