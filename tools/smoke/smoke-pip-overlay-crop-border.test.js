/**
 * WO-158 T158.6 — crop-aware PIP border placement smokes.
 * Identity crop must be byte-identical to the pre-WO-158 pipeline (reference captured
 * by calling the placement with the raw fill); an asymmetric crop must make the border
 * hug the cropped content rect (asserted numerically).
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	computePipOverlayPlacement,
	computePipRouterPlacement,
} = require('../../src/engine/pip-overlay-utils')
const { buildPipOverlayAmcpLines, buildPipOverlayAmcpLinesAll } = require('../../src/engine/pip-overlay')
const { cropAdjustedFillForLayer } = require('../../src/engine/layer-crop')

const fill = { x: 0.25, y: 0.25, scaleX: 0.5, scaleY: 0.5 }
const chW = 1920
const chH = 1080
const borderOverlay = { type: 'border', params: { width: 4, side: 'outside', color: '#f00' } }

test('identity crop: placement output identical to uncropped reference', () => {
	// Reference = current behavior with the raw fill (no crop anywhere).
	const reference = computePipOverlayPlacement(borderOverlay, fill, chW, chH, 10, 0, 20, [borderOverlay])

	for (const layer of [
		{},
		{ effects: [] },
		{ effects: [{ type: 'crop', params: { left: 0, top: 0, right: 1, bottom: 1 } }] },
	]) {
		const adjusted = cropAdjustedFillForLayer(fill, layer)
		assert.equal(adjusted, fill, 'identity crop passes the fill object through unchanged')
		const placement = computePipOverlayPlacement(borderOverlay, adjusted, chW, chH, 10, 0, 20, [borderOverlay])
		assert.deepEqual(placement, reference)
	}
})

test('identity crop: AMCP lines byte-identical to uncropped reference', () => {
	const referenceLines = buildPipOverlayAmcpLinesAll([borderOverlay], 2, 10, fill, { config: {} }, 20, null, 0)
	const layer = { effects: [{ type: 'crop', params: { left: 0, top: 0, right: 1, bottom: 1 } }] }
	const lines = buildPipOverlayAmcpLinesAll(
		[borderOverlay],
		2,
		10,
		cropAdjustedFillForLayer(fill, layer),
		{ config: {} },
		20,
		null,
		0,
	)
	assert.deepEqual(lines, referenceLines)
})

test('asymmetric crop: border hugs the cropped content rect (numeric)', () => {
	// Crop off the left quarter and the bottom half of the layer image.
	const layer = { effects: [{ type: 'crop', params: { left: 0.25, top: 0, right: 1, bottom: 0.5 } }] }
	const cropped = cropAdjustedFillForLayer(fill, layer)

	// Visible content rect: x = 0.25 + 0.25*0.5, w = 0.75*0.5; y unchanged, h = 0.5*0.5.
	assert.ok(Math.abs(cropped.x - 0.375) < 1e-12)
	assert.ok(Math.abs(cropped.y - 0.25) < 1e-12)
	assert.ok(Math.abs(cropped.scaleX - 0.375) < 1e-12)
	assert.ok(Math.abs(cropped.scaleY - 0.25) < 1e-12)

	const placement = computePipOverlayPlacement(borderOverlay, cropped, chW, chH, 10, 0, 20, [borderOverlay])
	// Outside border (width 4) expands the CROPPED rect by 4px on every side.
	const ox = 4 / chW
	const oy = 4 / chH
	assert.ok(Math.abs(placement.mixFill.x - (0.375 - ox)) < 1e-12)
	assert.ok(Math.abs(placement.mixFill.y - (0.25 - oy)) < 1e-12)
	assert.ok(Math.abs(placement.mixFill.scaleX - (0.375 + 2 * ox)) < 1e-12)
	assert.ok(Math.abs(placement.mixFill.scaleY - (0.25 + 2 * oy)) < 1e-12)
	// Inner hole reconstructs the cropped content rect exactly.
	const inner = placement.inner
	assert.ok(Math.abs(placement.mixFill.x + inner.l * placement.mixFill.scaleX - cropped.x) < 1e-9)
	assert.ok(Math.abs(placement.mixFill.y + inner.t * placement.mixFill.scaleY - cropped.y) < 1e-9)
	assert.ok(Math.abs(inner.w * placement.mixFill.scaleX - cropped.scaleX) < 1e-9)
	assert.ok(Math.abs(inner.h * placement.mixFill.scaleY - cropped.scaleY) < 1e-9)
})

test('asymmetric crop: MIXER FILL line carries the crop-adjusted rect', () => {
	const layer = { effects: [{ type: 'crop', params: { left: 0.25, top: 0, right: 1, bottom: 0.5 } }] }
	const lines = buildPipOverlayAmcpLines(
		borderOverlay,
		2,
		10,
		cropAdjustedFillForLayer(fill, layer),
		{ config: {} },
		0,
		20,
		0,
		[borderOverlay],
	)
	const fillLine = lines.find((l) => /^MIXER 2-260 FILL /.test(l))
	assert.ok(fillLine, 'has MIXER FILL line')
	const parts = fillLine.split(/\s+/)
	const [x, y, sx, sy] = [Number(parts[3]), Number(parts[4]), Number(parts[5]), Number(parts[6])]
	assert.ok(Math.abs(x - (0.375 - 4 / 1920)) < 1e-9)
	assert.ok(Math.abs(y - (0.25 - 4 / 1080)) < 1e-9)
	assert.ok(Math.abs(sx - (0.375 + 8 / 1920)) < 1e-9)
	assert.ok(Math.abs(sy - (0.25 + 8 / 1080)) < 1e-9)
})

test('router placement: identity crop identical, asymmetric crop hugs cropped rect', () => {
	const stack = [
		{ type: 'glow', params: { intensity: 20, side: 'outside' } },
		{ type: 'border', params: { width: 8, side: 'outside' } },
	]
	const reference = computePipRouterPlacement(stack, fill, chW, chH, 10, 20)
	const identityLayer = { effects: [{ type: 'crop', params: {} }] }
	assert.deepEqual(
		computePipRouterPlacement(stack, cropAdjustedFillForLayer(fill, identityLayer), chW, chH, 10, 20),
		reference,
	)

	const layer = { effects: [{ type: 'crop', params: { left: 0.5, top: 0.5, right: 1, bottom: 1 } }] }
	const cropped = cropAdjustedFillForLayer(fill, layer)
	const placement = computePipRouterPlacement(stack, cropped, chW, chH, 10, 20)
	// Bottom-right quadrant of the layer: x = 0.25 + 0.5*0.5 = 0.5, w = 0.25.
	const total = placement.totalOutsetPx
	assert.ok(total > 0)
	assert.ok(Math.abs(placement.mixFill.x - (0.5 - total / chW)) < 1e-9)
	assert.ok(Math.abs(placement.mixFill.y - (0.5 - total / chH)) < 1e-9)
	assert.ok(Math.abs(placement.mixFill.scaleX - (0.25 + (2 * total) / chW)) < 1e-9)
	assert.ok(Math.abs(placement.mixFill.scaleY - (0.25 + (2 * total) / chH)) < 1e-9)
})
