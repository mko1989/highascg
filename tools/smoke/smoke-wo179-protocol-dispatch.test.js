'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { slotLightingProtocol } = require('../../src/artnet/artnet-slot-config')

test('T179.4: slotLightingProtocol defaults to artnet when unset', () => {
	assert.strictEqual(slotLightingProtocol({}), 'artnet')
	assert.strictEqual(slotLightingProtocol(null), 'artnet')
	assert.strictEqual(slotLightingProtocol(undefined), 'artnet')
})

test('T179.4: slotLightingProtocol returns artnet when set to artnet', () => {
	assert.strictEqual(slotLightingProtocol({ lightingProtocol: 'artnet' }), 'artnet')
	assert.strictEqual(slotLightingProtocol({ params: { lightingProtocol: 'artnet' } }), 'artnet')
})

test('T179.4: slotLightingProtocol returns sacn when set to sacn', () => {
	assert.strictEqual(slotLightingProtocol({ lightingProtocol: 'sacn' }), 'sacn')
	assert.strictEqual(slotLightingProtocol({ params: { lightingProtocol: 'sacn' } }), 'sacn')
})

test('T179.4: slotLightingProtocol rejects invalid values', () => {
	assert.strictEqual(slotLightingProtocol({ lightingProtocol: 'invalid' }), 'artnet')
	assert.strictEqual(slotLightingProtocol({ lightingProtocol: 'osc' }), 'artnet')
	assert.strictEqual(slotLightingProtocol({ lightingProtocol: '' }), 'artnet')
})

test('T179.4: slotLightingProtocol prefers direct property over params', () => {
	assert.strictEqual(
		slotLightingProtocol({
			lightingProtocol: 'sacn',
			params: { lightingProtocol: 'artnet' },
		}),
		'sacn',
	)
})
