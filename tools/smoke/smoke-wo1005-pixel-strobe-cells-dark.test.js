'use strict'

/**
 * WO-1005 — owner: "pixel strobe heads are lit all the time and dont react to the programmer". In the Pixel Strobe's
 * 15 Ch mode the master channels sit on the ForeGround / Background geometries; the 70 pixel cells (Pixelmap →
 * GeometryReference Section A / B) are reached only by Head_DimmerMode. gdtf-visual.js read "a channel in scope, no
 * dimmer" as full white. A beam is lit now only when a light channel (dimmer, shutter, emitter, filter, colour wheel)
 * reaches it.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const { compileVisual, decodeVisual } = require('../../src/fixtures/gdtf-visual')

const fn = (attribute, from = 0, to = 255) => ({ attribute, name: attribute, from, to, sets: [] })
const ch = (name, geometry, offset, functions, def = 0) => ({ name, geometry, offsets: [offset], functions, default: def })

const mode = {
	name: '15 Ch',
	channels: [
		ch('ForeGround_Dimmer', 'ForeGround', 1, [fn('Dimmer')]),
		ch('ForeGround_R', 'ForeGround', 2, [fn('ColorAdd_R')], 255),
		ch('ForeGround_B', 'ForeGround', 3, [fn('ColorAdd_B')], 255),
		ch('Head_DimmerMode', 'Head', 4, [fn('DimmerMode')]),
	],
}
const rig = {
	nodes: [
		{ id: 'Yoke', parent: -1, kind: 'Geometry' },
		{ id: 'Head', parent: 0, kind: 'Axis' },
		{ id: 'Beam', parent: 1, kind: 'Geometry' },
		{ id: 'Pixelmap1', parent: 2, kind: 'Geometry' },
		{ id: 'Section 1', parent: 3, kind: 'Beam', beam: { beamAngle: 60 } },
		{ id: 'ForeGround', parent: 2, kind: 'Beam', beam: { beamAngle: 120 } },
	],
}
const plan = compileVisual({ wheels: {} }, mode, rig)
const frame = (vals) => Uint8Array.from({ length: 512 }, (_, i) => vals[i + 1] ?? 0)

test('a cell only a non-light channel reaches stays dark at any DMX', () => {
	assert.deepStrictEqual(plan.beams.find((b) => b.id === 'Section 1').scope.map((c) => c.name), ['Head_DimmerMode'])
	for (const f of [{}, { 1: 255, 2: 255, 3: 255, 4: 255 }]) assert.strictEqual(decodeVisual(plan, frame(f), 1).beams['Section 1'].i, 0)
})

test('the ForeGround beam follows its dimmer and colour', () => {
	assert.strictEqual(decodeVisual(plan, frame({}), 1).beams.ForeGround.i, 0, 'dimmer 0 = dark')
	assert.deepStrictEqual(decodeVisual(plan, frame({ 1: 255, 3: 255 }), 1).beams.ForeGround, { i: 1, c: [0, 0, 1], zoom: 120 })
})
