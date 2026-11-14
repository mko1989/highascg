'use strict'

/**
 * WO-1074 — RC game scene builder (modules/rc-game/server/rc-scene*.js) on a small synthetic MVR scene: placement, moved objects,
 * hidden layers / objects and layer colours are applied the way the previs applies them; floors, obstacles and tracks
 * come out of the geometry; the merged GLB is flat (no NORMAL) and within budget, the budget ladder drops fixtures first,
 * then simplifies, then drops the smallest objects; the baker caches on disk and shares one in-flight bake; no scene →
 * the default hall. v2: the stage is a floor the room tracks drive onto (cleared from the hall's obstacle grid, not a
 * box), a stage with no MVR hall gets a hall of stage + 18 m all round, and the rev hashes the generator version.
 * §2.7: the bake's height field (rc-scene-height.js) — bins, queries, the stage cleared, the JSON `heights` round trip.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { writeGlb, readGlb } = require('../../src/stage/glb-write')
const G = require('../../modules/rc-game/server/rc-scene-geom')
const M = require('../../modules/rc-game/server/rc-scene-mesh')
const { bakeScene, createSceneBaker, sceneInputs, revOf } = require('../../modules/rc-game/server/rc-scene')
const { validateTrack } = require('../../modules/rc-game/server/rc-tracks')
const H = require('../../modules/rc-game/server/rc-scene-height')

/** A unit cube centred on the origin, subdivided `n` times per face (more triangles for the budget test). */
function cubeGlb(n = 1) {
	const pos = [], idx = []
	const faces = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
	for (const [a, b, c] of faces) {
		for (const side of [-0.5, 0.5]) {
			const base = pos.length / 3
			for (let i = 0; i <= n; i++) {
				for (let j = 0; j <= n; j++) {
					const v = [0, 0, 0]
					v[a] = -0.5 + i / n
					v[b] = -0.5 + j / n
					v[c] = side
					pos.push(...v)
				}
			}
			for (let i = 0; i < n; i++) {
				for (let j = 0; j < n; j++) {
					const q = base + i * (n + 1) + j
					idx.push(q, q + 1, q + n + 1, q + 1, q + n + 2, q + n + 1)
				}
			}
		}
	}
	return writeGlb([{ name: 'cube', primitives: [{ positions: new Float32Array(pos), indices: new Uint32Array(idx), color: [0.5, 0.5, 0.5, 1] }] }])
}

/** xform (columns x, y, z, origin) of a box of size s centred at c. */
const boxXf = (s, c) => [s[0], 0, 0, 0, s[1], 0, 0, 0, s[2], c[0], c[1], c[2]]
const ID = 'a1b2c3d4e5f6'

function scene() {
	return {
		name: 'Synthetic venue',
		objects: [
			{ uuid: 'FLOOR', layer: 'Venue', parts: [{ mesh: 'cube', xform: boxXf([40, 0.1, 30], [0, -0.05, 5]) }] },
			{ uuid: 'leg1', layer: 'Truss', parts: [{ mesh: 'cube', xform: boxXf([0.4, 5, 0.4], [-12, 2.5, 12]) }] },
			{ uuid: 'leg2', layer: 'Truss', parts: [{ mesh: 'cube', xform: boxXf([0.4, 5, 0.4], [12, 2.5, 12]) }] },
			{ uuid: 'moved', layer: 'Truss', parts: [{ mesh: 'cube', xform: boxXf([0.4, 5, 0.4], [0, 2.5, 0]) }] },
			{ uuid: 'gone', layer: 'Truss', parts: [{ mesh: 'cube', xform: boxXf([2, 2, 2], [5, 1, 15]) }] },
			{ uuid: 'hiddenlayer', layer: 'Hidden', parts: [{ mesh: 'cube', xform: boxXf([2, 2, 2], [-5, 1, 15]) }] },
			{ uuid: 'spot', layer: 'Lights', fixture: true, parts: [{ mesh: 'fine', xform: boxXf([0.3, 0.3, 0.3], [0, 6, 10]) }] },
		],
	}
}

