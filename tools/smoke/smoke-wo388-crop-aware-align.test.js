'use strict'

/**
 * WO-388 — crop counts into the layer's effective size for ALIGN.
 *
 * Owner (30.07.26): "i need the crop to be included in the size of the layer, meaning when its
 * cropped the layer width and/or height is cropped too, so for instance when i want the layer to
 * be adjusted to left, it adjusts including the crop."
 *
 * This is the CORRECTED reading of todos15 "sdjust to doesnt count the crop values in" — WO-238
 * read it inverted (as "adjust must IGNORE crop") and closed as "code correct". See WO-388.
 *
 * Guards:
 *  - uncropped layers keep the OLD full-rect math exactly (no regression for the common case),
 *  - a cropped layer aligns its VISIBLE edge to the canvas edge,
 *  - the untouched axis never moves,
 *  - ESM and the CJS mirror do not drift (same rule as smoke-layer-crop.test.js).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const cjs = require('../../src/engine/layer-crop')
const esmPromise = import(pathToFileURL(path.join(__dirname, '../../client/lib/layer-crop.js')).href)

const EPS = 1e-12
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < EPS, `${msg} (got ${a}, want ${b})`)

/** The pre-WO-388 align math, kept here as the oracle for the uncropped case. */
function legacyAlign(f, mode) {
	const sx = f.scaleX ?? 0
	const sy = f.scaleY ?? 0
	let nx = f.x ?? 0
	let ny = f.y ?? 0
	if (mode === 'left') nx = 0
	else if (mode === 'right') nx = 1 - sx
	else if (mode === 'top') ny = 0
	else if (mode === 'bottom') ny = 1 - sy
	else if (mode === 'center-h') nx = (1 - sx) / 2
	else if (mode === 'center-v') ny = (1 - sy) / 2
	else if (mode === 'center') {
		nx = (1 - sx) / 2
		ny = (1 - sy) / 2
	}
	return { x: nx, y: ny }
}

const MODES = ['left', 'right', 'top', 'bottom', 'center-h', 'center-v', 'center']

test('WO-388: uncropped layers keep the legacy full-rect align math exactly', async () => {
	const esm = await esmPromise
	const fills = [
		{ x: 0.1, y: 0.2, scaleX: 0.5, scaleY: 0.5 },
		{ x: -0.0848, y: 0.264, scaleX: 0.4719, scaleY: 0.4719 },
		{ x: 0, y: 0, scaleX: 1, scaleY: 1 },
	]
	const noCropLayers = [
		null,
		{},
		{ effects: [] },
		{ effects: [{ type: 'brightness', params: { value: 1 } }] },
		{ effects: [{ type: 'crop', params: { left: 0, top: 0, right: 1, bottom: 1 } }] }, // identity
	]
	for (const f of fills) {
		for (const layer of noCropLayers) {
			for (const mode of MODES) {
				const got = esm.alignFillForLayer(f, layer, mode)
				const want = legacyAlign(f, mode)
				near(got.x, want.x, `${mode} x unchanged for uncropped`)
				near(got.y, want.y, `${mode} y unchanged for uncropped`)
			}
		}
	}
})

test('WO-388: align left/right seats the VISIBLE (cropped) edge on the canvas edge', async () => {
	const esm = await esmPromise
	// The owner's actual look: layer 11, route://6-1, crop left=0.20833 right=0.79166
	const f = { x: -0.08480325410403443, y: 0.2640207977772272, scaleX: 0.47195840444554565, scaleY: 0.47195840444554565 }
	const crop = { left: 0.20833333333333334, top: 0, right: 0.7916666666666666, bottom: 1 }
	const layer = { effects: [{ type: 'crop', params: crop }] }
	const sx = f.scaleX
	const offX = crop.left * sx
	const visW = (crop.right - crop.left) * sx

	const L = esm.alignFillForLayer(f, layer, 'left')
	near(L.x + offX, 0, 'visible LEFT edge lands at x=0')
	assert.ok(L.x < 0, 'the layer origin goes NEGATIVE — the cropped-away strip hangs off canvas')
	near(L.y, f.y, 'align left leaves y untouched')

	const R = esm.alignFillForLayer(f, layer, 'right')
	near(R.x + offX + visW, 1, 'visible RIGHT edge lands at x=1')

	const C = esm.alignFillForLayer(f, layer, 'center-h')
	near(C.x + offX + visW / 2, 0.5, 'visible centre lands at 0.5')
	near(C.y, f.y, 'center-h leaves y untouched')
})

