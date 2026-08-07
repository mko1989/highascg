'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	buildTopologyRowsFromDrmConnectors,
	groupConnectorsByDrmCard,
} = require('../../src/utils/gpu-topology-drm')
const { normalizePortName } = require('../../src/utils/gpu-topology-xrandr')
const { resolveDisplayByDrmHeuristic } = require('../../src/utils/gpu-display-alias')

describe('gpu topology from DRM sysfs', () => {
	it('normalizePortName handles eDP and HDMI-A', () => {
		assert.equal(normalizePortName('card1-eDP-1'), 'EDP-1')
		assert.equal(normalizePortName('eDP-1-1'), 'EDP-1-1')
		assert.equal(normalizePortName('card0-HDMI-A-1'), 'HDMI-A-1')
		assert.equal(normalizePortName('card1-DP-3'), 'DP-3')
	})

	it('groups connectors by DRM card', () => {
		const connectors = [
			{ name: 'card0-HDMI-A-1', shortName: 'HDMI-A-1' },
			{ name: 'card1-DP-1', shortName: 'DP-1' },
		]
		const groups = groupConnectorsByDrmCard(connectors)
		assert.equal(groups.size, 2)
		assert.ok(groups.has('card0'))
		assert.ok(groups.has('card1'))
	})

	it('includes all GPU cards (laptop dual-GPU)', () => {
		const connectors = [
			{ name: 'card0-HDMI-A-1', shortName: 'HDMI-A-1', connected: true, type: 'hdmi' },
			{ name: 'card0-eDP-2', shortName: 'eDP-2', connected: false, type: 'displayport' },
			{ name: 'card0-DP-9', shortName: 'DP-9', connected: false, type: 'displayport' },
			{ name: 'card1-DP-1', shortName: 'DP-1', connected: false, type: 'displayport' },
			{ name: 'card1-DP-2', shortName: 'DP-2', connected: false, type: 'displayport' },
			{ name: 'card1-eDP-1', shortName: 'eDP-1', connected: true, type: 'displayport' },
			{ name: 'card1-Writeback-1', shortName: 'Writeback-1', connected: false, type: 'unknown' },
		]
		const rows = buildTopologyRowsFromDrmConnectors(connectors)
		assert.ok(rows)
		assert.equal(rows.length, 5)
		assert.ok(rows.some((r) => r.drmCard === 'card0' && r.dpA === 'HDMI-A-1'))
		assert.ok(rows.some((r) => r.drmCard === 'card1' && r.dpA === 'DP-1' && r.dpB === 'DP-2'))
		assert.ok(rows.some((r) => r.drmCard === 'card1' && r.dpA === 'EDP-1'))
	})

	it('pairs built-in eDP with xrandr panel lane (EDP-1 / EDP-1-1)', () => {
		const connectors = [
			{ name: 'card1-eDP-1', shortName: 'eDP-1', connected: true, type: 'displayport' },
		]
		const xrandrRaw = 'eDP-1-1 connected 1920x1080+0+0\n'
		const rows = buildTopologyRowsFromDrmConnectors(connectors, { xrandrRaw })
		assert.equal(rows.length, 1)
		assert.equal(rows[0].dpA, 'EDP-1')
		assert.equal(rows[0].dpB, 'EDP-1-1')
	})

	it('pairs adjacent eDP-1 and eDP-2 on same card', () => {
		const connectors = [
			{ name: 'card1-eDP-1', shortName: 'eDP-1', connected: false, type: 'displayport' },
			{ name: 'card1-eDP-2', shortName: 'eDP-2', connected: false, type: 'displayport' },
		]
		const rows = buildTopologyRowsFromDrmConnectors(connectors)
		assert.equal(rows.length, 1)
		assert.equal(rows[0].dpA, 'EDP-1')
		assert.equal(rows[0].dpB, 'EDP-2')
	})

	it('pairs eight DRM DPs into four dual-mode jacks', () => {
		const connectors = []
		for (let i = 1; i <= 8; i++) {
			connectors.push({
				name: `card1-DP-${i}`,
				shortName: `DP-${i}`,
				connected: false,
				type: 'displayport',
			})
		}
		connectors.push({ name: 'card1-eDP-1', shortName: 'eDP-1', connected: true, type: 'displayport' })
		const rows = buildTopologyRowsFromDrmConnectors(connectors)
		assert.equal(rows.length, 5)
		assert.equal(rows.filter((r) => r.dpB).length, 4)
	})

	it('pairs DP only when both halves exist in DRM and xrandr on same card', () => {
		const connectors = [
			{ name: 'card1-DP-0', shortName: 'DP-0', connected: false, type: 'displayport' },
			{ name: 'card1-DP-1', shortName: 'DP-1', connected: true, type: 'displayport' },
			{ name: 'card1-HDMI-0', shortName: 'HDMI-0', connected: false, type: 'hdmi' },
			{ name: 'card1-HDMI-1', shortName: 'HDMI-1', connected: false, type: 'hdmi' },
		]
		const xrandrRaw = [
			'DP-0 disconnected',
			'DP-1 connected primary 1920x1080+0+0',
			'HDMI-0 disconnected',
			'HDMI-1 disconnected',
		].join('\n')
		const rows = buildTopologyRowsFromDrmConnectors(connectors, { xrandrRaw })
		const dpRow = rows.find((r) => r.dpA === 'DP-0' && r.dpB === 'DP-1')
		assert.ok(dpRow, 'expected DP-0/DP-1 pair when both halves exist in DRM and xrandr')
		assert.equal(dpRow.drmName, 'card1-DP-0')
	})

	it('lists two server GPUs without merging across cards', () => {
		const connectors = [
			{ name: 'card0-DP-1', shortName: 'DP-1', connected: true, type: 'displayport' },
			{ name: 'card0-DP-2', shortName: 'DP-2', connected: false, type: 'displayport' },
			{ name: 'card1-DP-1', shortName: 'DP-1', connected: false, type: 'displayport' },
			{ name: 'card1-DP-2', shortName: 'DP-2', connected: true, type: 'displayport' },
		]
		const rows = buildTopologyRowsFromDrmConnectors(connectors, { pairAdjacentDp: false })
		assert.equal(rows.length, 4)
		assert.equal(rows.filter((r) => r.drmCard === 'card0').length, 2)
		assert.equal(rows.filter((r) => r.drmCard === 'card1').length, 2)
		assert.notEqual(rows[0].physicalPortId, rows[2].physicalPortId)
	})

	it('maps NVIDIA DRM DP-3 to xrandr DP-4/DP-5 when DP-2/DP-3 lanes are idle (RTX 2080 SUPER)', () => {
		const connectors = [
			{ name: 'card1-DP-1', shortName: 'DP-1', connected: true, type: 'displayport' },
			{ name: 'card1-DP-2', shortName: 'DP-2', connected: false, type: 'displayport' },
			{ name: 'card1-DP-3', shortName: 'DP-3', connected: true, type: 'displayport' },
			{ name: 'card1-HDMI-A-1', shortName: 'HDMI-A-1', connected: true, type: 'hdmi' },
		]
		const xrandrRaw = [
			'DP-0 connected primary 1920x1080+2560+0',
			'DP-1 disconnected',
			'HDMI-0 connected 1920x1080+0+0',
			'DP-2 disconnected',
			'DP-3 disconnected',
			'DP-4 connected 2560x1280+0+0',
			'DP-5 disconnected',
		].join('\n')
		const rows = buildTopologyRowsFromDrmConnectors(connectors, { xrandrRaw })
		const dp01 = rows.find((r) => r.dpA === 'DP-0' && r.dpB === 'DP-1')
		const dp45 = rows.find((r) => r.dpA === 'DP-4' && r.dpB === 'DP-5')
		assert.ok(dp01, 'expected DP-0/DP-1 row')
		assert.equal(dp01.drmName, 'card1-DP-1')
		assert.ok(dp45, 'expected DP-4/DP-5 row for DRM DP-3')
		assert.equal(dp45.drmName, 'card1-DP-3')
	})

	it('aliases xrandr HDMI-0 to DRM card0-HDMI-A-1', () => {
		const topology = [
			{
				physicalPortId: 'gpu_p2',
				slotOrder: 2,
				dpA: 'HDMI-A-1',
				dpB: '',
				drmName: 'card0-HDMI-A-1',
				drmCard: 'card0',
			},
			{
				physicalPortId: 'gpu_p4',
				slotOrder: 4,
				dpA: 'EDP-1',
				dpB: '',
				drmName: 'card1-eDP-1',
				drmCard: 'card1',
			},
		]
		const displays = [
			{ name: 'HDMI-0', connected: true, resolution: '1920x1080' },
			{ name: 'eDP-1-1', connected: true, resolution: '1920x1080' },
		]
		const connectors = [
			{ name: 'card0-HDMI-A-1', shortName: 'HDMI-A-1', connected: true, type: 'hdmi' },
			{ name: 'card1-eDP-1', shortName: 'eDP-1', connected: true, type: 'displayport' },
		]
		const ports = topology.map((t) => {
			const used = new Set()
			const connectorByDrm = new Map(connectors.map((c) => [c.name.toLowerCase(), c]))
			const hit = resolveDisplayByDrmHeuristic(t, displays, connectorByDrm, used)
			return { id: t.physicalPortId, xrandr: hit?.display?.name || null }
		})
		assert.equal(ports[0].xrandr, 'HDMI-0')
		assert.equal(ports[1].xrandr, 'eDP-1-1')
	})
})
