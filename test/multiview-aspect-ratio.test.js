'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { resolveCellContentResolution } = require('../src/engine/multiview-layout-helper')

test('resolveCellContentResolution uses DeckLink input channel resolution', () => {
	const cm = {
		programChannels: [1],
		previewChannels: [2],
		programResolutions: [{ w: 1920, h: 1080 }],
		inputChannels: [{ kind: 'decklink', slot: 1, channel: 5, resolution: { w: 1920, h: 1080 } }],
	}
	const cell = {
		type: 'decklink',
		source: { value: 'route://5-1' },
	}
	const res = resolveCellContentResolution(cell, 'decklink', cm, cm.programChannels, cm.previewChannels)
	assert.deepEqual(res, { w: 1920, h: 1080 })
})

test('resolveCellContentResolution prefers PGM resolution for program routes', () => {
	const cm = {
		programChannels: [1],
		previewChannels: [2],
		programResolutions: [{ w: 3840, h: 2160 }],
	}
	const cell = { type: 'pgm', source: { value: 'route://1' } }
	const res = resolveCellContentResolution(cell, 'pgm', cm, cm.programChannels, cm.previewChannels)
	assert.deepEqual(res, { w: 3840, h: 2160 })
})
