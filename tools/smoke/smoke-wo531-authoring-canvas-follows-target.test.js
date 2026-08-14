'use strict'

/**
 * WO-531 — a look taken to one screen was sized using ANOTHER screen's canvas.
 *
 * Owner 14.08: *"the main play button still applies wrong sizing on layers at least on ch1"* /
 * `todos14.08.26`: *"the transition not always correctly apply position and size of layers set in
 * looks, like it gets it from somewhere else."*
 *
 * `buildIncomingScenePayload` stamped `composeCanvas` from
 * `sceneState.getCanvasForScreen(sceneState.activeScreenIndex)` — the screen selected in the LOOKS
 * EDITOR, not the screen the payload is for. The server takes that as the authoring canvas
 * (`getProgramAuthoringResolution`, scene-native-fill.js:154) and, when it differs from the target
 * channel, remaps through `mapProgramPixelRectToTargetOutput`.
 *
 * On this box screen 0 is 6144x1536 (4:1) and screen 1 is 1920x1080. With screen 1 selected, a look
 * taken to screen 0 was mapped 1920x1080 -> 6144x1536 and every layer shrank by
 * `pw*k/ow = 1920*1.4222/6144 = 4/9`. That factor is on the wire verbatim
 * (`log/caspar_2026-08-14.log`, 12:04:20) across all three layers of Look 1 at once:
 *
 *     stored  0.25     -0.0625  0.5      1.125     ->  wire  0.3889  -0.0625  0.2222   0.5
 *     stored  0.018726  0.21488 0.204172 0.544459  ->  wire  0.2861   0.21488 0.090743 0.241982
 *     stored  0.773880  0.22519 0.180332 0.480885  ->  wire  0.6217   0.22519 0.080147 0.213727
 *
 * "not always" = only when the selected screen differs from the take's target AND the two screens
 * have different canvases.
 *
 * These tests pin the SERVER math (which was correct all along, given honest inputs) and the CLIENT
 * decision that fed it a dishonest one.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { resolveSceneLayerFill } = require('../../src/engine/scene-native-fill.js')

const SCREEN0 = { w: 6144, h: 1536 } // 4:1 mapped LED — ch1/ch2
const SCREEN1 = { w: 1920, h: 1080 } // 16:9 — ch3/ch4
const MEDIA = { w: 1920, h: 1080 }

/** Look 1's three layers, verbatim from projects/test420.json. */
const LOOK1 = [
	{ x: 0.25, y: -0.0625, scaleX: 0.5, scaleY: 1.125 },
	{ x: 0.018725837628865954, y: 0.21488402061855671, scaleX: 0.20417203608247425, scaleY: 0.544458762886598 },
	{ x: 0.7738804768041238, y: 0.2251932989690722, scaleX: 0.18033182989690721, scaleY: 0.4808848797250859 },
].map((fill) => ({ source: { type: 'media', value: 'x.mov' }, contentFit: 'native', fill }))

const round = (n) => Math.round(n * 1e10) / 1e10

describe('WO-531: the server reproduces the reported shrink when handed the wrong authoring canvas', () => {
	it('authoring 1920x1080 -> target 6144x1536 shrinks every layer by exactly 4/9', () => {
		for (const layer of LOOK1) {
			const out = resolveSceneLayerFill(layer, SCREEN1.w, SCREEN1.h, SCREEN0.w, SCREEN0.h, MEDIA)
			assert.equal(
				round(out.scaleX / layer.fill.scaleX),
				round(4 / 9),
				`width should shrink by pw*k/ow = 4/9 (got ${out.scaleX} from ${layer.fill.scaleX})`,
			)
		}
		// The exact first-layer numbers seen on the wire.
		const first = resolveSceneLayerFill(LOOK1[0], SCREEN1.w, SCREEN1.h, SCREEN0.w, SCREEN0.h, MEDIA)
		assert.equal(round(first.x), round(0.38888888888888884))
		assert.equal(round(first.scaleX), round(0.22222222222222224))
		assert.equal(round(first.scaleY), round(0.5))
	})

	it('authoring == target is a no-op: the look lands exactly as stored', () => {
		const out = resolveSceneLayerFill(LOOK1[0], SCREEN0.w, SCREEN0.h, SCREEN0.w, SCREEN0.h, MEDIA)
		assert.equal(round(out.x), round(0.25), 'x is untouched')
		assert.equal(round(out.scaleX), round(0.5), 'width is untouched')
	})

	it('the same look on screen 1 is unaffected — which is why it was "not always"', () => {
		const out = resolveSceneLayerFill(LOOK1[0], SCREEN1.w, SCREEN1.h, SCREEN1.w, SCREEN1.h, MEDIA)
		assert.equal(round(out.scaleX), round(0.5), 'the screen it was selected on always looked right')
	})
})

describe('WO-531: the payload stamps the TARGET screen’s canvas', () => {
	const src = fs.readFileSync(path.join(__dirname, '../../client/components/scenes-shared.js'), 'utf8')

	it('composeCanvas follows seekOpts.mainIdx, not the editor selection', () => {
		assert.match(
			src,
			/const canvasIdx = Number\.isInteger\(seekOpts\?\.mainIdx\) && seekOpts\.mainIdx >= 0 \? seekOpts\.mainIdx : sceneState\.activeScreenIndex/,
			'the target screen wins when the caller knows it',
		)
		/* WO-532 refined this: `canvasIdx` is now the OVERRIDE handed to `resolveMainIndexForScene`,
		 * which prefers the look's own `mainScope`. Same guarantee for this WO's case (a scoped look
		 * is only ever taken to its own screen, so override == scope), strictly stronger otherwise. */
		assert.match(
			src,
			/const cv = sceneState\.getCanvasForScreen\(resolveMainIndexForScene\(scene, sceneState, canvasIdx\)\)/,
			'and the canvas is read for the screen the look belongs to',
		)
		assert.doesNotMatch(
			src,
			/getCanvasForScreen\(sceneState\.activeScreenIndex\)/,
			'the editor selection must no longer decide a take’s geometry',
		)
	})

	it('every take/stage caller supplies a target, so the fallback is not load-bearing', () => {
		for (const rel of ['client/components/scenes-preview-runtime.js', 'client/components/scenes-editor-support.js']) {
			const s = fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')
			// Each buildIncomingScenePayload call that carries seekOpts also carries mainIdx.
			const withOpts = s.match(/buildIncomingScenePayload\(\s*\w+,\s*\{[\s\S]{0,600}?\}\s*\)/g) || []
			for (const call of withOpts) {
				assert.match(call, /mainIdx/, `${rel}: a payload built for a target must name it — ${call.slice(0, 60)}…`)
			}
		}
	})
})
