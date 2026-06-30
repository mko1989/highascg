'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	sceneLayerRotationMixerLines,
	fillForSceneLayerRotationAnchor,
} = require('../../src/engine/scene-layer-rotation-amcp')

test('sceneLayerRotationMixerLines: center anchor before rotation', () => {
	const lines = sceneLayerRotationMixerLines('2-10', 45)
	assert.equal(lines.length, 2)
	assert.match(lines[0], /^MIXER 2-10 ANCHOR 0\.5 0\.5 0$/)
	assert.match(lines[1], /^MIXER 2-10 ROTATION 45 0$/)
})

test('sceneLayerRotationMixerLines: zero rotation resets top-left anchor', () => {
	const lines = sceneLayerRotationMixerLines('1-20', 0)
	assert.match(lines[0], /ANCHOR 0 0/)
	assert.match(lines[1], /ROTATION 0 0/)
})

test('fillForSceneLayerRotationAnchor: shifts FILL to center when rotating', () => {
	const fill = { x: 0.25, y: 0.25, scaleX: 0.5, scaleY: 0.5 }
	assert.deepEqual(fillForSceneLayerRotationAnchor(fill, 0), fill)
	assert.deepEqual(fillForSceneLayerRotationAnchor(fill, 30), {
		x: 0.5,
		y: 0.5,
		scaleX: 0.5,
		scaleY: 0.5,
	})
})