const cfg = {
	id: ID,
	name: 'Synthetic',
	place: { x: 2, y: 0, z: 0, yaw: 0 },
	moved: { MOVED: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 20] },
	hidden_layers: ['Hidden'],
	hidden_objects: ['GONE'],
	layer_colors: { Truss: '#ff0000' },
}

function fakeStore(rec, meshes, calls = { mesh: 0 }, jsonFile = null) {
	return { calls, get: (id) => (id === ID && rec ? { name: rec.name, scene: rec } : null), mesh: async (id, key) => (calls.mesh++, meshes[key] || null), fileOf: () => jsonFile }
}

const meshes = { cube: cubeGlb(1), fine: cubeGlb(30) }

test('visibleParts applies place, moved, hidden layers / objects and layer colours like the previs', () => {
	const parts = G.visibleParts(scene(), cfg)
	const uuids = new Set(parts.map((p) => p.uuid))
	assert.ok(!uuids.has('gone') && !uuids.has('hiddenlayer'), 'hidden object and hidden layer left out')
	assert.equal(parts.length, 5)
	const leg = parts.find((p) => p.uuid === 'leg1')
	assert.deepEqual(leg.xf.slice(9), [-10, 2.5, 12], 'place.x moves everything by +2')
	assert.deepEqual(leg.color.slice(0, 3), [1, 0, 0], 'Truss layer colour (sRGB #ff0000 → linear 1, 0, 0)')
	assert.equal(parts.find((p) => p.uuid === 'floor').color, null, 'no layer colour → the mesh colour')
	assert.deepEqual(parts.find((p) => p.uuid === 'moved').xf.slice(9), [2, 2.5, 20], 'moved[uuid] applied under the placement')
	assert.equal(parts.find((p) => p.uuid === 'spot').fixture, true)
	// yaw 90°: Ry(−90°) maps +x → +z
	const turned = G.visibleParts(scene(), { ...cfg, place: { yaw: 90 }, moved: {} }).find((p) => p.uuid === 'leg2')
	const o = turned.xf.slice(9)
	assert.ok(Math.abs(o[0] - -12) < 1e-9 && Math.abs(o[2] - 12) < 1e-9, `yaw 90 → ${o}`)
	// (12, 12) → (−12, 12): x went to +z, z to −x
	// the tracking stage: PSN frame → Godot (x, z, −y), a centred rect
	assert.deepEqual(G.stageFloor({ width: 10, depth: 6, x_offset: 1, y_offset: 4, z_offset: 1.2 }), { id: 'stage', y: 1.2, rect: [-4, -7, 6, -1] })
	assert.equal(G.stageFloor({ width: 0, depth: 6 }), null)
})

