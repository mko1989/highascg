'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { buildChannelMap } = require('../../src/config/channel-map-from-ctx')
const defaults = require('../../src/config/defaults')

describe('channel-map decklink after factory reset', () => {
	it('ignores stale running Caspar decklink when settings say count 0', () => {
		const ctx = {
			config: {
				...defaults,
				casparServer: {
					...defaults.casparServer,
					decklink_input_count: 0,
				},
			},
			gatheredInfo: {
				decklinkFromConfig: {
					decklinkCount: 2,
					inputsCh: 5,
					inputsResolution: { w: 1920, h: 1080, fps: 50 },
				},
			},
		}
		const cm = buildChannelMap(ctx)
		assert.equal(cm.decklinkCount, 0)
		assert.equal(cm.inputsCh, null)
		assert.deepEqual(cm.decklinkInputChannels, [])
		assert.deepEqual(cm.inputChannels.filter((e) => e.kind === 'decklink'), [])
	})
})
