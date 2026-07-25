'use strict'

/**
 * Offline smoke — WO-326: look-layer W/H inspector edits must reach air, aspect lock must
 * actually unlock (2026-07-24).
 *
 * Two verified client bugs:
 * 1. `flushPreviewPush` (the inspector-edit flush path) never armed the mixer nudge. In
 *    edit-on-PGM mode, geometry-only edits early-return in pushEditsToPgmLive ("the PGM
 *    nudge owns it") — so inspector W/H edits reached NOTHING on air. Drags worked only
 *    because schedulePreviewPush arms the nudge.
 * 2. The W/H input handlers in inspector-fill.js read `layer.aspectLocked` from a STALE
 *    captured layer object and cosmetically paired the other input from it — after
 *    unlocking, the UI kept showing locked-aspect numbers the model never had.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')

describe('WO-326 inspector geometry edits reach air', () => {
	it('flushPreviewPush arms the mixer nudge (inspector path)', () => {
		const src = read('client/components/scenes-preview-runtime.js')
		const fn = src.slice(src.indexOf('function flushPreviewPush'), src.indexOf('function scheduleFlushPreviewFromInspector'))
		assert.match(fn, /scheduleMixerNudge\(\)/, 'inspector flush must schedule the nudge — edit-on-PGM geometry rides ONLY the nudge')
	})

	it('schedulePreviewPush still arms the nudge (drag path unchanged)', () => {
		const src = read('client/components/scenes-preview-runtime.js')
		const fn = src.slice(src.indexOf('function schedulePreviewPush'), src.indexOf('function flushPreviewPush'))
		assert.match(fn, /scheduleMixerNudge\(\)/)
	})
})

describe('WO-326 aspect lock honesty', () => {
	it('W/H handlers no longer pair from the stale captured layer', () => {
		const src = read('client/components/inspector-fill.js')
		const wh = src.slice(src.indexOf("label: 'Width'"), src.indexOf('fillGrp.appendChild(xInp.wrap)'))
		assert.doesNotMatch(wh, /layer\.aspectLocked/, 'handlers must not read the stale captured layer (WO-326 regression)')
		assert.match(wh, /syncGeometryInputsFromLayer\(\)/, 'inputs must resync from the model after a patch')
	})

	it('aspect pairing lives in patchFillPx with a FRESH layer read', () => {
		const src = read('client/components/inspector-scene-layer.js')
		const fn = src.slice(src.indexOf('function patchFillPx'), src.indexOf('function patchFillAlign'))
		assert.match(fn, /const sc = sceneState\.getScene\(sceneId\)/, 'patchFillPx must read fresh scene state')
		assert.match(fn, /L\.aspectLocked !== false/, 'lock check must use the fresh layer')
	})
})

/*
 * WO-326 follow-up (todos25.07.26): "the aspect ratio is still locked on a layer even when
 * unlocked. it acts correctly in the editor but then shows up locked on pgm."
 * Root cause: mapContentFitToStretch ignored aspectLocked — every non-stretch content fit
 * contain-fits the media at its OWN aspect inside the layer rect (calcMixerFill 'none'/'fit'
 * both use Math.min fit-scale), so the take/nudge FILL rendered unstretched content no matter
 * what rect the unlocked inspector produced. The editor canvas draws the raw rect, hence
 * "correct in the editor". Fix: explicit unlock → 'stretch' (rect wins), BOTH mirrors.
 */