test('bakeScene: floors, obstacles, valid tracks, a flat GLB within budget; the venue GLB is ignored and said so', async () => {
	const inp = sceneInputs({ name: 'P', previs: { mvr: { ...cfg, venue_glb: 'venue.glb' }, tracking: { grid: { width: 8, depth: 6, x_offset: 2, y_offset: 4, z_offset: 1.2 } },
		stage: { objects: [{ type: 'led_wall', panels: [8, 4], panel_mm: [500, 500], position: [2, 1.2, -8], rotation: [0, 0, 0] }] } } })
	const calls = { mesh: 0 }
	const { json, glb } = await bakeScene(inp, 'r1', { mvrStore: fakeStore(scene(), meshes, calls) })
	assert.equal(calls.mesh, 2, 'one mesh read per distinct template')
	const hall = json.floors.find((f) => f.id === 'hall'), stage = json.floors.find((f) => f.id === 'stage')
	assert.ok(hall && stage)
	assert.equal(hall.y, 0)
	assert.deepEqual(hall.rect, [-18, -10, 22, 20], 'the floor slab, moved by place.x')
	assert.deepEqual(stage, { id: 'stage', y: 1.2, rect: [-2, -7, 6, -1] })
	const at = (x, z) => json.obstacles.some((o) => x >= o.min[0] && x <= o.max[0] && z >= o.min[2] && z <= o.max[2] && o.min[1] < hall.y + 0.6)
	assert.ok(at(-10, 12) && at(14, 12), 'truss legs are hall obstacles')
	assert.ok(at(2, 20), 'the moved leg is an obstacle where it was moved to')
	assert.ok(!at(7, 15) && !at(-3, 15), 'hidden object / layer are not obstacles')
	assert.ok(!at(2, -4) && !at(-1.9, -6.9), 'v2: the stage is a floor (room tracks drive up onto it), not a hall obstacle')
	assert.ok(json.obstacles.some((o) => o.min[0] <= 2 && o.max[0] >= 2 && o.min[2] <= -7.9 && o.max[2] >= -7.9 && o.min[1] <= stage.y + 0.02),
		'the LED wall standing behind the stage is an obstacle at stage level')
	assert.ok(json.obstacles.length <= 300)
	assert.ok(json.tracks.length >= 4, json.tracks.map((t) => t.id).join())
	assert.ok(json.tracks.filter((t) => t.floor === 'room').length >= 3, 'room tracks: hall → ramp → stage → hall')
	assert.ok(json.tracks.every((t) => t.points.every((p) => p.length === 3)))
	for (const t of json.tracks) assert.ok(validateTrack(t, json).ok, `${t.id}: ${validateTrack(t, json).errors}`)
	// §2.7: the height field rides along in the JSON (the truss legs stand in it; the stage body is cleared)
	const F = H.fromJSON(json.heights)
	assert.ok(F && F.nx * F.nz * 4 === Buffer.from(json.heights.data, 'base64').length)
	assert.ok(F.bandHit(-10, 12, 0.3, 0.2, 2) && F.bandHit(14, 12, 0.3, 0.2, 2), 'truss legs in the field')
	assert.ok(F.bandHit(2, 10, 0.3, 5.5, 6.5) && !F.bandHit(2, 10, 0.3, 0.1, 5.5), 'the light the GLB draws hangs at 6 m')
	assert.ok(!F.bandHit(8, 10, 1, 0.1, 7) && !F.bandHit(2, -4, 1, 0.1, stage.y), 'open floor; the stage is cleared below its top')
	assert.equal(json.dropped.venueGlb, 'ignored')
	assert.equal(json.dropped.fixtures, 0)
	assert.equal(json.glb, '/api/game/rc/scene.glb?rev=r1')
	assert.equal(json.stats.bytes, glb.length)
	const { json: gj } = readGlb(glb)
	const prims = gj.meshes.flatMap((m) => m.primitives)
	assert.ok(prims.length >= 2, 'one primitive per colour')
	assert.ok(prims.every((p) => p.attributes.POSITION != null && p.attributes.NORMAL == null && p.attributes.TEXCOORD_0 == null), 'flat: positions only')
	assert.ok(!gj.images && !gj.textures)
	const tris = prims.reduce((s, p) => s + gj.accessors[p.indices].count / 3, 0)
	assert.equal(tris, json.stats.triangles)
	assert.ok(glb.length <= 8 * 1024 * 1024 && tris <= 400000)
})

