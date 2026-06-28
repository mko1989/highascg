'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { syncMainSlotsFromSceneLive, resolveBusLookIdsForMain } = require('../../src/engine/scene-live-main-sync')

const channelMap = {
	programChannels: [1],
	previewChannels: [2],
}

const scenes = new Set(['look-a', 'look-b', 'look-c', 'look-x'])
const exists = (id) => scenes.has(id)

describe('syncMainSlotsFromSceneLive', () => {
	it('syncs PGM and PRV from scene.live', () => {
		const channels = {
			'1': { sceneId: 'look-b' },
			'2': { sceneId: 'look-a' },
		}
		const out = syncMainSlotsFromSceneLive(channels, channelMap, exists)
		assert.deepEqual(out.liveSceneIdByMain[0], 'look-b')
		assert.deepEqual(out.previewSceneIdByMain[0], 'look-a')
		assert.equal(out.changed, true)
	})

	it('updates preview after pgm/prv exchange (stale client cue replaced)', () => {
		const channels = {
			'1': { sceneId: 'look-b' },
			'2': { sceneId: 'look-a' },
		}
		const out = syncMainSlotsFromSceneLive(channels, channelMap, exists, {
			liveSceneIdByMain: ['look-b', null, null, null],
			previewSceneIdByMain: ['look-c', null, null, null],
		})
		assert.deepEqual(out.previewSceneIdByMain[0], 'look-a')
		assert.equal(out.changed, true)
	})

	it('clears PGM slot when channel empty', () => {
		const out = syncMainSlotsFromSceneLive({}, channelMap, exists, {
			liveSceneIdByMain: ['look-a', null, null, null],
			previewSceneIdByMain: [null, null, null, null],
		})
		assert.equal(out.liveSceneIdByMain[0], null)
		assert.equal(out.changed, true)
	})

	it('ignores PRV sync when bus shares PGM channel', () => {
		const shared = { programChannels: [5], previewChannels: [5] }
		const out = syncMainSlotsFromSceneLive({ '5': { sceneId: 'look-a' } }, shared, exists, {
			liveSceneIdByMain: [null, null, null, null],
			previewSceneIdByMain: ['look-c', null, null, null],
		})
		assert.equal(out.liveSceneIdByMain[0], 'look-a')
		assert.equal(out.previewSceneIdByMain[0], 'look-c')
	})

	it('no change when already in sync', () => {
		const channels = { '1': { sceneId: 'look-b' }, '2': { sceneId: 'look-a' } }
		const out = syncMainSlotsFromSceneLive(channels, channelMap, exists, {
			liveSceneIdByMain: ['look-b', null, null, null],
			previewSceneIdByMain: ['look-a', null, null, null],
		})
		assert.equal(out.changed, false)
	})
})

describe('resolveBusLookIdsForMain', () => {
	const multiMap = {
		programChannels: [1, 3],
		previewChannels: [2, 4],
	}

	it('maps each main to its own PGM/PRV channels', () => {
		const sceneLive = {
			'1': { sceneId: 'look-b' },
			'2': { sceneId: 'look-a' },
			'3': { sceneId: 'look-c' },
			'4': { sceneId: 'look-x' },
		}
		assert.deepEqual(resolveBusLookIdsForMain(0, sceneLive, multiMap, exists), {
			pgmLookId: 'look-b',
			prvLookId: 'look-a',
		})
		assert.deepEqual(resolveBusLookIdsForMain(1, sceneLive, multiMap, exists), {
			pgmLookId: 'look-c',
			prvLookId: 'look-x',
		})
	})

	it('does not cross-assign preview from another main', () => {
		const sceneLive = {
			'1': { sceneId: 'look-b' },
			'2': { sceneId: 'look-a' },
			'3': { sceneId: 'look-c' },
		}
		assert.deepEqual(resolveBusLookIdsForMain(1, sceneLive, multiMap, exists), {
			pgmLookId: 'look-c',
			prvLookId: null,
		})
	})

	it('falls back to client preview when server PRV channel is empty', () => {
		const sceneLive = {
			'1': { sceneId: 'look-b' },
		}
		const fallback = {
			getLiveSceneIdForMain: () => null,
			getPreviewSceneIdForMain: () => 'look-a',
		}
		assert.deepEqual(resolveBusLookIdsForMain(0, sceneLive, multiMap, exists, fallback), {
			pgmLookId: 'look-b',
			prvLookId: 'look-a',
		})
	})
})
