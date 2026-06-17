'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	LOOK_LAYER_MIN,
	PGM_AUDIO_TRACK_LAYER_MAX,
	isLookPhysicalLayer,
	isPgmAudioTrackPhysicalLayer,
	isPgmAudioTrackPhysicalLayerOnChannel,
} = require('../../src/engine/look-layer-ranges')

test('look layer range constants', () => {
	assert.equal(LOOK_LAYER_MIN, 10)
	assert.equal(PGM_AUDIO_TRACK_LAYER_MAX, 9)
})

test('isPgmAudioTrackPhysicalLayer covers bank A and B audio slots', () => {
	assert.equal(isPgmAudioTrackPhysicalLayer(1), true)
	assert.equal(isPgmAudioTrackPhysicalLayer(9), true)
	assert.equal(isPgmAudioTrackPhysicalLayer(10), false)
	assert.equal(isPgmAudioTrackPhysicalLayer(101), true)
	assert.equal(isPgmAudioTrackPhysicalLayer(109), true)
	assert.equal(isPgmAudioTrackPhysicalLayer(110), false)
})

test('isLookPhysicalLayer starts at 10 and excludes audio slots', () => {
	assert.equal(isLookPhysicalLayer(9), false)
	assert.equal(isLookPhysicalLayer(10), true)
	assert.equal(isLookPhysicalLayer(99), true)
	assert.equal(isLookPhysicalLayer(109), false)
	assert.equal(isLookPhysicalLayer(110), true)
})

test('audio track protection applies on program channel only', () => {
	const cfg = { screen_count: 1 }
	assert.equal(isPgmAudioTrackPhysicalLayerOnChannel(cfg, 1, 2), true)
	assert.equal(isPgmAudioTrackPhysicalLayerOnChannel(cfg, 99, 2), false)
})
