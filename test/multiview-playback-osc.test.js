'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

require('../template/multiview-playback-osc.js')

const { shouldIgnoreOscPlaybackLayer } = globalThis.mvPlaybackOsc

test('ignores LED test and global-border layers', () => {
	assert.equal(shouldIgnoreOscPlaybackLayer(999, { file: { name: 'clip.mov' } }), true)
	assert.equal(shouldIgnoreOscPlaybackLayer(998, { file: { name: 'clip.mov' } }), true)
	assert.equal(shouldIgnoreOscPlaybackLayer(996, { file: { name: 'clip.mov' } }), true)
})

test('ignores test-pattern templates by file name', () => {
	assert.equal(shouldIgnoreOscPlaybackLayer(12, { file: { name: 'led_grid_test.html' } }), true)
	assert.equal(shouldIgnoreOscPlaybackLayer(12, { file: { path: '/media/led_test_pattern/index' } }), true)
})

test('keeps normal program layers', () => {
	assert.equal(shouldIgnoreOscPlaybackLayer(10, { file: { name: 'intro.mov' } }), false)
	assert.equal(shouldIgnoreOscPlaybackLayer(50, { file: { name: 'route://2' } }), false)
})
