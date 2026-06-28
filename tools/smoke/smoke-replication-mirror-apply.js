'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

function reloadMirrorApply() {
	const mirrorPath = path.resolve(__dirname, '../../src/replication/mirror-apply.js')
	delete require.cache[mirrorPath]
	return require('../../src/replication/mirror-apply')
}

test('mirror apply passes incomingScene (not scene) to runSceneTakeLbg', async (t) => {
	const sceneTakeLbg = require('../../src/engine/scene-take-lbg')
	const projectScenes = require('../../src/engine/project-scenes')
	const origTake = sceneTakeLbg.runSceneTakeLbg
	const origLoad = projectScenes.loadFullProject

	/** @type {object|null} */
	let captured = null
	sceneTakeLbg.runSceneTakeLbg = async (_amcp, opts) => {
		captured = opts
		return { layersApplied: 1, takeJobs: 1, diff: { exit: 0 } }
	}
	projectScenes.loadFullProject = async () => ({
		scenes: {
			scenes: [
				{
					id: 'look-mirror',
					layers: [{ layerNumber: 10, source: { type: 'media', value: 'clip.mov' } }],
				},
			],
		},
	})

	t.after(() => {
		sceneTakeLbg.runSceneTakeLbg = origTake
		projectScenes.loadFullProject = origLoad
		delete require.cache[path.resolve(__dirname, '../../src/replication/mirror-apply.js')]
	})

	const { applyLiveIntentOnFollower } = reloadMirrorApply()
	const config = {
		screen_count: 1,
		casparServer: { screen_count: 1, channel_layout: 'mono' },
		screenDestinations: [{ id: 'm1', mainScreenIndex: 0, mode: 'pgm_prv' }],
	}
	const ctx = { config, amcp: {}, log: () => {} }
	const repl = { followerMode: 'mirror' }
	const packet = {
		seq: 1,
		intent: { channels: { 1: { sceneId: 'look-mirror', updatedAt: 42 } } },
	}

	const result = await applyLiveIntentOnFollower(ctx, packet, repl)
	assert.equal(result.applied, true)
	assert.equal(result.channelsApplied, 1)
	assert.ok(captured, 'expected runSceneTakeLbg to be called')
	assert.equal(captured.incomingScene?.id, 'look-mirror')
	assert.ok(Array.isArray(captured.incomingScene.layers))
	assert.equal(captured.pgmOnly, true)
	assert.equal(captured.forceCut, false)
})

test('mirror apply honors leader forceCut in channel intent', async (t) => {
	const sceneTakeLbg = require('../../src/engine/scene-take-lbg')
	const projectScenes = require('../../src/engine/project-scenes')
	const origTake = sceneTakeLbg.runSceneTakeLbg
	const origLoad = projectScenes.loadFullProject

	/** @type {object|null} */
	let captured = null
	sceneTakeLbg.runSceneTakeLbg = async (_amcp, opts) => {
		captured = opts
		return { layersApplied: 1, takeJobs: 1, diff: { exit: 0 } }
	}
	projectScenes.loadFullProject = async () => ({
		scenes: {
			scenes: [
				{
					id: 'look-mirror',
					layers: [{ layerNumber: 10, source: { type: 'media', value: 'clip.mov' } }],
				},
			],
		},
	})

	t.after(() => {
		sceneTakeLbg.runSceneTakeLbg = origTake
		projectScenes.loadFullProject = origLoad
		delete require.cache[path.resolve(__dirname, '../../src/replication/mirror-apply.js')]
	})

	const { applyLiveIntentOnFollower } = reloadMirrorApply()
	const config = {
		screen_count: 1,
		casparServer: { screen_count: 1, channel_layout: 'mono' },
		screenDestinations: [{ id: 'm1', mainScreenIndex: 0, mode: 'pgm_prv' }],
	}
	const ctx = { config, amcp: {}, log: () => {} }
	const repl = { followerMode: 'mirror' }
	const packet = {
		seq: 2,
		intent: { channels: { 1: { sceneId: 'look-mirror', updatedAt: 43, forceCut: true } } },
	}

	await applyLiveIntentOnFollower(ctx, packet, repl)
	assert.equal(captured?.forceCut, true)
})
