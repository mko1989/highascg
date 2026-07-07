'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { sceneLayerPixelRectForContentFit } = require('../../client/lib/fill-math.js')
const { alignStoredPxRect } = require('../../client/lib/coordinate-origin.js')

describe('timeline clip layout', () => {
	it('native content fit centers media on program canvas', () => {
		const rect = sceneLayerPixelRectForContentFit(1920, 1080, 1280, 720, 'native')
		assert.equal(rect.w, 1280)
		assert.equal(rect.h, 720)
		assert.equal(rect.x, 320)
		assert.equal(rect.y, 180)
	})

	it('align center matches content-fit center for stored pixel rect', () => {
		const base = sceneLayerPixelRectForContentFit(1920, 1080, 1280, 720, 'native')
		const aligned = alignStoredPxRect(base, { width: 1920, height: 1080 }, 'center')
		assert.deepEqual(aligned, base)
	})

	it('fill-canvas content fit letterboxes and centers', () => {
		const rect = sceneLayerPixelRectForContentFit(1920, 1080, 3840, 2160, 'fill-canvas')
		assert.equal(rect.w, 1920)
		assert.equal(rect.h, 1080)
		assert.equal(rect.x, 0)
		assert.equal(rect.y, 0)
	})
})
