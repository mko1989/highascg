'use strict'

/**
 * WO-1082 — an EMPTY ballroom (the Hilton Wawer show, 15.11): no tables, the finished floor (a carpet) 24 cm above two
 * floor-plan sheets at 0 that each cover the whole room, walls as single-sided quads standing on the carpet, a 3 × 15 m
 * stage 0.4 m high against a long wall. Before: the plan sheets' areas were SUMMED (2 × the room), so the carpet level
 * lost the "≥ half the largest level" vote and the hall sat at 0 — the cars drove 24 cm under the floor, no wall reached
 * the occupancy band, and the whole-room tours died in the room's corners (the first leg's keep-out band shut the
 * corner); with the chandeliers hidden (no simplification) the stage covering 1 cm proud of the stage level stood in the
 * height field over every ramp's top (no room track). Now: a level's area is the union of its surfaces
 * (rc-scene-geom.js hallFloor), a tour whose extreme stops do not route retries with stops that keep turning room
 * (rc-toy-route.js ROOMY), and the height field clears the stage up to FLAT_DECOR above its level (rc-scene.js).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { writeGlb } = require('../../src/stage/glb-write')
const O = require('../../modules/rc-game/server/rc-scene-occ')
const { bakeScene, sceneInputs } = require('../../modules/rc-game/server/rc-scene')
const { validateTrack } = require('../../modules/rc-game/server/rc-track-check')

const ID = 'b0a11400b0a1'
const boxXf = (s, c) => [s[0], 0, 0, 0, s[1], 0, 0, 0, s[2], c[0], c[1], c[2]]
const W = 30, D = 62, CZ = 3.4, CARPET = 0.24, STAGE_TOP = 0.64 // the room's centre z: the stage's long side faces the room, as there

function cubeGlb() {
	const pos = [], idx = []
	for (let i = 0; i < 8; i++) pos.push(i & 1 ? 0.5 : -0.5, i & 2 ? 0.5 : -0.5, i & 4 ? 0.5 : -0.5)
	for (const f of [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]) idx.push(f[0], f[1], f[2], f[0], f[2], f[3])
	return writeGlb([{ name: 'cube', primitives: [{ positions: new Float32Array(pos), indices: new Uint32Array(idx), color: [0.5, 0.5, 0.5, 1] }] }])
}

/** A single-sided quad in the x = 0 plane (1 × 1, centred): what a venue export's wall skin is. */
function quadGlb() {
	const pos = new Float32Array([0, -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5])
	return writeGlb([{ name: 'quad', primitives: [{ positions: pos, indices: new Uint32Array([0, 1, 2, 0, 2, 3]), color: [0.7, 0.7, 0.7, 1] }] }])
}

const wallH = 5.75, wy = CARPET + wallH / 2
const scene = () => ({
	name: 'Empty ballroom',
	objects: [
		// two floor-plan sheets at 0, each the whole room (dimension plan, rigging plan)
		{ uuid: 'PLAN1', layer: 'Plan dims', parts: [{ mesh: 'cube', xform: boxXf([W, 0.002, D], [0, 0, CZ]) }] },
		{ uuid: 'PLAN2', layer: 'Plan rigging', parts: [{ mesh: 'cube', xform: boxXf([W, 0.002, D], [0, 0.001, CZ]) }] },
		// the finished floor: a carpet 24 cm up, a little inside the plans
		{ uuid: 'CARPET', layer: 'Carpet', parts: [{ mesh: 'cube', xform: boxXf([W - 0.3, 0.002, D - 0.6], [0, CARPET, CZ]) }] },
		// four walls standing on the carpet, single-sided quads
		{ uuid: 'WALLS', layer: 'Walls', parts: [
			{ mesh: 'quad', xform: boxXf([1, wallH, D], [-W / 2 + 0.2, wy, CZ]) },
			{ mesh: 'quad', xform: boxXf([1, wallH, D], [W / 2 - 0.2, wy, CZ]) },
			{ mesh: 'quad', xform: [0, 0, 1, 0, wallH, 0, -W, 0, 0, 0, wy, CZ - D / 2 + 0.35] },
			{ mesh: 'quad', xform: [0, 0, 1, 0, wallH, 0, -W, 0, 0, 0, wy, CZ + D / 2 - 0.35] },
		] },
		// the stage: 3 × 15 m, 0.4 m on the carpet, near the +x wall
		{ uuid: 'STAGE', layer: 'Stage', parts: [{ mesh: 'cube', xform: boxXf([3, STAGE_TOP - CARPET, 15], [11, (CARPET + STAGE_TOP) / 2, 3.5]) }] },
		// the stage covering, 1 cm proud of the stage level (the tracking grid says 0.64): stage floor, not an obstacle
		{ uuid: 'COVER', layer: 'Stage cover', parts: [{ mesh: 'cube', xform: boxXf([3, 0.01, 15], [11, STAGE_TOP + 0.005, 3.5]) }] },
		{ uuid: 'CEIL', layer: 'Ceiling', parts: [{ mesh: 'cube', xform: boxXf([W - 0.3, 0.002, D - 0.6], [0, CARPET + wallH, CZ]) }] },
	],
})
const store = { get: (id) => (id === ID ? { name: 'Empty ballroom', scene: scene() } : null), mesh: async (id, key) => (key === 'cube' ? cubeGlb() : key === 'quad' ? quadGlb() : null) }
// the tracking grid = the stage (x_offset, -z centre, z_offset = its top)
const project = { name: 'Ballroom', previs: { mvr: { id: ID, name: 'Empty ballroom' }, tracking: { grid: { width: 3, depth: 15, x_offset: 11, y_offset: -3.5, z_offset: STAGE_TOP } } } }

