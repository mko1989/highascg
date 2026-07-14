/**
 * WO-158 T158.6 — layer crop math smokes.
 * Covers client/lib/layer-crop.js (ESM) and its CJS mirror src/engine/layer-crop.js:
 * px↔fraction round-trip, cropAdjustedRect identity + asymmetric, cropFromLayer parsing,
 * and ESM/CJS parity (the two files must not drift).
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const cjs = require('../../src/engine/layer-crop')

const esmPromise = import(
	pathToFileURL(path.join(__dirname, '../../client/lib/layer-crop.js')).href
)

test('px↔fraction round-trip at content resolution', async () => {
	const esm = await esmPromise
	const res = { w: 1280, h: 720 }
	const params = { left: 0.1, top: 0.25, right: 0.9, bottom: 0.75 }
	const px = esm.cropParamsToPixels(params, res)
	assert.deepEqual(px, { left: 128, top: 180, right: 1152, bottom: 540 })
	const back = esm.cropPixelsToParams(px, res)
	for (const k of ['left', 'top', 'right', 'bottom']) {
		assert.ok(Math.abs(back[k] - params[k]) < 1e-12, `${k} round-trips`)
	}
	// Single-value converters
	assert.equal(esm.cropFractionToPx(0.5, 1920), 960)
	assert.equal(esm.cropPxToFraction(960, 1920), 0.5)
	// Out-of-range px clamps to 0–1 fraction
	assert.equal(esm.cropPxToFraction(4000, 1920), 1)
	assert.equal(esm.cropPxToFraction(-50, 1920), 0)
})

test('cropAdjustedRect: identity crop returns the same rect', async () => {
	const esm = await esmPromise
	const rect = { x: 100, y: 50, w: 800, h: 450 }
	assert.deepEqual(esm.cropAdjustedRect(rect, null), rect)
	assert.deepEqual(esm.cropAdjustedRect(rect, { left: 0, top: 0, right: 1, bottom: 1 }), rect)
})

test('cropAdjustedRect: asymmetric crop cuts INTO the fill rect', async () => {
	const esm = await esmPromise
	const rect = { x: 100, y: 50, w: 800, h: 400 }
	const crop = { left: 0.25, top: 0.1, right: 0.75, bottom: 0.9 }
	const vis = esm.cropAdjustedRect(rect, crop)
	assert.deepEqual(vis, { x: 300, y: 90, w: 400, h: 320 })
})

test('cropFromLayer: no effect / identity → null; values clamped sane', async () => {
	const esm = await esmPromise
	assert.equal(esm.cropFromLayer(null), null)
	assert.equal(esm.cropFromLayer({}), null)
	assert.equal(esm.cropFromLayer({ effects: [] }), null)
	assert.equal(esm.cropFromLayer({ effects: [{ type: 'brightness', params: { value: 1 } }] }), null)
	assert.equal(
		esm.cropFromLayer({ effects: [{ type: 'crop', params: { left: 0, top: 0, right: 1, bottom: 1 } }] }),
		null,
		'identity crop reports as no crop',
	)
	// Missing params default to identity edges
	assert.equal(esm.cropFromLayer({ effects: [{ type: 'crop', params: {} }] }), null)
	// Clamping: out-of-range and inverted edges
	const c = esm.cropFromLayer({
		effects: [{ type: 'crop', params: { left: -0.5, top: 0.8, right: 1.7, bottom: 0.2 } }],
	})
	assert.deepEqual(c, { left: 0, top: 0.8, right: 1, bottom: 0.8 })
	// Non-finite values fall back to identity edges
	const c2 = esm.cropFromLayer({
		effects: [{ type: 'crop', params: { left: NaN, top: 0.1, right: 'x', bottom: 0.9 } }],
	})
	assert.deepEqual(c2, { left: 0, top: 0.1, right: 1, bottom: 0.9 })
})

test('cropAdjustedFill: identity returns the SAME object; asymmetric intersects', async () => {
	const esm = await esmPromise
	const fill = { x: 0.25, y: 0.25, scaleX: 0.5, scaleY: 0.5 }
	assert.equal(esm.cropAdjustedFill(fill, null), fill, 'identity keeps byte-identical fill')
	const out = esm.cropAdjustedFill(fill, { left: 0.25, top: 0, right: 1, bottom: 0.5 })
	assert.ok(Math.abs(out.x - 0.375) < 1e-12)
	assert.ok(Math.abs(out.y - 0.25) < 1e-12)
	assert.ok(Math.abs(out.scaleX - 0.375) < 1e-12)
	assert.ok(Math.abs(out.scaleY - 0.25) < 1e-12)
})

test('ESM and CJS mirrors agree (must not drift)', async () => {
	const esm = await esmPromise
	const layers = [
		null,
		{ effects: [{ type: 'crop', params: { left: 0.1, top: 0.2, right: 0.8, bottom: 0.9 } }] },
		{ effects: [{ type: 'crop', params: { left: -1, top: 2, right: 0.5, bottom: 0.4 } }] },
		{ effects: [{ type: 'crop', params: {} }] },
	]
	const fill = { x: 0.1, y: 0.2, scaleX: 0.6, scaleY: 0.5 }
	const rect = { x: 10, y: 20, w: 640, h: 360 }
	for (const layer of layers) {
		assert.deepEqual(esm.cropFromLayer(layer), cjs.cropFromLayer(layer))
		assert.deepEqual(
			esm.cropAdjustedFillForLayer(fill, layer),
			cjs.cropAdjustedFillForLayer(fill, layer),
		)
		assert.deepEqual(
			esm.cropAdjustedRect(rect, esm.cropFromLayer(layer)),
			cjs.cropAdjustedRect(rect, cjs.cropFromLayer(layer)),
		)
	}
	assert.deepEqual(
		esm.normalizeCrop({ left: 0.3, right: 0.1, top: 0.5, bottom: 0.2 }),
		cjs.normalizeCrop({ left: 0.3, right: 0.1, top: 0.5, bottom: 0.2 }),
	)
	assert.equal(esm.isIdentityCrop({ left: 0, top: 0, right: 1, bottom: 1 }), true)
	assert.equal(cjs.isIdentityCrop({ left: 0, top: 0, right: 1, bottom: 1 }), true)
})