test('WO-388: align top/bottom respects a vertical crop', async () => {
	const esm = await esmPromise
	const f = { x: 0.25, y: 0.25, scaleX: 0.5, scaleY: 0.5 }
	const crop = { left: 0, top: 0.25, right: 1, bottom: 0.75 }
	const layer = { effects: [{ type: 'crop', params: crop }] }
	const offY = crop.top * f.scaleY // 0.125
	const visH = (crop.bottom - crop.top) * f.scaleY // 0.25

	const T = esm.alignFillForLayer(f, layer, 'top')
	near(T.y + offY, 0, 'visible TOP edge at y=0')
	near(T.y, -0.125, 'layer origin sits above the canvas by the cropped strip')
	near(T.x, f.x, 'align top leaves x untouched')

	const B = esm.alignFillForLayer(f, layer, 'bottom')
	near(B.y + offY + visH, 1, 'visible BOTTOM edge at y=1')

	const Cv = esm.alignFillForLayer(f, layer, 'center-v')
	near(Cv.y + offY + visH / 2, 0.5, 'visible centre at y=0.5')
})

test('WO-388: center aligns both axes of the visible rect', async () => {
	const esm = await esmPromise
	const f = { x: 0, y: 0, scaleX: 0.8, scaleY: 0.6 }
	const crop = { left: 0.1, top: 0.2, right: 0.6, bottom: 0.9 }
	const layer = { effects: [{ type: 'crop', params: crop }] }
	const c = esm.alignFillForLayer(f, layer, 'center')
	const visX = c.x + crop.left * f.scaleX
	const visY = c.y + crop.top * f.scaleY
	const visW = (crop.right - crop.left) * f.scaleX
	const visH = (crop.bottom - crop.top) * f.scaleY
	near(visX + visW / 2, 0.5, 'visible centre X = 0.5')
	near(visY + visH / 2, 0.5, 'visible centre Y = 0.5')
})

test('WO-388: scale is never touched — align moves, it does not resize', async () => {
	const esm = await esmPromise
	const f = { x: 0.3, y: 0.3, scaleX: 0.42, scaleY: 0.37 }
	const layer = { effects: [{ type: 'crop', params: { left: 0.1, top: 0.1, right: 0.5, bottom: 0.5 } }] }
	for (const mode of MODES) {
		const got = esm.alignFillForLayer(f, layer, mode)
		near(got.scaleX, f.scaleX, `${mode} keeps scaleX`)
		near(got.scaleY, f.scaleY, `${mode} keeps scaleY`)
	}
})

test('WO-388: crop params are clamped/normalized before aligning (inverted + out-of-range)', async () => {
	const esm = await esmPromise
	const f = { x: 0, y: 0, scaleX: 1, scaleY: 1 }
	// right < left and out-of-range values must not produce NaN / negative extents
	const layer = { effects: [{ type: 'crop', params: { left: 0.8, top: -3, right: 0.2, bottom: 9 } }] }
	for (const mode of MODES) {
		const got = esm.alignFillForLayer(f, layer, mode)
		assert.ok(Number.isFinite(got.x) && Number.isFinite(got.y), `${mode} stays finite on junk crop`)
	}
})

test('WO-388: ESM and CJS mirrors agree (must not drift)', async () => {
	const esm = await esmPromise
	const fills = [
		{ x: 0.1, y: 0.2, scaleX: 0.6, scaleY: 0.5 },
		{ x: -0.2, y: 0.9, scaleX: 1.4, scaleY: 1.4 },
	]
	const layers = [
		null,
		{ effects: [{ type: 'crop', params: { left: 0.1, top: 0.2, right: 0.8, bottom: 0.9 } }] },
		{ effects: [{ type: 'crop', params: { left: -1, top: 2, right: 0.5, bottom: 0.4 } }] },
		{ effects: [{ type: 'crop', params: {} }] },
	]
	for (const f of fills) {
		for (const layer of layers) {
			for (const mode of MODES) {
				assert.deepEqual(
					esm.alignFillForLayer(f, layer, mode),
					cjs.alignFillForLayer(f, layer, mode),
					`alignFillForLayer parity (${mode})`,
				)
			}
		}
	}
})
