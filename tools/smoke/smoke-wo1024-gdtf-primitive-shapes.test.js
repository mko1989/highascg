'use strict'

/**
 * WO-1024 — a GDTF model without a mesh file is drawn as the shape of its built-in primitive, not always a box.
 * Brighter X-DOT Max (every GDTF Share revision, 09.11): Base1_1 / Yoke / Head primitives only → three boxes.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildRig } = require('../../src/fixtures/gdtf-rig')

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const at = (z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, z, 1]

test('WO-1024: built-in primitives → their shape key; a file still wins; Base / Cube stay boxes', () => {
	const type = {
		files: ['models/gltf/lens.glb'],
		models: {
			Base: { file: '', type: 'Base1_1', size: [0.42, 0.28, 0.11] },
			Yoke: { file: '', type: 'Yoke', size: [0.42, 0.06, 0.4] },
			Head: { file: '', type: 'Head', size: [0.28, 0.28, 0.3] },
			Ball: { file: '', type: 'Sphere', size: [0.1, 0.1, 0.1] },
			Plate: { file: '', type: 'Cube', size: [0.2, 0.2, 0.05] },
			Lens: { file: 'lens', type: 'Undefined', size: [0.05, 0.05, 0.05] },
		},
		geometry: [
			{ name: 'Base', type: 'Geometry', model: 'Base', m: I, children: [
				{ name: 'Yoke', type: 'Axis', model: 'Yoke', m: at(-0.21), children: [
					{ name: 'Head', type: 'Axis', model: 'Head', m: at(-0.12), children: [] },
				] },
				{ name: 'Ball', type: 'Geometry', model: 'Ball', m: I, children: [] },
				{ name: 'Plate', type: 'Geometry', model: 'Plate', m: I, children: [] },
				{ name: 'Lens', type: 'Geometry', model: 'Lens', m: I, children: [] },
			] },
		],
	}
	const rig = buildRig(type, { name: 'M', footprint: 1, geometry: 'Base', channels: [] })
	const by = Object.fromEntries(rig.nodes.map((n) => [n.id, n.mesh]))
	assert.deepEqual(by, { Base: 'prim:box', Yoke: 'prim:yoke', Head: 'prim:cylinder', Ball: 'prim:sphere',
		Plate: 'prim:box', Lens: 'models/gltf/lens.glb' })
	const yoke = rig.nodes.find((n) => n.id === 'Yoke')
	assert.deepEqual(yoke.mesh_xf.slice(0, 9), [0.42, 0, 0, 0, 0.4, 0, 0, 0, 0.06], 'still scaled to its size box')
})
