'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { slotListenEnabled } = require('../../src/artnet/artnet-slot-config')

test('T179.1: slotListenEnabled() defaults to false when property is undefined', () => {
	// Empty slot object should default to false
	assert.strictEqual(slotListenEnabled({}), false)
	assert.strictEqual(slotListenEnabled({ artnetPatch: {} }), false)
})

test('T179.1: slotListenEnabled() returns true when explicitly set', () => {
	assert.strictEqual(slotListenEnabled({ artnetListenEnabled: true }), true)
	assert.strictEqual(slotListenEnabled({ params: { artnetListenEnabled: true } }), true)
})

test('T179.1: slotListenEnabled() returns false when explicitly set to false', () => {
	assert.strictEqual(slotListenEnabled({ artnetListenEnabled: false }), false)
	assert.strictEqual(slotListenEnabled({ artnetListenEnabled: 0 }), false)
	assert.strictEqual(slotListenEnabled({ artnetListenEnabled: 'false' }), false)
	assert.strictEqual(slotListenEnabled({ artnetListenEnabled: '0' }), false)
})

test('T179.1: slotListenEnabled() handles null and undefined', () => {
	assert.strictEqual(slotListenEnabled(null), false)
	assert.strictEqual(slotListenEnabled(undefined), false)
	assert.strictEqual(slotListenEnabled({ artnetListenEnabled: null }), false)
	assert.strictEqual(slotListenEnabled({ artnetListenEnabled: undefined }), false)
})
