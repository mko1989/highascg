'use strict'

/**
 * WO-1006 — owner: "pixel strobes has the virtual leds under a mesh which makes them glitch in and out of visibility
 * (this is true also for pixeline) … all the leds in the middle of the fixture as a circle, and the fixture is
 * rectangle". (1) GDTF Position rotations were read as rows; the spec's "stored row-major, defined column-major" (and
 * BlenderDMX's inverted 3×3) means the transpose — read as rows, the Pixel Strobe's plate sat on the head's back face.
 * (2) Every lens was a 100 mm disc on the beam origin plane; a beam's lens is now its own primitive model (or the flat
 * plate it sits on), layered by depth so it never shares a plane with another lens.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const { gdtfMatrix, transposeRotation } = require('../../src/stage/mvr-math')
const { buildRig } = require('../../src/fixtures/gdtf-rig')

test('a GDTF rotation is the transpose of its groups read as rows; the translation stays the 4th values', () => {
	const m = gdtfMatrix('{0,1,0,0.1}{-1,0,0,0.2}{0,0,1,0.3}{0,0,0,1}')
	assert.deepStrictEqual(m.slice(0, 3), [0, 1, 0], 'local x → +Y (the first group, as a column)')
	assert.deepStrictEqual(m.slice(4, 7), [-1, 0, 0], 'local y → −X')
	assert.deepStrictEqual(m.slice(12, 15), [0.1, 0.2, 0.3])
	const old = [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0.1, 0.2, 0.3, 1] // the pre-fix reading of the same text
	assert.deepStrictEqual(transposeRotation(old), m, 'a stored record migrates to today\'s reading')
})

const I = '{1,0,0,0}{0,1,0,0}{0,0,1,0}{0,0,0,1}'
const geo = (type, name, model, children = [], beam = null) => ({ type, name, model, m: gdtfMatrix(I), children, ...(beam ? { beam } : {}) })
const type = {
	files: [],
	models: {
		Plate: { file: '', size: [0.16, 0.47, 0.001], type: 'Cube' },
		Pix: { file: '', size: [0.04, 0.031, 0.001], type: 'Cube' },
		Lens: { file: '', size: [0.1, 0.1, 0.001], type: 'Cylinder' },
	},
	geometry: [geo('Geometry', 'Head', '', [
		geo('Geometry', 'Face', 'Plate', [
			geo('Beam', 'Fore', '', [], { beamAngle: 120, radius: 0.05 }),
			geo('Geometry', 'Map', '', [geo('Beam', 'Cell', 'Pix', [], { beamAngle: 60, radius: 0.05 })]),
		]),
		geo('Beam', 'Spot', 'Lens', [], { beamAngle: 20, radius: 0.05 }),
	])],
}

test('lens = own primitive model (no extra box), else the flat plate it sits on; deeper beams on a higher layer', () => {
	const rig = buildRig(type, { name: 'm', channels: [] })
	const at = (id) => rig.nodes.find((n) => n.id === id)
	assert.deepStrictEqual(at('Cell').beam.lens, [0.04, 0.031, false])
	assert.strictEqual(at('Cell').mesh, undefined, 'the pixel is drawn as its lens only')
	assert.deepStrictEqual(at('Fore').beam.lens, [0.16, 0.47, false], 'a model-less beam takes the plate it sits on')
	assert.deepStrictEqual(at('Spot').beam.lens, [0.1, 0.1, true], 'a cylinder model is a round lens')
	assert.ok(at('Cell').beam.layer > at('Fore').beam.layer, 'the pixel sits in front of the plate')
})