describe('WO-326 follow-up: unlocked layer stretches to its rect on air', () => {
	const server = require('../../src/engine/scene-native-fill.js')
	// client/lib/mixer-fill.js is plain-node require-safe ESM (import chain: fill-math,
	// api-client, input-channels, layer-crop — no top-level DOM access).
	const client = require('../../client/lib/mixer-fill.js')

	it('server: aspectLocked:false resolves the RAW rect even with known media resolution', () => {
		const layer = {
			source: { type: 'media', value: 'clip' },
			aspectLocked: false,
			contentFit: 'native',
			fill: { x: 0.1, y: 0.1, scaleX: 0.5, scaleY: 0.8 },
		}
		const out = server.resolveSceneLayerFill(layer, 1920, 1080, 1920, 1080, { w: 1920, h: 1080 })
		assert.deepEqual(out, { x: 0.1, y: 0.1, scaleX: 0.5, scaleY: 0.8 }, 'rect must not be contain-fit')
	})

	it('server: the same layer LOCKED contain-fits (16:9 media in a 0.5x0.8 rect shrinks height)', () => {
		const layer = {
			source: { type: 'media', value: 'clip' },
			contentFit: 'fill-canvas',
			fill: { x: 0.1, y: 0.1, scaleX: 0.5, scaleY: 0.8 },
		}
		const out = server.resolveSceneLayerFill(layer, 1920, 1080, 1920, 1080, { w: 1920, h: 1080 })
		assert.ok(Math.abs(out.scaleY - 0.5) < 1e-9, `contain-fit must shrink scaleY to 0.5, got ${out.scaleY}`)
	})

	it('both mirrors: aspectLocked:false → stretch, wins over every contentFit', () => {
		for (const impl of [client.mapContentFitToStretch]) {
			for (const cf of ['native', 'horizontal', 'vertical', 'fill-canvas', undefined]) {
				assert.equal(impl({ aspectLocked: false, contentFit: cf }), 'stretch', `client cf=${cf}`)
			}
		}
		// Server mapContentFitToStretch is module-private — assert via source (same text in both).
		const srv = read('src/engine/scene-native-fill.js')
		assert.match(srv, /if \(layer\.aspectLocked === false\) return 'stretch'/)
	})

	/* Second follow-up (todos25, same day): "aspect lock works, but not consistently — dragging a
	 * corner on PRV sometimes jumps back to locked." The throttled mixer nudge sent a MINIMAL
	 * layer payload without aspectLocked, so only the nudge contain-fit while the full push
	 * stretched — two racing writers, last one wins, hence intermittent. */
	it('the mixer-nudge payload and its dedup key both carry aspectLocked', () => {
		const src = read('client/components/scenes-preview-runtime.js')
		const payloadFn = src.slice(src.indexOf('function nudgeLayerPayload'), src.indexOf('function nudgeTargetMainIdxs'))
		assert.match(payloadFn, /aspectLocked: l\.aspectLocked/, 'nudge payload must carry the lock state to the server fill resolver')
		const keyFn = src.slice(src.indexOf('function nudgeGeometryKeyForLayer'), src.indexOf('function nudgeLayerPayload'))
		assert.match(keyFn, /aspectLocked/, 'lock toggle with unchanged rect must not be deduped away')
	})

	it('the full take payload carries aspectLocked (unchanged)', () => {
		const src = read('client/components/scenes-shared.js')
		assert.match(src, /aspectLocked: l\.aspectLocked !== false/)
	})

	it('locked layers keep the existing contentFit mapping (no regression)', () => {
		assert.equal(client.mapContentFitToStretch({ contentFit: 'native' }), 'none')
		assert.equal(client.mapContentFitToStretch({ contentFit: 'fill-canvas' }), 'fit')
		assert.equal(client.mapContentFitToStretch({ aspectLocked: true, contentFit: 'native' }), 'none')
		assert.equal(client.mapContentFitToStretch({}), 'fit')
	})
})

/*
 * Third follow-up (todos25): with air stretching correctly, the LOOKS EDITOR canvas was the
 * last holdout — it contain-fit unlocked layers and painted the uncovered rect black. The
 * editor's forceStretch predicate now honours aspectLocked === false on both layer draw
 * sites (media thumb + template thumb); the timeline-clip site is deliberately untouched
 * (clips default to unlocked and keep their own fill semantics).
 */
describe('WO-326d: editor canvas draws unlocked layers stretched', () => {
	it('both layer draw sites include aspectLocked in forceStretch', () => {
		const src = read('client/components/preview-canvas-draw-stacks.js')
		const m = src.match(/const forceStretch = cf === 'stretch' \|\| layer\.fillNativeAspect === false \|\| layer\.aspectLocked === false/g) || []
		assert.equal(m.length, 2, 'media-thumb and template-thumb sites both honour the unlock')
	})

	it('the timeline-clip draw site keeps its own semantics (no aspectLocked)', () => {
		const src = read('client/components/preview-canvas-draw-stacks.js')
		const clipSite = src.slice(src.indexOf("const cf = clip.contentFit || 'native'"))
		assert.match(clipSite, /if \(cf === 'stretch'\) \{/, 'clip site keeps the inline stretch check')
		assert.doesNotMatch(clipSite.slice(0, 400), /aspectLocked/, 'clips must not inherit the layer unlock rule')
	})
})
