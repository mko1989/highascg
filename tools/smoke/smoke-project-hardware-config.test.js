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

test('applyHardwareConfigFromProject skips empty hardwareConfig', () => {
	const cfg = cloneCfg()
	cfg.screenDestinations = {
		version: 1,
		destinations: [
			{
				id: 'dst_keep',
				label: 'PGM 1',
				mainScreenIndex: 0,
				mode: 'pgm_only',
				videoMode: '1080p5000',
				width: 1920,
				height: 1080,
				fps: 50,
				caspar: { bus: 'pgm' },
			},
		],
		edidNotes: '',
	}
	const ctx = {
		config: cfg,
		configManager: {
			get: () => cfg,
			save: (next) => {
				Object.assign(cfg, next)
				return true
			},
		},
		logs: [],
		log(level, msg) {
			this.logs.push(`${level}:${msg}`)
		},
	}
	phc.applyHardwareConfigFromProject(ctx, {
		version: 2,
		name: 'tacja2',
		hardwareConfig: {
			version: 2,
			deviceGraph: { version: 1, devices: [], connectors: [], edges: [] },
			screenDestinations: { version: 1, destinations: [], edidNotes: '' },
		},
	})
	assert.equal(cfg.screenDestinations.destinations.length, 1)
	assert.ok(ctx.logs.some((l) => l.includes('Skipped empty hardwareConfig')))
})

test('apply-hardware route applies routing extras from hardwareConfig', async () => {
	const routesData = require('../../src/api/routes-data')
	const defaults = require('../../src/config/defaults')
	const cfg = JSON.parse(JSON.stringify(defaults))
	cfg.audioRouting = { version: 1, channels: [{ id: 'pgm1', label: 'PGM 1' }] }
	cfg.deviceGraph = {
		version: 1,
		devices: [],
		connectors: [{ id: 'gpu_p0', kind: 'gpu_out', label: 'GPU 0' }],
		edges: [],
	}
	cfg.screenDestinations = {
		version: 1,
		destinations: [
			{
				id: 'dst_pgm1',
				label: 'PGM 1',
				mainScreenIndex: 0,
				mode: 'pgm_only',
				videoMode: '1080p5000',
				width: 1920,
				height: 1080,
				fps: 50,
				caspar: { bus: 'pgm' },
			},
		],
		edidNotes: '',
	}
	const ctx = {
		config: cfg,
		configManager: {
			get: () => cfg,
			save: (next) => Object.assign(cfg, next),
		},
	}
	const hc = phc.buildHardwareConfigFromConfig(cfg, fakePersistence)
	hc.audioRouting = { version: 1, channels: [{ id: 'saved', label: 'Saved PGM' }] }

	const res = await routesData.handleProject('/api/project/apply-hardware', JSON.stringify({ hardwareConfig: hc }), ctx)
	assert.equal(res.status, 200)
	const body = JSON.parse(res.body)
	assert.equal(body.ok, true)
	assert.equal(body.applied, true)
	assert.equal(cfg.audioRouting.channels[0].id, 'saved')
	assert.equal(cfg.deviceGraph.connectors.length, 1)
})
