/**
 * WO-158 T158.3/T158.6 — visual crop-handle drag math smoke.
 * Covers the pure `cropDeltaToParams` helper in client/components/scenes-compose-handlers.js
 * (pointer delta → crop-fraction params), split out of `startCropResize` specifically so this
 * math is unit-testable without DOM/pointer-event mocks. DOM dragging itself (handle visibility,
 * clip-path/live patch wiring) is manual QA — see the WO work log.
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const modPromise = import(
	pathToFileURL(path.join(__dirname, '../../client/components/scenes-compose-handlers.js')).href
)

const IDENTITY = { left: 0, top: 0, right: 1, bottom: 1 }

test('cropDeltaToParams: single-edge drags only move that edge', async () => {
	const mod = await modPromise
	const { cropDeltaToParams } = mod

	const w = cropDeltaToParams('w', IDENTITY, 0.15, 0)
	assert.deepEqual(w, { left: 0.15, top: 0, right: 1, bottom: 1 })

	const e = cropDeltaToParams('e', IDENTITY, -0.2, 0)
	assert.deepEqual(e, { left: 0, top: 0, right: 0.8, bottom: 1 })

	const n = cropDeltaToParams('n', IDENTITY, 0, 0.1)
	assert.deepEqual(n, { left: 0, top: 0.1, right: 1, bottom: 1 })

	const s = cropDeltaToParams('s', IDENTITY, 0, -0.1)
	assert.deepEqual(s, { left: 0, top: 0, right: 1, bottom: 0.9 })
})

test('cropDeltaToParams: corner drags move both axes, other edges untouched', async () => {
	const mod = await modPromise
	const { cropDeltaToParams } = mod

	const se = cropDeltaToParams('se', IDENTITY, -0.1, -0.05)
	assert.deepEqual(se, { left: 0, top: 0, right: 0.9, bottom: 0.95 })

	const nw = cropDeltaToParams('nw', IDENTITY, 0.2, 0.3)
	assert.deepEqual(nw, { left: 0.2, top: 0.3, right: 1, bottom: 1 })
})

test('cropDeltaToParams: accumulates from an existing (non-identity) crop', async () => {
	const mod = await modPromise
	const { cropDeltaToParams } = mod

	const start = { left: 0.1, top: 0.2, right: 0.9, bottom: 0.8 }
	const out = cropDeltaToParams('e', start, 0.05, 0)
	assert.equal(out.left, 0.1)
	assert.equal(out.top, 0.2)
	assert.equal(out.bottom, 0.8)
	assert.ok(Math.abs(out.right - 0.95) < 1e-9)
})

test('cropDeltaToParams: clamps to 0..1 at the canvas bounds', async () => {
	const mod = await modPromise
	const { cropDeltaToParams } = mod

	assert.deepEqual(cropDeltaToParams('e', IDENTITY, 5, 0), { left: 0, top: 0, right: 1, bottom: 1 })
	assert.deepEqual(cropDeltaToParams('w', IDENTITY, -5, 0), { left: 0, top: 0, right: 1, bottom: 1 })
	assert.deepEqual(cropDeltaToParams('n', IDENTITY, 0, -5), { left: 0, top: 0, right: 1, bottom: 1 })
	assert.deepEqual(cropDeltaToParams('s', IDENTITY, 0, 5), { left: 0, top: 0, right: 1, bottom: 1 })
})

test('cropDeltaToParams: enforces a minimum crop window (left<right, top<bottom)', async () => {
	const mod = await modPromise
	const { cropDeltaToParams } = mod

	const start = { left: 0.4, top: 0.4, right: 0.6, bottom: 0.6 }
	// Drag right edge far past left — should stop at left + minFrac, not cross it.
	const e = cropDeltaToParams('e', start, -1, 0, 0.02)
	assert.ok(e.right > e.left, 'right stays greater than left')
	assert.ok(Math.abs(e.right - (e.left + 0.02)) < 1e-9)
	assert.equal(e.left, 0.4, 'the edge not being dragged is untouched')

	// Drag left edge far past right.
	const w = cropDeltaToParams('w', start, 1, 0, 0.02)
	assert.ok(w.left < w.right)
	assert.ok(Math.abs(w.left - (w.right - 0.02)) < 1e-9)

	// Same for the vertical axis.
	const n = cropDeltaToParams('n', start, 0, 1, 0.02)
	assert.ok(n.top < n.bottom)
	const s = cropDeltaToParams('s', start, 0, -1, 0.02)
	assert.ok(s.bottom > s.top)
})

test('cropDeltaToParams: a no-op delta returns the (normalized) starting crop unchanged', async () => {
	const mod = await modPromise
	const { cropDeltaToParams } = mod

	const start = { left: 0.1, top: 0.2, right: 0.9, bottom: 0.8 }
	const out = cropDeltaToParams('se', start, 0, 0)
	assert.deepEqual(out, start)
})

test('cropDeltaToParams: malformed/missing startCrop falls back to identity edges (normalizeCrop)', async () => {
	const mod = await modPromise
	const { cropDeltaToParams } = mod

	const out = cropDeltaToParams('e', {}, 0.1, 0)
	assert.deepEqual(out, { left: 0, top: 0, right: 1, bottom: 1 })
})
