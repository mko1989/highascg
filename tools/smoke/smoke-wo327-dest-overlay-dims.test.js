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

/*
 * WO-327 follow-up (todos25.07.26): "the compose preview still doesn't show the correct aspect
 * ratio when a screen is custom res." The borders were fixed, but the SERVER's per-cell
 * aspect-fit (operator-gui-channel.js resolveCellSourceDims) resolved the source raster from
 * the legacy `screen_N_mode` config keys — absent on a destinations-configured box — so it fell
 * to the 1080p default and aspect-fit every custom-res screen's video as 16:9 inside its
 * compose hole (live repro: PGM 2560x896, hole fitted 16:9). Destinations first now.
 */
describe('WO-327 follow-up: resolveCellSourceDims honours screen destinations', () => {
	const { resolveCellSourceDims } = require('../../src/system/operator-gui-channel.js')

	const destCfg = {
		screenDestinations: {
			version: 1,
			destinations: [
				// operator_gui shares mainScreenIndex 0 and must NOT shadow the real screen (live box shape).
				{ id: 'og', label: 'Operator GUI', mainScreenIndex: 0, mode: 'operator_gui', videoMode: 'custom', width: 1920, height: 1080 },
				{ id: 'd1', label: 'PGM/PRV 1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: 'custom', width: 2560, height: 896 },
			],
		},
	}

	it('custom-res destination wins (the live-box repro: 2560x896, not 1080p)', () => {
		assert.deepEqual(resolveCellSourceDims({ mainIndex: 0 }, destCfg), { width: 2560, height: 896 })
		assert.deepEqual(resolveCellSourceDims({ role: 'prv', mainIndex: 0 }, destCfg), { width: 2560, height: 896 })
	})

	it('standard-mode destination resolves its canonical dims', () => {
		const cfg = { screenDestinations: { version: 1, destinations: [
			{ id: 'd1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '2160p5000' },
		] } }
		assert.deepEqual(resolveCellSourceDims({ mainIndex: 0 }, cfg), { width: 3840, height: 2160 })
	})

	it('legacy screen_N_mode boxes keep working (no destinations)', () => {
		assert.deepEqual(resolveCellSourceDims({ mainIndex: 0 }, { screen_1_mode: '720p5000' }), { width: 1280, height: 720 })
		assert.deepEqual(resolveCellSourceDims({ mainIndex: 0 }, {}), { width: 1920, height: 1080 })
	})

	it('timeline editor uses the canonical resolution chain (destinations-aware), not raw programResolutions', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../client/components/timeline-editor.js'), 'utf8')
		assert.match(src, /getOutputResolution: \(\) => getResolutionForScreen\(/)
		assert.match(src, /import \{ getResolutionForScreen \} from '\.\/scenes-editor-logic\.js'/)
	})
})