let baked = null
const bake = () => (baked ||= bakeScene(sceneInputs(project), 'empty', { mvrStore: store, scale: 0.1 }))

test('the hall is the carpet (24 cm up), not the plan sheets under it: the union of a level, not the sum', async () => {
	const { json } = await bake()
	const hall = json.floors.find((f) => f.id === 'hall'), stage = json.floors.find((f) => f.id === 'stage')
	assert.ok(Math.abs(hall.y - (CARPET + 0.001)) <= 0.002, `hall y ${hall.y}`)
	assert.ok(Math.abs(stage.y - hall.y - 0.4) <= 0.003, `stage ${stage.y} is 0.4 above the hall ${hall.y}`)
	const g = O.fromJSON(json.occ.find((o) => o.floor === 'hall'))
	const blocked = (x, z) => g.bits[Math.floor((z - g.z0) / g.cell) * g.w + Math.floor((x - g.x0) / g.cell)] === 1
	assert.ok(blocked(-W / 2 + 0.2, 0) && blocked(W / 2 - 0.2, -20), 'the single-sided wall quads stand in the band')
	assert.ok(!blocked(0, 0) && !blocked(-5, 15), 'the empty room is free')
})

test('an empty ballroom gets the full set: room tracks, the bridge, both whole-room tours, no tunnel (no tables)', async () => {
	const { json } = await bake()
	const ids = json.tracks.map((t) => t.id)
	for (const t of json.tracks) {
		const v = validateTrack(t, json)
		assert.ok(v.ok, `${t.id}: ${v.errors.join(', ')}`)
	}
	const tours = json.tracks.filter((t) => t.kind === 'room-long')
	assert.equal(tours.length, 2, `two whole-room tours (${ids})`)
	assert.ok(tours.every((t) => t.length >= 60 && t.laps === 1), tours.map((t) => t.length).join())
	assert.ok(json.tracks.filter((t) => t.floor === 'room' && t.kind === 'room').length >= 3, `room tracks (${ids})`)
	assert.ok(ids.includes('hall-bridge'), 'the toy bridge')
	assert.ok(json.tracks.length >= 10, `${json.tracks.length} tracks (${ids})`)
	assert.ok(json.tracks.every((t) => !t.tunnels?.length), 'no table, no tunnel')
})

test('source guards: union area in hallFloor, the stage cleared to FLAT_DECOR, the roomy retry only after the extreme stops failed', () => {
	const geo = fs.readFileSync(path.join(__dirname, '../../modules/rc-game/server/rc-scene-geom.js'), 'utf8')
	assert.match(geo, /l\.area = unionArea\(l\.items\)/)
	const bake = fs.readFileSync(path.join(__dirname, '../../modules/rc-game/server/rc-scene.js'), 'utf8')
	assert.match(bake, /field\.clearBelow\(stage\.rect, stage\.y \+ FLAT_DECOR \* scale\)/)
	const route = fs.readFileSync(path.join(__dirname, '../../modules/rc-game/server/rc-toy-route.js'), 'utf8')
	const plain = route.indexOf('targets, avoid: [legPath(a), legPath(b)], need, list: [] })')
	const roomy = route.indexOf('for (const extra of ROOMY)')
	assert.ok(plain > 0 && roomy > plain, 'the retry comes after the plain tour (Narvil and every furnished room unchanged)')
})
