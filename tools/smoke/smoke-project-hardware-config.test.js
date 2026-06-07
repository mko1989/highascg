'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const defaults = require('../../src/config/defaults')
const phc = require('../../src/engine/project-hardware-config')

function cloneCfg() {
	return JSON.parse(JSON.stringify(defaults))
}

const fakePersistence = {
	_store: {},
	get(k) {
		return this._store[k]
	},
	set(k, v) {
		this._store[k] = v
	},
}

test('buildHardwareConfigFromConfig includes osDisplay and gpuPhysicalTopology', () => {
	const cfg = cloneCfg()
	cfg.screen_1_os_x = 1920
	cfg.screen_1_os_y = 0
	cfg.screen_1_os_mode = '1920x1080'
	cfg.gpuPhysicalTopology = [
		{ physicalPortId: 'gpu_p0', slotOrder: 0, dpA: 'DP-0', dpB: 'DP-1', connectorNumber: 0, location: 0 },
	]
	fakePersistence._store = { multiviewLayout: { rows: 2 } }

	const hc = phc.buildHardwareConfigFromConfig(cfg, fakePersistence)
	assert.equal(hc.version, 2)
	assert.ok(hc.deviceGraph)
	assert.ok(hc.screenDestinations)
	assert.equal(hc.osDisplay.screen_1_os_x, 1920)
	assert.equal(hc.osDisplay.screen_1_os_mode, '1920x1080')
	assert.equal(hc.gpuPhysicalTopology.length, 1)
	assert.deepEqual(hc.multiviewLayout, { rows: 2 })
})

test('applyHardwareConfigToCtx restores v2 osDisplay onto config', () => {
	const cfg = cloneCfg()
	const hc = phc.buildHardwareConfigFromConfig(cfg, fakePersistence)
	hc.osDisplay.screen_2_os_x = 3840
	hc.osDisplay.screen_2_os_mode = '1920x1080'

	const ctx = {
		config: cfg,
		configManager: {
			get: () => cfg,
			save: (next) => Object.assign(cfg, next),
		},
		persistence: fakePersistence,
	}

	const ok = phc.applyHardwareConfigToCtx(ctx, hc)
	assert.equal(ok, true)
	assert.equal(cfg.screen_2_os_x, 3840)
	assert.equal(cfg.screen_2_os_mode, '1920x1080')
})

test('legacy v1 hardwareConfig without osDisplay still applies graph', () => {
	const cfg = cloneCfg()
	const legacy = {
		deviceGraph: cfg.deviceGraph,
		screenDestinations: cfg.screenDestinations,
		casparServer: cfg.casparServer,
	}
	cfg.deviceGraph = { version: 1, devices: [], edges: [] }

	const ctx = {
		config: cfg,
		configManager: {
			get: () => cfg,
			save: (next) => Object.assign(cfg, next),
		},
		persistence: fakePersistence,
	}

	assert.equal(phc.applyHardwareConfigToCtx(ctx, legacy), true)
	assert.equal(cfg.deviceGraph.version, 1)
})
