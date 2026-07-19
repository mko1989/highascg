'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const defaults = require('../../src/config/defaults')
const { createNewProject, buildStarterHardwareConfig } = require('../../src/engine/new-project')

const fakePersistence = {
	_store: {},
	get(k) {
		return this._store[k]
	},
	set(k, v) {
		this._store[k] = v
	},
}

function makeCtx(mediaRoot) {
	const cfg = JSON.parse(JSON.stringify(defaults))
	cfg.local_media_path = mediaRoot
	return {
		config: cfg,
		configManager: {
			get() {
				return cfg
			},
			save(next) {
				Object.assign(cfg, next)
			},
		},
		persistence: fakePersistence,
		sceneDeck: { looks: [{ id: 'old' }], previewSceneId: 'old' },
	}
}

test('buildStarterHardwareConfig yields one operator-GUI destination (WO-264)', () => {
	const { hardwareConfig } = buildStarterHardwareConfig(fakePersistence)
	const dests = hardwareConfig.screenDestinations?.destinations || []
	assert.equal(dests.length, 1)
	assert.equal(dests[0].id, 'dst_operator_gui')
	assert.equal(dests[0].mode, 'operator_gui')
	assert.equal(dests[0].autoLaunch, true)
	assert.equal(hardwareConfig.casparServer?.screen_count, 1)
})

test('createNewProject resets routing and persists empty Untitled project', () => {
	const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hacg-new-project-'))
	try {
		const ctx = makeCtx(mediaRoot)
		ctx.config.screenDestinations = {
			version: 1,
			destinations: [
				{ id: 'dst_pgm_1', label: 'PGM 1', mainScreenIndex: 0, mode: 'pgm_only', caspar: { bus: 'pgm' } },
				{ id: 'dst_pgm_2', label: 'PGM 2', mainScreenIndex: 1, mode: 'pgm_only', caspar: { bus: 'pgm' } },
			],
			edidNotes: '',
		}
		ctx.config.casparServer = { ...(ctx.config.casparServer || {}), screen_count: 2 }
		ctx.config.screen_count = 2
		ctx.config.deviceGraph = {
			version: 1,
			devices: [
				{ id: 'caspar_host', role: 'caspar_host', label: 'Caspar / HighAsCG host' },
				{ id: 'destinations', role: 'destinations', label: 'Screen destinations' },
			],
			connectors: [
				{
					id: 'caspar_mv_out',
					deviceId: 'caspar_host',
					kind: 'caspar_mv_out',
					label: 'Multiview channel (virtual)',
					externalRef: '3',
				},
				{
					id: 'dst_in_dst_mv1',
					deviceId: 'destinations',
					kind: 'destination_in',
					label: 'Multiview 1',
					externalRef: 'dst_mv1',
				},
			],
			edges: [{ id: 'e1', sourceId: 'dst_in_dst_mv1', sinkId: 'caspar_mv_out' }],
			layout: {},
		}

		const { project, slug } = createNewProject(ctx)
		assert.equal(slug, 'untitled')
		assert.equal(project.name, 'Untitled')
		assert.deepEqual(project.scenes.scenes, [])
		assert.deepEqual(project.scenes.mainEditorVisible, [true, true, true, true])
		assert.equal(ctx.config.screenDestinations.destinations.length, 1)
		assert.equal(ctx.config.casparServer.screen_count, 1)
		assert.equal(ctx.config.casparServer.multiview_enabled, false)
		assert.equal(ctx.sceneDeck.looks.length, 0)
		assert.equal(ctx.sceneDeck.previewSceneId, null)
		assert.equal(fakePersistence._store.scene_deck.looks.length, 0)
		assert.equal(fakePersistence._store.web_project.name, 'Untitled')
		assert.equal(
			(ctx.config.deviceGraph.connectors || []).some((c) => c.kind === 'caspar_mv_out'),
			false,
		)
		assert.equal((ctx.config.deviceGraph.edges || []).length, 0)
		assert.equal(fakePersistence._store.multiviewLayout, null)
		assert.deepEqual(ctx.config.extraLiveSources, [])
	} finally {
		fs.rmSync(mediaRoot, { recursive: true, force: true })
	}
})
