'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { resolveMonitoredChannels } = require('../../src/preview/compose-preview-mode')

describe('compose-preview monitored channels', () => {
	it('includes PGM/PRV plus live input and host channels', () => {
		const config = {
			screen_count: 1,
			composePreview: { mode: 'ffmpeg_jpeg', channels: 'compose_visible' },
			casparServer: {
				screen_1_mode: '1080p5000',
				decklink_input_count: 1,
				decklink_input_1_device: 1,
				decklink_input_1_direction: 'in',
			},
			extraLiveSources: [
				{
					type: 'browser',
					sourceId: 'web_a',
					hostChannel: 8,
					hostLayer: 1,
					templateOrUrl: 'http://example/',
				},
			],
		}
		const channels = resolveMonitoredChannels(config)
		assert.ok(channels.includes(1), 'PGM')
		assert.ok(channels.includes(2), 'PRV')
		assert.ok(channels.some((ch) => ch >= 3), 'DeckLink input channel')
		assert.ok(channels.includes(8), 'webpage host channel')
	})
})
