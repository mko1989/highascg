'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { resolveLookAirComposeChannel } = require('../../src/engine/look-air-compose-channel')

const scenes = new Set(['look-a', 'look-b', 'look-c', 'look-x', 'look-z', 'main1-live', 'main1-prv', 'other'])
function mockSceneState(liveByMain, previewByMain) {
	return {
		getLiveSceneIdForMain: (idx) => liveByMain[idx] ?? null,
		getPreviewSceneIdForMain: (idx) => previewByMain[idx] ?? null,
		getScene: (id) => (scenes.has(String(id)) ? { id: String(id) } : null),
	}
}

const channelMap = {
	programChannels: [1, 3],
	previewChannels: [2, 4],
}

describe('resolveLookAirComposeChannel', () => {
	it('returns null for empty look id', () => {
		const st = mockSceneState({ 0: 'look-a' }, {})
		assert.equal(resolveLookAirComposeChannel('', 0, st, channelMap), null)
	})

	it('returns PGM channel when look is on program', () => {
		const st = mockSceneState({ 0: 'look-a' }, { 0: 'look-b' })
		assert.deepEqual(resolveLookAirComposeChannel('look-a', 0, st, channelMap), {
			bus: 'pgm',
			channel: 1,
		})
	})

	it('returns PRV channel when look is on preview only', () => {
		const st = mockSceneState({ 0: 'other' }, { 0: 'look-b' })
		assert.deepEqual(resolveLookAirComposeChannel('look-b', 0, st, channelMap), {
			bus: 'prv',
			channel: 2,
		})
	})

	it('PGM wins when same look is on both buses', () => {
		const st = mockSceneState({ 0: 'look-x' }, { 0: 'look-x' })
		assert.deepEqual(resolveLookAirComposeChannel('look-x', 0, st, channelMap), {
			bus: 'pgm',
			channel: 1,
		})
	})

	it('returns null when look is idle', () => {
		const st = mockSceneState({ 0: 'look-a' }, { 0: 'look-b' })
		assert.equal(resolveLookAirComposeChannel('look-c', 0, st, channelMap), null)
	})

	it('returns null when no separate PRV bus and look is preview-only in state', () => {
		const cm = { programChannels: [5], previewChannels: [5] }
		const st = mockSceneState({}, { 0: 'look-z' })
		assert.equal(resolveLookAirComposeChannel('look-z', 0, st, cm), null)
	})

	it('resolves per main index', () => {
		const st = mockSceneState({ 1: 'main1-live' }, { 1: 'main1-prv' })
		assert.deepEqual(resolveLookAirComposeChannel('main1-live', 1, st, channelMap), {
			bus: 'pgm',
			channel: 3,
		})
		assert.deepEqual(resolveLookAirComposeChannel('main1-prv', 1, st, channelMap), {
			bus: 'prv',
			channel: 4,
		})
	})

	it('prefers scene.live over stale client preview slot', () => {
		const st = mockSceneState({ 0: 'look-b' }, { 0: 'look-c' })
		const sceneLive = { '1': { sceneId: 'look-b' }, '2': { sceneId: 'look-a' } }
		assert.deepEqual(resolveLookAirComposeChannel('look-a', 0, st, channelMap, sceneLive), {
			bus: 'prv',
			channel: 2,
		})
		assert.equal(resolveLookAirComposeChannel('look-c', 0, st, channelMap, sceneLive), null)
	})
})
