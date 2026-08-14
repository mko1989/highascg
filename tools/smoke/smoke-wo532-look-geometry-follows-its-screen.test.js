'use strict'

/**
 * WO-532 — a look's geometry belongs to the look's screen, not to the selected one.
 *
 * Owner 14.08: *"looks are per screen always so they should act as this"*, after WO-531 fixed the
 * take payload and noted that a look "has no home screen". It does: `scene.mainScope`. Routing has
 * honoured it for a long time (`resolveMainIndexForScene`, used by 12 call sites for channels,
 * countdowns, PiP, lower thirds). **Geometry did not** — the fill<->pixel inspectors resolved their
 * canvas from `sceneState.activeScreenIndex`, so the same look measured differently depending on
 * which screen pill was lit.
 *
 * On this box screen 0 is 6144x1536 (4:1) and screen 1 is 1920x1080, so the two canvases disagree
 * violently. Two consequences, both pinned below:
 *
 *  1. READ — a screen-0 look's layer that really occupies 3072x1728 was reported as 960x1215 in the
 *     X/Y/W/H boxes while screen 1 was selected.
 *  2. WRITE — content-fit is the destructive one. `native` means "1:1, centred". Against the look's
 *     own 6144x1536 canvas that stores `{0.34375, 0.1484, 0.3125, 0.703}`; against the wrong
 *     1920x1080 canvas the same media fills the canvas and stores `{0, 0, 1, 1}` — which then
 *     full-bleeds a 4:1 LED wall. That write is permanent, unlike the take-time remap of WO-531.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { resolveMainIndexForScene } = require('../../client/lib/look-stack-amcp-channel.js')
const { fillToPixelRect, pixelRectToFill, sceneLayerPixelRectForContentFit } = require('../../client/lib/fill-math.js')

const SCREEN0 = { width: 6144, height: 1536 } // 4:1 mapped LED — ch1/ch2
const SCREEN1 = { width: 1920, height: 1080 } // 16:9 — ch3/ch4
const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

describe('WO-532: the look names its own screen', () => {
	it('mainScope outranks the editor selection', () => {
		assert.equal(resolveMainIndexForScene({ mainScope: '0' }, { activeScreenIndex: 1 }), 0)
		assert.equal(resolveMainIndexForScene({ mainScope: '1' }, { activeScreenIndex: 0 }), 1)
	})

	it("only an 'all' look falls back to the selection", () => {
		assert.equal(resolveMainIndexForScene({ mainScope: 'all' }, { activeScreenIndex: 1 }), 1)
		assert.equal(resolveMainIndexForScene(null, { activeScreenIndex: 2 }), 2)
	})
})

describe('WO-532: what the wrong canvas did to the numbers', () => {
	/** Look 1 layer 10, verbatim from projects/test420.json (a `mainScope: "0"` look). */
	const FILL = { x: 0.25, y: -0.0625, scaleX: 0.5, scaleY: 1.125 }

	it('READ: the inspector reported a screen-1 rect for a screen-0 look', () => {
		assert.deepEqual(fillToPixelRect(FILL, SCREEN0), { x: 1536, y: -96, w: 3072, h: 1728 })
		assert.deepEqual(fillToPixelRect(FILL, SCREEN1), { x: 480, y: -67.5, w: 960, h: 1215 })
	})

	it('WRITE: content-fit "native" against the wrong canvas stores a full-bleed fill', () => {
		const own = sceneLayerPixelRectForContentFit(SCREEN0.width, SCREEN0.height, 1920, 1080, 'native')
		const wrong = sceneLayerPixelRectForContentFit(SCREEN1.width, SCREEN1.height, 1920, 1080, 'native')
		// Correct: 1920x1080 centred on the wall, stored against the wall.
		assert.deepEqual(pixelRectToFill(own, SCREEN0), { x: 0.34375, y: 0.1484375, scaleX: 0.3125, scaleY: 0.703125 })
		// Bug: the media "fits" a 1920x1080 canvas exactly, so the stored fill is the whole frame.
		assert.deepEqual(pixelRectToFill(wrong, SCREEN1), { x: 0, y: 0, scaleX: 1, scaleY: 1 })
	})
})

describe('WO-532: no look-geometry path reads the selected screen any more', () => {
	for (const rel of [
		'client/components/inspector-fill.js',
		'client/components/inspector-scene-layer.js',
		'client/components/scenes-shared.js',
	]) {
		it(`${rel} resolves its canvas from the scene`, () => {
			const src = read(rel)
			assert.doesNotMatch(
				src,
				/getCanvasForScreen\(sceneState\.activeScreenIndex\)/,
				'the editor selection must not decide a look’s canvas',
			)
			assert.doesNotMatch(
				src,
				/getContentResolution\([^)]*sceneState\.activeScreenIndex/,
				'nor which screen a layer’s content resolution is resolved for',
			)
			assert.match(src, /resolveMainIndexForScene\(/, 'the look’s own screen is resolved instead')
		})
	}

	it('the shared resolution helper accepts an explicit screen', () => {
		const src = read('client/components/inspector-channel-resolution.js')
		assert.match(src, /export function getResolutionForScreen\(stateStore, screenIdx\)/)
		assert.match(
			src,
			/Number\.isInteger\(screenIdx\) && screenIdx >= 0 \? screenIdx : \(sceneState\.activeScreenIndex \?\? 0\)/,
			'callers that know their screen pass it; the rest keep the selection',
		)
		assert.match(
			read('client/components/inspector-scene-layer.js'),
			/getResolutionForScreen\(stateStore, sceneMain\)/,
			'the layer inspector knows its screen',
		)
	})
})