test('§2.7 height field: triangles and boxes mark 0.25 m bins per 0.5 m cell; band / top / bottom queries; JSON round trip', () => {
	const f = H.createHeightField([0, 0, 10, 10], 1)
	assert.equal(f.mask.length, f.nx * f.nz)
	f.tri(2, 1.8, 2, 4, 1.8, 2, 2, 1.8, 4) // a flat triangle 0.8 m above the floor (a table top)
	f.box([7, 4, 7], [8, 4.3, 8]) // a truss 3 m up
	f.box([0, 1, 0], [10, 1.03, 10]) // the floor itself never counts (base = floor + 0.05)
	assert.ok(f.bandHit(2.5, 2.5, 0.1, 1.7, 1.9) && !f.bandHit(2.5, 2.5, 0.1, 2.1, 3.5), 'the table top (its 0.25 m bin), nothing above it')
	assert.ok(f.bandHit(7.5, 7.5, 0, 3.9, 4.1) && !f.bandHit(7.5, 7.5, 0, 1.1, 3.75), 'the truss, a clear band under it (to its bin)')
	assert.ok(f.bandHit(6, 7.5, 1, 3.9, 4.1) && !f.bandHit(5, 7.5, 1, 3.9, 4.1), 'the radius reaches the neighbour cells')
	assert.ok(f.topBelow(2.5, 2.5, 3) >= 1.8 && f.topBelow(2.5, 2.5, 3) <= 1.8 + 0.25, "the top of the table's bin")
	assert.equal(f.topBelow(5, 5, 3), 1, 'nothing below: the floor')
	assert.ok(Math.abs(f.bottomAbove(7.5, 7.5, 2) - 3.8) < 0.26 && f.bottomAbove(5, 5, 2) === Infinity)
	f.box([0, 12, 0], [1, 13, 1])
	assert.ok(f.bandHit(0.5, 0.5, 0, 9.5, 20), 'above 8 m: the ceiling bit')
	f.clearBelow([7, 7, 8, 8], 5)
	assert.ok(!f.bandHit(7.5, 7.5, 0, 3.9, 4.4), 'a floor clears what lies below its top')
	const j = JSON.parse(JSON.stringify({ heights: f.toJSON() }))
	const g = H.fieldOf(j)
	assert.ok(g && H.fieldOf(j) === g, 'decoded once, cached')
	assert.deepEqual([...g.mask], [...f.mask])
	assert.equal(H.fromJSON({ ...j.heights, data: 'AAAA' }), null, 'a malformed field is ignored')
})

test('budget ladder: fixtures first, then a coarser cell, then the smallest objects', async () => {
	const parts = G.visibleParts(scene(), cfg)
	const templates = new Map([['cube', M.readTemplate(meshes.cube)], ['fine', M.readTemplate(meshes.fine)]])
	const all = await M.planBudget(parts, templates)
	assert.deepEqual(all.dropped, { fixtures: 0, objects: 0, cell: 0.002 })
	assert.ok(all.tris > 5000, 'the fine fixture is in')
	const noFix = await M.planBudget(parts, templates, undefined, { maxTris: 100 })
	assert.equal(noFix.dropped.fixtures, 1)
	assert.equal(noFix.dropped.objects, 0)
	assert.ok(noFix.tris <= 100 && !noFix.keep[parts.findIndex((p) => p.fixture)])
	const tight = await M.planBudget(parts, templates, undefined, { maxTris: 30 })
	assert.equal(tight.dropped.fixtures, 1)
	assert.ok(tight.dropped.objects >= 1 && tight.tris <= 30)
	assert.ok(tight.keep[parts.findIndex((p) => p.uuid === 'floor')], 'the biggest object (the floor) stays')
	const legIdx = parts.findIndex((p) => p.uuid === 'leg1')
	assert.equal(tight.keep[legIdx], false, 'a small object went first')
	// the coarser cell kicks in when welding/clustering is enough: a dense mesh at a large scale
	const dense = [{ key: 'fine', xf: boxXf([0.05, 0.05, 0.05], [0, 0, 0]), fixture: false, uuid: 'tiny' }]
	const fine = M.readTemplate(meshes.fine)
	const coarse = await M.planBudget(dense, new Map([['fine', fine]]), undefined, { maxTris: 1000 })
	assert.ok(coarse.dropped.cell > 0.002 && coarse.dropped.objects === 0 && coarse.tris <= 1000, JSON.stringify(coarse.dropped))
})

