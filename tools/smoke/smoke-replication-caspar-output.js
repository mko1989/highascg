'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { assessFollowerCasparOutputReadiness } = require('../../src/replication/follower-caspar-output')

test('repairFollowerDecklinkGraph sets SDI format from leader destination', () => {
	const ctx = {
		config: {
			screen_count: 1,
			casparServer: {
				screen_count: 1,
				screen_1_decklink_device: 1,
				decklink_input_1_device: 1,
			},
			screenDestinations: {
				destinations: [
					{
						id: 'pgm1',
						label: 'PGM 1',
						mainScreenIndex: 0,
						mode: 'pgm_only',
						videoMode: '1080p5000',
						width: 1920,
						height: 1080,
						fps: 50,
					},
				],
			},
			deviceGraph: {
				version: 1,
				devices: [{ id: 'caspar_host', role: 'caspar_host', label: 'Host' }],
				connectors: [
					{
						id: 'dlsdi_1',
						deviceId: 'caspar_host',
						kind: 'decklink_io',
						externalRef: '1',
						caspar: { ioDirection: 'out', bus: 'pgm', mainIndex: 0 },
					},
				],
				edges: [],
			},
			replication: { enabled: true, role: 'follower' },
		},
		configManager: {
			get() {
				return JSON.parse(JSON.stringify(ctx.config))
			},
			save(next) {
				Object.assign(ctx.config, next)
			},
		},
		_replication: { roleState: { getRole: () => 'follower' } },
	}

	const { repairFollowerDecklinkGraph, assessFollowerCasparOutputReadiness } = require('../../src/replication/follower-caspar-output')
	const { resolveSdiModeFromDestination } = require('../../src/replication/follower-caspar-output')

	assert.equal(resolveSdiModeFromDestination(ctx.config.screenDestinations.destinations[0]), '1080p5000')

	const r = repairFollowerDecklinkGraph(ctx)
	assert.equal(r.changed, true)
	const conn = ctx.config.deviceGraph.connectors.find((c) => c.id === 'dlsdi_1')
	assert.equal(conn.caspar.decklinkOutputVideoMode, '1080p5000')
	assert.equal(ctx.config.casparServer.decklink_input_1_device, 0)
	assert.ok(ctx.config.deviceGraph.edges.some((e) => e.sourceId === 'dst_in_pgm1' && e.sinkId === 'dlsdi_1'))
})

