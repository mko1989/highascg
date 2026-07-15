'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { resolveOperatorMonitorPort } = require('../../src/utils/operator-monitor-resolve')

// Mock config with topology for buildGpuPhysicalMap
function configWithTopology(screenFlags = {}) {
	return {
		...screenFlags,
		// slotOrder is 0-based in real buildGpuPhysicalMap output (live box: DP-0/DP-1 pair = 0);
		// the screen_N flag index is slotOrder + 1 (screen-consumer-port-resolve.js:39-40).
		gpuPhysicalTopology: [
			{ physicalPortId: 'port_1', slotOrder: 0, dpA: 'DP-1', connectorNumber: 1, location: null },
			{ physicalPortId: 'port_2', slotOrder: 1, dpA: 'DP-2', connectorNumber: 2, location: null },
			{ physicalPortId: 'port_3', slotOrder: 2, dpA: 'DP-3', connectorNumber: 3, location: null },
			{ physicalPortId: 'port_4', slotOrder: 3, dpA: 'DP-4', connectorNumber: 4, location: null },
		],
	}
}

// Mock display from getDisplayDetails
function mockDisplay(name, x, y) {
	return {
		name,
		connected: true,
		resolution: '1920x1080',
		x,
		y,
		refreshHz: 60,
		xrandrName: name,
		drmName: name,
		monitor: null,
		modes: [],
	}
}

// Mock connector from getGpuConnectorInventory
function mockConnector(name, connected = true) {
	return {
		name,
		shortName: name,
		connected,
		type: 'displayport',
		xrandrName: name,
	}
}

test('WO-246: one connected display, no flags → auto-single', () => {
	const config = configWithTopology({})
	const displays = [mockDisplay('DP-1', 0, 0)]
	const connectors = [mockConnector('DP-1'), mockConnector('DP-2', false), mockConnector('DP-3', false), mockConnector('DP-4', false)]
	const result = resolveOperatorMonitorPort(config, { displays, connectors })
	assert.equal(result.port, 1)
	assert.equal(result.mode, 'auto-single')
})

test('WO-246: one connected display, flag on different port → auto-single wins', () => {
	const config = configWithTopology({ screen_2_operator_monitor: true })
	const displays = [mockDisplay('DP-1', 0, 0)]
	const connectors = [mockConnector('DP-1'), mockConnector('DP-2', false), mockConnector('DP-3', false), mockConnector('DP-4', false)]
	const result = resolveOperatorMonitorPort(config, { displays, connectors })
	assert.equal(result.port, 1)
	assert.equal(result.mode, 'auto-single')
})

test('WO-246: two connected displays, flag set → flag wins', () => {
	const config = configWithTopology({ screen_2_operator_monitor: true })
	const displays = [
		mockDisplay('DP-1', 0, 0),
		mockDisplay('DP-2', 1920, 0),
	]
	const connectors = [mockConnector('DP-1'), mockConnector('DP-2'), mockConnector('DP-3', false), mockConnector('DP-4', false)]
	const result = resolveOperatorMonitorPort(config, { displays, connectors })
	assert.equal(result.port, 2)
	assert.equal(result.mode, 'flag')
})

test('WO-246: two connected displays, no flag → none', () => {
	const config = configWithTopology({})
	const displays = [
		mockDisplay('DP-1', 0, 0),
		mockDisplay('DP-2', 1920, 0),
	]
	const connectors = [mockConnector('DP-1'), mockConnector('DP-2'), mockConnector('DP-3', false), mockConnector('DP-4', false)]
	const result = resolveOperatorMonitorPort(config, { displays, connectors })
	assert.equal(result.port, null)
	assert.equal(result.mode, 'none')
})

test('WO-246: detection throws / empty displays, flag set → fallback-flag', () => {
	const config = configWithTopology({ screen_1_operator_monitor: true })
	// Simulate detection failure or empty displays by passing empty arrays
	const result = resolveOperatorMonitorPort(config, { displays: [], connectors: [] })
	assert.equal(result.port, 1)
	assert.equal(result.mode, 'fallback-flag')
})
