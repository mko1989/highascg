'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { patchDecklinkLiveSource } = require('../../src/api/host-live-decklink')

describe('host-live-decklink', () => {
	it('patchDecklinkLiveSource keeps host channel and route when device changes', () => {
		const existing = {
			type: 'route',
			routeType: 'decklink',
			value: 'route://12-2',
			inputsChannel: 12,
			inputsLayer: 2,
			decklinkSlot: 2,
			decklinkDevice: 1,
			connectorId: 'dlsdi_2',
			label: 'DeckLink 2',
		}
		const next = patchDecklinkLiveSource(existing, 3)
		assert.equal(next.value, 'route://12-2')
		assert.equal(next.inputsChannel, 12)
		assert.equal(next.decklinkSlot, 2)
		assert.equal(next.decklinkDevice, 3)
		assert.equal(next.connectorId, 'dlsdi_2')
	})
})
