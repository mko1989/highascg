'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { getChannelMap } = require('../../src/config/routing-map')
const { resolveDecklinkInputSlots } = require('../../src/config/decklink-input-slots')

describe('decklink-input-slots', () => {
	it('legacy count-only config keeps slots 1..N as inputs', () => {
		const config = {
			decklink_input_count: 3,
			casparServer: { decklink_input_count: 3, inputs_channel_mode: '1080p5000' },
		}
		assert.deepEqual(resolveDecklinkInputSlots(config), [1, 2, 3])
		const map = getChannelMap(config)
		assert.equal(map.decklinkInputChannels.length, 3)
	})

	it('device graph SSOT: only ports marked input get host channels', () => {
		const config = {
			decklink_input_count: 4,
			casparServer: {
				decklink_input_count: 4,
				decklink_input_4_direction: 'in',
				decklink_input_4_device: 4,
				inputs_channel_mode: '1080p5000',
			},
			deviceGraph: {
				connectors: [
					{ id: 'dlsdi_1', kind: 'decklink_io', index: 0, externalRef: '1', caspar: { ioDirection: 'unassigned' } },
					{ id: 'dlsdi_2', kind: 'decklink_io', index: 1, externalRef: '2', caspar: { ioDirection: 'out' } },
					{ id: 'dlsdi_3', kind: 'decklink_io', index: 2, externalRef: '3', caspar: { ioDirection: 'unassigned' } },
					{ id: 'dlsdi_4', kind: 'decklink_io', index: 3, externalRef: '4', caspar: { ioDirection: 'in' } },
				],
				edges: [],
			},
			screenDestinations: { version: 1, destinations: [], edidNotes: '' },
		}
		assert.deepEqual(resolveDecklinkInputSlots(config), [4])
		const map = getChannelMap({ ...config, screen_count: 1, casparServer: { ...config.casparServer, screen_count: 1 } })
		assert.equal(map.decklinkInputChannels.length, 1)
		assert.equal(map.inputChannels.find((e) => e.kind === 'decklink')?.slot, 4)
	})

	it('explicit per-slot directions without graph: only direction=in slots', () => {
		const config = {
			decklink_input_count: 3,
			casparServer: {
				decklink_input_count: 3,
				decklink_input_1_direction: 'in',
				decklink_input_1_device: 1,
				decklink_input_2_direction: 'out',
				decklink_input_3_direction: 'in',
				decklink_input_3_device: 3,
			},
		}
		assert.deepEqual(resolveDecklinkInputSlots(config), [1, 3])
	})
})
