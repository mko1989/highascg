'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { buildGpuPhysicalMap } = require('../../src/utils/gpu-physical-map')
const { discoverGpuPhysicalTopologyFromXrandr } = require('../../src/utils/gpu-topology-xrandr')

const NVIDIA_595_XRANDR = [
	'DP-0 disconnected primary',
	'DP-1 disconnected',
	'HDMI-0 connected 1920x1080+0+0',
	'DP-2 connected 1920x1080+1920+0',
	'DP-3 disconnected',
	'DP-4 connected 1920x1080+1920+0',
	'DP-5 disconnected',
].join('\n')

describe('gpu physical map', () => {
	it('discovers four ports in xrandr query order', () => {
		const rows = discoverGpuPhysicalTopologyFromXrandr(NVIDIA_595_XRANDR)
		assert.equal(rows.length, 4)
		assert.deepEqual(
			rows.map((r) => ({ id: r.physicalPortId, dpA: r.dpA, dpB: r.dpB })),
			[
				{ id: 'gpu_p0', dpA: 'DP-0', dpB: 'DP-1' },
				{ id: 'gpu_p1', dpA: 'HDMI-0', dpB: 'HDMI-1' },
				{ id: 'gpu_p2', dpA: 'DP-2', dpB: 'DP-3' },
				{ id: 'gpu_p3', dpA: 'DP-4', dpB: 'DP-5' },
			],
		)
	})

	it('maps topology pairs to live xrandr names without cross-port steals', () => {
		const config = {
			gpuPhysicalTopology: discoverGpuPhysicalTopologyFromXrandr(NVIDIA_595_XRANDR),
		}
		const displays = [
			{ name: 'HDMI-0', connected: true, resolution: '1920x1080', refreshHz: 50, x: 0, y: 0 },
			{ name: 'DP-2', connected: true, resolution: '1920x1080', refreshHz: 60, x: 1920, y: 0 },
			{ name: 'DP-4', connected: true, resolution: '1920x1080', refreshHz: 50, x: 3840, y: 0 },
		]
		const connectors = [
			{ name: 'DP-0', shortName: 'DP-0', connected: false, xrandrName: 'DP-0' },
			{ name: 'DP-1', shortName: 'DP-1', connected: false, xrandrName: 'DP-1' },
			{ name: 'HDMI-0', shortName: 'HDMI-0', connected: true, xrandrName: 'HDMI-0' },
			{ name: 'DP-2', shortName: 'DP-2', connected: true, xrandrName: 'DP-2' },
			{ name: 'DP-3', shortName: 'DP-3', connected: false, xrandrName: 'DP-3' },
			{ name: 'DP-4', shortName: 'DP-4', connected: true, xrandrName: 'DP-4' },
			{ name: 'DP-5', shortName: 'DP-5', connected: false, xrandrName: 'DP-5' },
		]
		const map = buildGpuPhysicalMap({ config, displays, connectors })
		const byId = Object.fromEntries(map.ports.map((p) => [p.physicalPortId, p]))
		assert.equal(byId.gpu_p0.runtime.xrandrName, null)
		assert.equal(byId.gpu_p0.runtime.connected, false)
		assert.equal(byId.gpu_p1.runtime.xrandrName, 'HDMI-0')
		assert.equal(byId.gpu_p2.runtime.xrandrName, 'DP-2')
		assert.equal(byId.gpu_p3.runtime.xrandrName, 'DP-4')
		assert.equal(map.ports.filter((p) => p.unmapped).length, 0)
	})

	it('uses flat topology for four DP-only laptop outputs (no A/B banks)', () => {
		const raw = [
			'DP-0 connected primary 1920x1080+0+0',
			'DP-1 disconnected',
			'DP-2 disconnected',
			'DP-3 disconnected',
		].join('\n')
		const rows = discoverGpuPhysicalTopologyFromXrandr(raw)
		assert.equal(rows.length, 4)
		assert.deepEqual(
			rows.map((r) => ({ id: r.physicalPortId, dpA: r.dpA, dpB: r.dpB })),
			[
				{ id: 'gpu_p0', dpA: 'DP-0', dpB: '' },
				{ id: 'gpu_p1', dpA: 'DP-1', dpB: '' },
				{ id: 'gpu_p2', dpA: 'DP-2', dpB: '' },
				{ id: 'gpu_p3', dpA: 'DP-3', dpB: '' },
			],
		)
	})
})
