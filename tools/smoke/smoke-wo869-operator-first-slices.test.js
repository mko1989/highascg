'use strict'

/**
 * WO-868 × WO-869 — a pixel-mapping canvas on GPU heads with "Operator GUI first" on (the box's rig 30.10: operator GUI
 * and Dioda both mainScreenIndex 0, Dioda → mapping node → DP-0). Found on the box before the first real-head Apply:
 * - the mapping canvas took x=0 and pushed the operator monitor to its right (WO-40a offset), breaking operator-first;
 * - the operator GUI destination (same mainScreenIndex) was taken as the screen's program destination, so its own
 *   DP-4 cable kept the Dioda PGM window on over the slice window.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const { buildConfigXml } = require('../../src/config/config-generator')
const { calculateLayoutPositions } = require('../../src/utils/os-layout-calculator')
const { OPERATOR_CURSOR_GAP_PX: GAP } = require('../../src/utils/os-layout-calculator-place')

const { boxConfig } = require('./fixtures/wo869-box-config')

const heads = (lay) => ({
	og: Object.values(lay.operatorGui || {}).map((i) => [i.sysId, i.x, i.width]),
	map: (lay.mappingGpuOutputs || []).map((r) => [r.sysId, r.x, r.width]),
})

test('operator-first: the operator monitor keeps x=0, the mapping canvas starts right of it', () => {
	const lay = calculateLayoutPositions(buildCasparGeneratorFlatConfig(boxConfig()))
	// WO-938: the canvas starts past the cursor gap, so the arrow's tail can never be drawn on DP-0
	assert.deepEqual(heads(lay), { og: [['DP-4', 0, 1920]], map: [['DP-0', 1920 + GAP, 3840]] })
	assert.equal(lay.mappingCanvasOffsetX, 1920 + GAP)
	assert.deepEqual([lay.mappingGpuBBox.minX, lay.mappingGpuBBox.maxX], [1920 + GAP, 5760 + GAP])
})

test('legacy order is unchanged: the mapping canvas heads the desktop, the operator GUI follows it', () => {
	const lay = calculateLayoutPositions(buildCasparGeneratorFlatConfig(boxConfig({ operatorFirst: false })))
	assert.deepEqual(heads(lay), { og: [['DP-4', 3840 + GAP, 1920]], map: [['DP-0', 0, 3840]] }) // WO-938 gap before the GUI
	assert.equal(lay.mappingCanvasOffsetX, undefined)
})

test('operator-first: the slice window sits on DP-0 (x=1920+gap) and the Dioda PGM window is off', () => {
	const flat = buildCasparGeneratorFlatConfig(boxConfig())
	assert.equal(flat.screen_1_screen_consumer, false, 'the operator GUI cable is not a Dioda PGM head')
	assert.deepEqual(flat.screen_1_slice_windows.map((w) => [w.device, w.x, w.y, w.width, w.height]), [[41, 1920 + GAP, 0, 3840, 1792]])
	const xml = buildConfigXml(flat)
	const devices = [...xml.matchAll(/<screen>\s*<device>(\d+)<\/device>\s*<x>(\d+)<\/x>/g)].map((m) => [Number(m[1]), Number(m[2])])
	assert.deepEqual(devices, [[41, 1920 + GAP]], 'one screen consumer: the slice window on DP-0')
})

test('WO-1029: without slice windows the mapping-fed PGM window starts at the mapping canvas, not on the operator monitor', () => {
	// highascg5867, 10.11: operator GUI first, PGM/PRV 3 → mapping node → two GPU heads, no slice plan → the node-canvas
	// window was generated at 0,0, always on top, over the operator monitor ("no gui, no mouse").
	const { setCasparCaps, resetCasparCaps } = require('../../src/config/caspar-caps')
	setCasparCaps({ screenSlices: false, source: 'test' })
	try {
		const flat = buildCasparGeneratorFlatConfig(boxConfig())
		const lay = calculateLayoutPositions(flat)
		assert.equal(flat.screen_1_slice_windows, undefined, 'no slice windows on a Caspar without slices')
		if (flat.screen_1_screen_consumer !== false) {
			assert.equal(flat.screen_1_x, lay.mappingGpuBBox.minX, 'the legacy window sits at the mapping bbox')
			assert.equal(flat.screen_1_x, 1920 + GAP)
			assert.equal(flat.screen_1_y, lay.mappingGpuBBox.minY)
			const xml = buildConfigXml(flat)
			const xs = [...xml.matchAll(/<screen>[\s\S]*?<x>(\d+)<\/x>/g)].map((m) => Number(m[1]))
			assert.ok(xs.length >= 1 && xs.every((x) => x >= 1920), `no Caspar window on the operator monitor: ${xs}`)
		} else {
			assert.fail('fixture: the mapping-fed screen has no legacy window — the case is not covered')
		}
		// legacy order (mapping canvas first): unchanged, x = 0
		const old = buildCasparGeneratorFlatConfig(boxConfig({ operatorFirst: false }))
		assert.equal(old.screen_1_x ?? 0, 0)
	} finally {
		resetCasparCaps()
	}
})
