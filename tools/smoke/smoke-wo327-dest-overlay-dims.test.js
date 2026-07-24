'use strict'

/**
 * Offline smoke — WO-327: compose-preview destination borders vs custom resolutions.
 *
 * The overlay used a hardcoded 1920x1080 auto-tile cell and never read the destination's
 * stored width/height, so custom-res destinations drew wrong-aspect/misplaced borders.
 * Now every box derives from resolveDestinationDims (explicit w/h → videoMode → 1080p).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

describe('resolveDestinationDims', () => {
	it('prefers explicit custom width/height', async () => {
		const { resolveDestinationDims } = await import('../../client/lib/mapping-node-service.js')
		assert.deepEqual(resolveDestinationDims({ width: 1024, height: 576, videoMode: '1080p5000' }), { w: 1024, h: 576 })
		assert.deepEqual(resolveDestinationDims({ width: '3840', height: '2160' }), { w: 3840, h: 2160 })
	})

	it('falls back to the videoMode canonical dims', async () => {
		const { resolveDestinationDims } = await import('../../client/lib/mapping-node-service.js')
		assert.deepEqual(resolveDestinationDims({ videoMode: '2160p5000' }), { w: 3840, h: 2160 })
		assert.deepEqual(resolveDestinationDims({ videoMode: 'PAL' }), { w: 720, h: 576 })
	})

	it('rejects garbage and defaults to 1080p', async () => {
		const { resolveDestinationDims } = await import('../../client/lib/mapping-node-service.js')
		assert.deepEqual(resolveDestinationDims({ width: 8, height: -4 }), { w: 1920, h: 1080 })
		assert.deepEqual(resolveDestinationDims(null), { w: 1920, h: 1080 })
	})
})

describe('destination overlay source guards', () => {
	const src = fs.readFileSync(
		path.join(__dirname, '../../client/components/preview-canvas-destination-overlay.js'),
		'utf8'
	)

	it('reads true destination dims, no hardcoded 1920x1080 tile cells', () => {
		assert.match(src, /resolveDestinationDims\(/, 'overlay must resolve real destination dims')
		assert.doesNotMatch(src, /cellW = 1920/, 'fixed-size tile grid must stay dead (WO-327 regression)')
		assert.doesNotMatch(src, /cellH = 1080/, 'fixed-size tile grid must stay dead (WO-327 regression)')
	})

	it('re-derives border height from the true aspect', () => {
		assert.match(src, /dims\.h \/ Math\.max\(1, dims\.w\)/, 'aspect must come from the true resolution')
	})
})