test('follower caspar output warns when DeckLink missing from caspar config file', () => {
	const tmpCaspar = path.join(os.tmpdir(), `caspar-test-${process.pid}.config`)
	fs.writeFileSync(
		tmpCaspar,
		`<!-- Caspar channel 1: Screen 1 program output (PGM) -->
        <channel>
            <consumers><screen/></consumers>
        </channel>`,
	)

	const mod = require('../../src/replication/follower-caspar-output')
	const origPath = mod.CASPAR_CONFIG_PATH
	Object.defineProperty(mod, 'CASPAR_CONFIG_PATH', { value: tmpCaspar, configurable: true })

	const ctx = {
		config: {
			screen_count: 1,
			casparServer: {
				screen_count: 1,
				screen_1_decklink_device: 3,
				screen_1_decklink_replace_screen: true,
				screen_1_mode: 'custom',
				screen_1_width: 3072,
				screen_1_height: 1728,
				screen_1_fps: 50,
			},
			screenDestinations: [{ id: 'm1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: 'custom', width: 3072, height: 1728, fps: 50 }],
			deviceGraph: {
				connectors: [
					{
						id: 'dlsdi_3',
						kind: 'decklink_io',
						externalRef: 3,
						caspar: {
							ioDirection: 'out',
							outputBinding: { type: 'screen', index: 1 },
							decklinkOutputVideoMode: '2160p5000',
						},
					},
				],
				edges: [],
			},
			replication: { enabled: true, role: 'follower' },
		},
		_replication: { roleState: { getRole: () => 'follower' } },
	}

	try {
		const st = assessFollowerCasparOutputReadiness(ctx)
		assert.equal(st.ok, false)
		assert.ok(st.warnings.some((w) => w.code === 'decklink_missing_from_caspar_config'))
	} finally {
		Object.defineProperty(mod, 'CASPAR_CONFIG_PATH', { value: origPath, configurable: true })
		fs.unlinkSync(tmpCaspar)
	}
})

test('applyLocalMachineProfileToConfig prefers live deviceGraph over stale project hardwareConfig', () => {
	const { applyLocalMachineProfileToConfig } = require('../../src/replication/follower-machine-profile')
	const ctx = {
		config: {
			deviceGraph: {
				version: 1,
				edges: [{ id: 'e1', sourceId: 'dst_in_pgm1', sinkId: 'gpu_p0' }],
				connectors: [
					{ id: 'dst_in_pgm1', kind: 'destination_in', externalRef: 'pgm1' },
					{ id: 'gpu_p0', kind: 'gpu_out' },
				],
			},
			casparServer: { screen_count: 1 },
			replication: { enabled: true, role: 'follower' },
		},
		configManager: {
			get() {
				return JSON.parse(JSON.stringify(ctx.config))
			},
			save(next) {
				Object.assign(ctx.config, next)
			},
		},
		_replication: { roleState: { getRole: () => 'follower' } },
	}
	const staleProject = {
		version: 2,
		deviceGraph: { version: 1, edges: [], connectors: [] },
		casparServer: { screen_count: 1, screen_1_decklink_device: 99 },
	}
	applyLocalMachineProfileToConfig(ctx, staleProject)
	assert.equal(ctx.config.deviceGraph.edges.length, 1)
	assert.equal(ctx.config.deviceGraph.edges[0].sinkId, 'gpu_p0')
	assert.notEqual(ctx.config.casparServer.screen_1_decklink_device, 99)
})

test('follower GPU + DeckLink cabling yields screen and decklink consumers in generated config', () => {
	const defaults = require('../../src/config/defaults')
	const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
	const { buildConfigXml } = require('../../src/config/config-generator')

	const app = JSON.parse(JSON.stringify(defaults))
	app.screen_count = 1
	app.casparServer = {
		...app.casparServer,
		screen_count: 1,
		screen_1_mode: '1080p5000',
		screen_1_decklink_replace_screen: true,
	}
	app.screenDestinations = {
		version: 1,
		destinations: [
			{
				id: 'pgm1',
				label: 'PGM 1',
				mainScreenIndex: 0,
				mode: 'pgm_only',
				videoMode: '1080p5000',
				width: 1920,
				height: 1080,
				fps: 50,
			},
		],
	}
	app.deviceGraph = {
		version: 1,
		connectors: [
			{ id: 'dst_in_pgm1', kind: 'destination_in', externalRef: 'pgm1' },
			{ id: 'gpu_p0', kind: 'gpu_out' },
			{
				id: 'dlsdi_1',
				kind: 'decklink_io',
				externalRef: '1',
				caspar: { ioDirection: 'out', decklinkOutputVideoMode: '1080p5000' },
			},
		],
		edges: [
			{ id: 'e_gpu', sourceId: 'dst_in_pgm1', sinkId: 'gpu_p0' },
			{ id: 'e_dl', sourceId: 'dst_in_pgm1', sinkId: 'dlsdi_1' },
		],
	}

	const flat = buildCasparGeneratorFlatConfig(app)
	assert.equal(flat.screen_1_screen_consumer, true)
	assert.equal(flat.screen_1_decklink_replace_screen, false)
	assert.equal(flat.screen_1_decklink_device, 1)

	const xml = buildConfigXml(flat)
	const pgmBlock = xml.match(/Caspar channel 1:[\s\S]*?<\/channel>/)
	assert.ok(pgmBlock, 'PGM channel block present')
	assert.match(pgmBlock[0], /<screen>/)
	assert.match(pgmBlock[0], /<decklink>/)
})
