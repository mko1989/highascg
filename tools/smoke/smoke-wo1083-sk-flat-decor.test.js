'use strict'

/**
 * WO-1083 — Stage Skirmish: flat decor (a carpet, a mat) that the RC bake marks in `occ` does not block soldiers or
 * bullets (server/sk-occ-flat.js): on a synthetic toy-scale floor (scale 0.1, occ cells 3 cm, the bake's height field
 * of 5 cm cells / 2.5 cm bins) a 1 cm carpet is cleared, a table leg and a 3 cm step stay solid, a cell outside the
 * height field stays as baked, a scene without a field is returned untouched, and the scene the game serves (sk-scene.js)
 * hands the filtered grid to the arenas and the client alike.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const requireCore = (id) => require(id.startsWith('src/') ? path.join(ROOT, id) : require.resolve(id, { paths: [ROOT] }))
require('../../modules/toy-skirmish/register')({ requireCore, coreRoot: ROOT, log: () => {} })
const { kit } = require('../../modules/toy-skirmish/server/sk-kit')
const { clearFlatDecor, FLAT_U } = require('../../modules/toy-skirmish/server/sk-occ-flat')
const { createSkScene } = require('../../modules/toy-skirmish/server/sk-scene')
// the RC module's own bake pieces, used read-only to build a synthetic scene exactly as the baker would
const O = require('../../modules/rc-game/server/rc-scene-occ')
const H = require('../../modules/rc-game/server/rc-scene-height')

const S = 0.1
const FLOOR = { id: 'hall', y: 0.5, rect: [0, 0, 3, 3] }

/** Mark world rect [x0, z0, x1, z1] in occ, and the box up to height h (m above the floor) in the field. */
function put(occ, field, r, h) {
	for (let k = 0; k < occ.h; k++) {
		for (let i = 0; i < occ.w; i++) {
			const x = occ.x0 + (i + 0.5) * occ.cell, z = occ.z0 + (k + 0.5) * occ.cell
			if (x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]) occ.bits[k * occ.w + i] = 1
		}
	}
	field?.box([r[0], FLOOR.y, r[1]], [r[2], FLOOR.y + h, r[3]])
}

function synthetic({ withField = true, fieldRect = FLOOR.rect } = {}) {
	const occ = O.createOcc(FLOOR, { cell: 0.3 * S, lo: 0.05 * S, hi: 0.6 * S })
	const field = withField ? H.createHeightField(fieldRect, FLOOR.y, { cell: 0.5 * S, bin: 0.25 * S, eps: 0.05 * S, deflate: true }) : null
	put(occ, field, [0.3, 0.3, 1.2, 0.9], 0.01) // a 1 cm carpet (0.1 u)
	put(occ, field, [2.0, 2.0, 2.04, 2.04], 0.75) // a table leg
	put(occ, field, [0.3, 2.0, 1.2, 2.3], 0.045) // a 4.5 cm step (0.45 u): above FLAT_U, stays
	put(occ, null, [2.6, 0.2, 2.8, 0.4], 0) // something the field never saw
	const json = { rev: 'flat', scale: S, floors: [{ ...FLOOR }], occ: [occ.toJSON()], ...(field ? { heights: field.toJSON() } : {}) }
	return json
}

const solidAt = (json, x, z) => {
	const g = kit().occFromJSON(json.occ[0])
	return g.bits[Math.floor((z - g.z0) / g.cell) * g.w + Math.floor((x - g.x0) / g.cell)] === 1
}

test('a carpet is cleared; a leg, a 4.5 cm step and cells the field does not cover stay solid', () => {
	assert.equal(FLAT_U, 0.3)
	const json = synthetic({ fieldRect: [0, 0, 2.5, 3] })
	assert.ok(solidAt(json, 0.7, 0.6), 'baked: the carpet blocks')
	const { json: out, cleared } = clearFlatDecor(json)
	assert.notEqual(out, json, 'a new object; the baked JSON is not mutated')
	assert.ok(solidAt(json, 0.7, 0.6), 'the input is untouched')
	assert.equal(solidAt(out, 0.7, 0.6), false, 'carpet middle is floor')
	assert.equal(solidAt(out, 0.35, 0.35), false, 'carpet corner is floor')
	assert.ok(cleared.hall > 100, `cells cleared: ${cleared.hall}`)
	assert.ok(solidAt(out, 2.02, 2.02), 'the leg stays')
	assert.ok(solidAt(out, 0.7, 2.15), 'the step stays')
	assert.ok(solidAt(out, 2.7, 0.3), 'outside the field: kept as baked')
})

test('no height field: the scene is returned as it is', () => {
	const json = synthetic({ withField: false })
	const r = clearFlatDecor(json)
	assert.equal(r.json, json)
	assert.deepEqual(r.cleared, {})
})

test('the served scene carries the filtered occ (arenas and client use the same grid)', async () => {
	const json = synthetic()
	const sc = await createSkScene({ baker: { get: async () => ({ rev: json.rev, json, glb: null }), rev: () => json.rev }, pause: async () => {} }).get()
	assert.equal(solidAt(sc.json, 0.7, 0.6), false)
	assert.ok(solidAt(sc.json, 2.02, 2.02))
	assert.ok(JSON.parse(sc.text).occ[0].rle.length > 0)
})