test('baker: one shared bake, disk cache under cacheDir, a second baker reads the cache; rev follows the inputs', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-scene-'))
	try {
		const recFile = path.join(dir, 'scene.json')
		fs.writeFileSync(recFile, '{}')
		const project = { name: 'P', previs: { mvr: cfg } }
		const calls = { mesh: 0 }
		const deps = { loadProject: () => project, mvrStore: fakeStore(scene(), meshes, calls, recFile), cacheDir: path.join(dir, 'cache') }
		const b = createSceneBaker(deps)
		const r = b.rev()
		assert.match(r, /^a1b2c3d4e5f6-[0-9a-f]{10}$/)
		const p1 = b.get(), p2 = b.get()
		assert.equal(p1, p2, 'concurrent callers share the in-flight bake')
		const out = await p1
		assert.equal(out.rev, r)
		assert.equal(calls.mesh, 2)
		assert.equal(await b.get(), out, 'the finished bake is reused')
		for (const ext of ['.json', '.glb', '.glb.gz']) assert.ok(fs.existsSync(path.join(dir, 'cache', r + ext)), ext)
		assert.deepEqual(JSON.parse(out.text), out.json)
		assert.ok(require('zlib').gunzipSync(out.gz).equals(out.glb))
		const b2 = createSceneBaker(deps)
		const again = await b2.get()
		assert.equal(calls.mesh, 2, 'second baker: from disk, no mesh reads')
		assert.ok(again.glb.equals(out.glb))
		assert.equal(b2.peek(), again)
		// a changed input → a new rev; no MVR id → none-…
		assert.notEqual(revOf(sceneInputs({ previs: { mvr: { ...cfg, hidden_layers: [] } } }), [2, 1]), revOf(sceneInputs(project), [2, 1]))
		assert.match(revOf(sceneInputs(null), null), /^none-[0-9a-f]{10}$/)
		const src = fs.readFileSync(path.join(__dirname, '../../modules/rc-game/server/rc-scene.js'), 'utf8')
		assert.match(src, /update\(JSON\.stringify\(\[BAKE_VERSION, GENERATOR_VERSION, /, 'the rev hashes the bake and generator versions')
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('no scene at all → a 30 × 20 m hall with tracks; no stage → hall only', async () => {
	const { json, glb } = await bakeScene(sceneInputs({}), 'none-x', { mvrStore: fakeStore(null, {}) })
	assert.equal(json.name, 'Empty arena')
	assert.deepEqual(json.floors.map((f) => f.id), ['hall'])
	const h = json.floors[0]
	assert.equal(h.rect[2] - h.rect[0], 30)
	assert.equal(h.rect[3] - h.rect[1], 20)
	assert.ok(json.tracks.length >= 2)
	for (const t of json.tracks) assert.ok(validateTrack(t, json).ok)
	assert.ok(json.stats.triangles > 0 && glb.length > 0, 'the floor slab is drawn')
	assert.equal(json.dropped.venueGlb, null)
	// a stage only (tracking grid, no MVR): stage deck + a hall of stage + 18 m all round; a 10 × 8 m deck holds no
	// stage-only lap with pads and boxes (< 20 m, 12 m of it start-line clearance), so the stage is driven by room tracks
	const s = await bakeScene(sceneInputs({ previs: { tracking: { grid: { width: 10, depth: 8, z_offset: 1 } } } }), 'none-y', { mvrStore: fakeStore(null, {}) })
	assert.deepEqual(s.json.floors.map((f) => f.id).sort(), ['hall', 'stage'])
	assert.deepEqual(s.json.floors.find((f) => f.id === 'hall').rect, [-23, -22, 23, 22])
	assert.ok(s.json.tracks.filter((t) => t.floor === 'room').length >= 3, s.json.tracks.map((t) => t.id).join())
	assert.ok(s.json.tracks.some((t) => t.floor === 'hall'))
	for (const t of s.json.tracks) assert.ok(validateTrack(t, s.json).ok)
})
