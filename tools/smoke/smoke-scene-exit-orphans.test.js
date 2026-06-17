'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	collectOrphanLookLogicalLayers,
	collectOrphanLookPhysicalLayers,
	logicalLayerFromPhysicalLookLayer,
} = require('../../src/engine/scene-exit-layers')

test('logical 110 on bank A stays 110 (not mistaken for bank-B logical 10)', () => {
	assert.equal(logicalLayerFromPhysicalLookLayer(110, 'a'), 110)
	assert.equal(logicalLayerFromPhysicalLookLayer(110, 'b'), 10)
})

test('orphan detection uses incoming inactive-bank physical targets', () => {
	const ch = 99
	const self = {
		_playbackMatrix: {
			[`${ch}-110`]: { channel: ch, layer: 110, playing: true },
		},
		config: { screen_count: 1 },
	}
	const incoming = {
		layers: [{ layerNumber: 10, source: { type: 'media', value: 'clip.mov' } }],
	}
	// Incoming loads on bank A → physical 10; stale bank-B slot 110 is a physical orphan only.
	const logical = collectOrphanLookLogicalLayers(self, ch, incoming, 'a')
	assert.deepEqual(logical, [])

	const physical = collectOrphanLookPhysicalLayers(self, ch, [10])
	assert.deepEqual(physical, [110])
})

test('same logical layer on bank B does not orphan when incoming also targets bank B slot', () => {
	const ch = 99
	const self = {
		_playbackMatrix: {
			[`${ch}-110`]: { channel: ch, layer: 110, playing: true },
		},
		config: { screen_count: 1 },
	}
	const incoming = {
		layers: [{ layerNumber: 10, source: { type: 'media', value: 'other.mov' } }],
	}
	const logical = collectOrphanLookLogicalLayers(self, ch, incoming, 'b')
	assert.deepEqual(logical, [])

	const physical = collectOrphanLookPhysicalLayers(self, ch, [110])
	assert.deepEqual(physical, [])
})

test('PGM audio track layers 1–9 are never cleared as look orphans; video from layer 10+ is', () => {
	const ch = 1
	const self = {
		_playbackMatrix: {
			[`${ch}-2`]: { channel: ch, layer: 2, playing: true, clip: 'route://5' },
			[`${ch}-10`]: { channel: ch, layer: 10, playing: true, clip: 'media/x.mov' },
		},
		config: { screen_count: 1 },
	}
	const incoming = {
		layers: [{ layerNumber: 11, source: { type: 'media', value: 'clip.mov' } }],
	}
	const physical = collectOrphanLookPhysicalLayers(self, ch, [11])
	assert.equal(physical.includes(2), false, 'layer 2 is audio track slot — never orphan-clear')
	assert.deepEqual(physical, [10], 'layer 10 video look is cleared when not in incoming take')
})
