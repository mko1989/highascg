const test = require('node:test')
const assert = require('node:assert/strict')
const { migrateScene } = require('../../client/lib/scene-state-helpers')
const { buildTakeJobs } = require('../../src/engine/scene-take-lbg-jobs')

test('scene state migration adds default playlist properties', () => {
	const rawScene = {
		id: 'test-scene',
		layers: [
			{
				layerNumber: 10,
				source: { type: 'media', value: 'video1' }
			}
		]
	}
	const migrated = migrateScene(rawScene)
	const layer = migrated.layers[0]
	assert.equal(layer.sourceMode, 'single')
	assert.deepEqual(layer.playlist, [])
	assert.deepEqual(layer.playlistTransition, { type: 'MIX', duration: 12, tween: 'linear' })
	assert.equal(layer.playlistLoop, true)
	assert.equal(layer.playlistAdvance, 'auto')
})

test('buildTakeJobs resolves auto advance to index 0 on first take', async () => {
	const layer = {
		layerNumber: 10,
		sourceMode: 'list',
		playlistAdvance: 'auto',
		playlistLoop: true,
		playlist: [
			{ id: '1', type: 'media', value: 'clipA' },
			{ id: '2', type: 'media', value: 'clipB' }
		]
	}
	
	const self = {
		playlistActiveIndices: {}
	}
	
	const currentMap = new Map()
	const incoming = { id: 'scene-abc' }
	const incomingSorted = [layer]
	
	const { takeJobs } = await buildTakeJobs({
		incomingSorted,
		currentMap,
		channel: 1,
		incoming,
		self,
		phys: (l, b) => l,
		inactiveBank: 'a',
		shouldRunBankCrossfade: false,
		forceCut: true,
		globalT: { type: 'CUT', duration: 0 },
		framerate: 50
	})
	
	assert.equal(takeJobs.length, 1)
	assert.equal(takeJobs[0].clip, 'clipA')
	assert.equal(self.playlistActiveIndices['scene-abc-10'], 0)
})

test('buildTakeJobs resolves manual advance and increments index', async () => {
	const layer = {
		layerNumber: 10,
		sourceMode: 'list',
		playlistAdvance: 'manual',
		playlistLoop: true,
		playlist: [
			{ id: '1', type: 'media', value: 'clipA' },
			{ id: '2', type: 'media', value: 'clipB' }
		]
	}
	
	const self = {
		playlistActiveIndices: {
			'scene-abc-10': 0
		}
	}
	
	const currentMap = new Map()
	const incoming = { id: 'scene-abc' }
	const incomingSorted = [layer]
	
	const opts = {
		incomingSorted,
		currentMap,
		channel: 1,
		incoming,
		self,
		phys: (l, b) => l,
		inactiveBank: 'a',
		shouldRunBankCrossfade: false,
		forceCut: true,
		globalT: { type: 'CUT', duration: 0 },
		framerate: 50
	}
	
	// First manual take - returns index 0 ('clipA'), sets nextIdx = 1
	const res1 = await buildTakeJobs(opts)
	assert.equal(res1.takeJobs[0].clip, 'clipA')
	assert.equal(self.playlistActiveIndices['scene-abc-10'], 1)
	
	// Second manual take - returns index 1 ('clipB'), sets nextIdx = 0 (loops)
	const res2 = await buildTakeJobs(opts)
	assert.equal(res2.takeJobs[0].clip, 'clipB')
	assert.equal(self.playlistActiveIndices['scene-abc-10'], 0)
})
