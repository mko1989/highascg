'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

test('handleCLS updates StateManager media (single catalog path)', () => {
	const { handleCLS } = require('../../src/utils/handlers')
	const { StateManager } = require('../../src/state/state-manager')
	const state = new StateManager()
	const ctx = { state, variables: {} }
	handleCLS(ctx, ['"clip1.mov" MOV 12345'])
	assert.equal(state.getState().media.length, 1)
	assert.equal(state.getState().media[0].id, 'clip1.mov')
	assert.equal(ctx.variables.media_count, '1')
})

test('createAppContext exposes CHOICES getters backed by StateManager', () => {
	const { createAppContext } = require('../../src/app-context')
	const { StateManager } = require('../../src/state/state-manager')
	const state = new StateManager()
	const ctx = createAppContext({
		config: { caspar: { host: '127.0.0.1', port: 5250 } },
		state,
		persistence: { get: () => null, set: () => {} },
		configManager: { factoryReset: () => false },
		multiviewLayout: null,
		casparHost: '127.0.0.1',
		casparPort: 5250,
		log: () => {},
		resetConfigToDefaults: () => false,
		setUiSelection: () => {},
	})
	state.updateFromCLS(['"a.mp4" MOV'])
	assert.equal(ctx.CHOICES_MEDIAFILES.length, 1)
	assert.equal(ctx.CHOICES_MEDIAFILES[0].id, 'a.mp4')
	assert.ok(ctx.liveDeck)
	assert.deepEqual(ctx.sceneDeck.looks, [])
})

test('LiveDeckState persists banks and scene deck', () => {
	const { createLiveDeckState } = require('../../src/state/live-deck-state')
	const store = {}
	const persistence = {
		get: (k) => store[k],
		set: (k, v) => {
			store[k] = v
		},
	}
	const liveDeck = createLiveDeckState(persistence)
	liveDeck.replaceProgramLayerBanks({ '1': { layers: [] } })
	liveDeck.persistProgramLayerBanks()
	assert.deepEqual(store.programLayerBankByChannel, { '1': { layers: [] } })

	liveDeck.setSceneDeck({ looks: [{ id: 'x' }], previewSceneId: 'p1' })
	assert.equal(store.scene_deck.previewSceneId, 'p1')
	assert.equal(store.scene_deck.looks[0].id, 'x')
})

test('persistSceneDeckForCtx persists plain test ctx without liveDeck', () => {
	const { persistSceneDeckForCtx } = require('../../src/state/live-deck-state')
	const store = {}
	const ctx = {
		persistence: { get: (k) => store[k], set: (k, v) => { store[k] = v } },
		sceneDeck: { looks: [{ id: 't' }], previewSceneId: 'pv', layerPresets: [], lookPresets: [] },
	}
	persistSceneDeckForCtx(ctx)
	assert.equal(store.scene_deck.previewSceneId, 'pv')
})

test('live-scene-state serializes concurrent setChannel on same channel', async () => {
	const persistence = require('../../src/utils/persistence')
	const { _resetSerializedQueueForTests } = require('../../src/utils/async-serial-queue')
	const live = require('../../src/state/live-scene-state')

	_resetSerializedQueueForTests()
	persistence.set(live.KEY, {})

	const delay = (ms) => new Promise((r) => setTimeout(r, ms))

	await Promise.all([
		(async () => {
			await delay(10)
			await live.setChannel(1, { sceneId: 'a', scene: { id: 'a' } })
		})(),
		(async () => {
			await delay(0)
			await live.setChannel(2, { sceneId: 'b', scene: { id: 'b' } })
		})(),
	])

	const all = live.getAll()
	assert.equal(all['1'].sceneId, 'a')
	assert.equal(all['2'].sceneId, 'b')
})
