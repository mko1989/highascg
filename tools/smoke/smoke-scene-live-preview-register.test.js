'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { handlePreviewLiveRegister } = require('../../src/api/routes-scene')

describe('handlePreviewLiveRegister', () => {
	it('registers preview look on mapped PRV channel and broadcasts scene.live', () => {
		const liveSceneState = require('../../src/state/live-scene-state')
		const KEY = liveSceneState.KEY
		const persistence = require('../../src/utils/persistence')
		const prev = persistence.get(KEY)
		persistence.set(KEY, { '1': { sceneId: 'pgm-old', scene: { id: 'pgm-old', layers: [] } } })

		const broadcasts = []
		const ctx = {
			config: {
				machineProfile: { defaultProjectFps: 50 },
				screen_count: 1,
				casparServer: { screen_count: 1, channel_layout: 'mono' },
				screenDestinations: [{ id: 'm1', mainScreenIndex: 0, mode: 'pgm_prv' }],
			},
			gatheredInfo: {},
			switcherOutputBusByChannel: {},
			programLayerBankByChannel: {},
			_wsBroadcast: (type, payload) => broadcasts.push({ type, payload }),
		}

		const scene = {
			id: 'look-edit',
			name: 'Edited',
			layers: [{ layerNumber: 10, source: { type: 'media', value: 'clip.mp4' } }],
		}

		const res = handlePreviewLiveRegister(
			JSON.stringify({ sceneId: 'look-edit', mainIndex: 0, incomingScene: scene }),
			ctx,
		)
		assert.equal(res.status, 200)
		const body = JSON.parse(res.body)
		assert.equal(body.ok, true)
		assert.equal(body.previewChannel, 2)
		assert.equal(body.sceneLive['2'].sceneId, 'look-edit')
		assert.ok(broadcasts.some((b) => b.payload?.path === 'scene.live'))

		persistence.set(KEY, prev)
	})
})
