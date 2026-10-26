'use strict'

/**
 * WO-784 — owner: "mac aura pxl doesnt luminate". The Aura's GDTF has virtual dimmers (Offset="", Default 0) on the
 * head and on every pixel; the previs read them at their default and multiplied every beam to 0. A virtual channel is
 * the console's own value, never on the wire: gdtf-visual.js leaves it out of every beam's scope.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const { compileVisual, decodeVisual } = require('../../src/fixtures/gdtf-visual')

const fn = (attribute, from = 0, to = 255, extra = {}) => ({ attribute, name: attribute, from, to, sets: [], ...extra })
const ch = (name, geometry, offsets, functions, def = 0) => ({ name, geometry, offsets, functions, default: def })

// Aura-like: Head (virtual dimmer 0) → Beams (real dimmer + R G B) → Pixel 1, plus a virtual white on the pixel at 255.
const mode = {
	name: 'Basic',
	channels: [
		ch('Head_Dimmer', 'Head', [], [fn('Dimmer')], 0),
		ch('Beams_Dimmer', 'Beams', [1], [fn('Dimmer')]),
		ch('Beams_R', 'Beams', [2], [fn('ColorRGB_Red')]),
		ch('Beams_G', 'Beams', [3], [fn('ColorRGB_Green')]),
		ch('Pixel_W', 'Pixel 1', [], [fn('ColorAdd_W')], 255),
	],
}
const rig = {
	nodes: [
		{ id: 'Head', parent: -1, kind: 'Axis' },
		{ id: 'Beams', parent: 0, kind: 'Geometry' },
		{ id: 'Pixel 1', parent: 1, kind: 'Beam', beam: { beamAngle: 20 } },
		{ id: 'Pixel 2', parent: 0, kind: 'Beam', beam: { beamAngle: 20 } },
	],
}
const plan = compileVisual({ wheels: {} }, mode, rig)
const frame = (vals) => Uint8Array.from({ length: 512 }, (_, i) => vals[i + 1] ?? 0)

test('a virtual dimmer at default 0 no longer blacks the beam out; a virtual W does not whiten it', () => {
	const d = decodeVisual(plan, frame({ 1: 255, 2: 255 }), 1)
	assert.deepStrictEqual(d.beams['Pixel 1'], { i: 1, c: [1, 0, 0], zoom: 20 }, 'full red from the real channels only')
	assert.strictEqual(decodeVisual(plan, frame({ 1: 0, 2: 255 }), 1).beams['Pixel 1'].i, 0, 'the real dimmer still dims')
})

test('virtual channels are out of every scope; a beam only virtual channels reach stays dark', () => {
	assert.deepStrictEqual(plan.beams.find((b) => b.id === 'Pixel 1').scope.map((c) => c.name), ['Beams_Dimmer', 'Beams_R', 'Beams_G'])
	assert.deepStrictEqual(plan.beams.find((b) => b.id === 'Pixel 2').scope, [])
	assert.strictEqual(decodeVisual(plan, frame({ 1: 255 }), 1).beams['Pixel 2'].i, 0)
})
