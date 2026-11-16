'use strict'

/**
 * WO-1104 — the "drape" stage object on the server: the geometry twin (src/stage/drape-geometry.js) gives the numbers
 * godot/client/tests/test_stage_drape_wo1104.gd pins for drape_geometry.gd; nothing on the save path drops a drape
 * (previs is a client-owned slice, stored verbatim); the MVR export writes it as a SceneObject with its pleats on a
 * "Drapes" layer that re-imports as scenery (never a screen); the games' bake draws its pleats (not a 1 m box), blocks
 * cars / soldiers where it stands and stays small.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const unzipper = require('unzipper')

const Drape = require('../../src/stage/drape-geometry')
const { buildStageMvr, godotMatrix } = require('../../src/stage/mvr-export')
const { readGlb } = require('../../src/stage/glb-write')
const store = require('../../src/stage/mvr-store')
const { preserveClientOwnedSlices } = require('../../src/engine/project-client-slices')
const G = require('../../modules/rc-game/server/rc-scene-geom')
const { drapeParts } = require('../../modules/rc-game/server/rc-scene-drape')
const { bakeScene, sceneInputs } = require('../../modules/rc-game/server/rc-scene')
const { fromJSON } = require('../../modules/rc-game/server/rc-scene-occ')

const near = (a, b, eps = 1e-5) => Math.abs(a - b) < eps
const SKIRT = { id: 'drape_1', type: 'drape', name: 'Dioda skirt', size_m: [15.1, 1], color: '#151515', fullness: 50, pleat_m: 0.2,
	position: [12.6, 0.239, 3.5], rotation: [0, -90, 0], visible: true }
const WALL = { id: 'led_wall_1', type: 'led_wall', name: 'Wall', panel_px: [128, 256], panel_mm: [500, 1000], panels: [30, 3], position: [12.7, 1.239, 3.5],
	rotation: [0, -90, 0], source: { role: 'pgm1', rect: { x: 0, y: 0, w: 3840, h: 768 } } }

test('twin numbers: the same seed, hash, amplitude and fold nodes as drape_geometry.gd', () => {
	const seed = Drape.seedOf('drape_1')
	assert.strictEqual(seed, 1142602941)
	assert.ok(near(Drape.hash01(seed, 0), 0.773661802, 1e-8) && near(Drape.hash01(seed, 7919), 0.598310251, 1e-8))
	assert.ok(near(Drape.amplitude(0.5, 0.25), 0.065505) && near(Drape.amplitude(1, 0.25), 0.103474))
	const nd = Drape.nodes({ id: 'drape_1', size_m: [15.1, 1], fullness: 60, pleat_m: 0.25 })
	assert.strictEqual(nd.length, 121)
	assert.ok(near(nd[0][0], -7.55) && near(nd[0][1], 0.065108) && near(nd[1][0], -7.413847) && near(nd[1][1], -0.071886))
	assert.deepStrictEqual(Drape.nodes({ id: 'x', fullness: 0, size_m: [4, 2] }), [[-2, 0], [2, 0]], 'fullness 0 = flat molton')
	const m = Drape.mesh(SKIRT, Drape.SAMPLES[1])
	assert.strictEqual(m.tris, (Drape.profile(SKIRT, Drape.SAMPLES[1]).length - 1) * 4)
	assert.strictEqual(m.positions.length / 3, Drape.profile(SKIRT, Drape.SAMPLES[1]).length * 3)
	assert.ok(Drape.mesh(SKIRT, Drape.SAMPLES[3]).tris < 8000, 'a 15 m skirt at Ultra < 8k triangles')
})

test('save path: previs is client-owned and stored verbatim — a drape survives a web save that omits previs', () => {
	const existing = { name: 'Show', previs: { stage: { version: 1, objects: [WALL, SKIRT] } } }
	const incoming = { name: 'Show', scenes: [] }
	assert.deepStrictEqual(preserveClientOwnedSlices(incoming, existing), ['previs'])
	assert.deepStrictEqual(incoming.previs.stage.objects[1], SKIRT)
})

test('MVR export: a drape is a SceneObject on a "Drapes" layer with its pleats; re-imports as scenery, not a screen', async () => {
	const { buffer, report } = buildStageMvr([WALL, SKIRT], { name: 'Show' })
	assert.deepStrictEqual(report, { screens: 1, drapes: 1, skipped: 0, roles: ['pgm1'] })
	const dir = await unzipper.Open.buffer(buffer)
	const files = {}
	for (const f of dir.files) files[f.path] = await f.buffer()
	const xml = files['GeneralSceneDescription.xml'].toString()
	assert.match(xml, /<Layer name="Drapes" uuid="[0-9A-F-]{36}">\s*<ChildList>\s*<SceneObject name="Dioda skirt"/)
	assert.doesNotMatch(xml, /<VideoScreen name="Dioda skirt"/)
	const { json } = readGlb(files['drape_1.glb'])
	const mat = json.materials[json.meshes[0].primitives[0].material]
	assert.strictEqual(mat.name, 'drape')
	assert.strictEqual(mat.doubleSided, true)
	assert.ok(json.meshes[0].primitives[0].attributes.NORMAL != null, 'shaded with its own normals')
	const rec = await store.importMvr(buffer, 'drape-roundtrip.mvr')
	try {
		const back = rec.scene.objects.find((o) => o.name === 'Dioda skirt')
		assert.ok(back)
		assert.strictEqual(back.kind, 'SceneObject')
		assert.strictEqual(back.layer, 'Drapes')
		assert.strictEqual(back.screen, undefined, 'no screen binding')
		const g = godotMatrix(SKIRT)
		const want = [g[0], g[1], g[2], g[4], g[5], g[6], g[8], g[9], g[10], g[12], g[13], g[14]]
		back.parts[0].xform.forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 1e-4, `xform[${i}] ${v} vs ${want[i]}`))
		assert.ok(await store.mesh(rec.id, back.parts[0].mesh), 'mesh served')
	} finally {
		store.remove(rec.id)
	}
})

test('bake parts: a drape is its pleats in its colour (not a box); hidden / other types are not drapes', () => {
	assert.deepStrictEqual(G.stageObjectBoxes([SKIRT]), [], 'no 1 × 1 m box any more')
	assert.strictEqual(G.stageObjectBoxes([WALL]).length, 2, 'a wall is still a cabinet + picture')
	const { templates, parts } = drapeParts([WALL, SKIRT, { ...SKIRT, id: 'h', visible: false }])
	assert.strictEqual(parts.length, 1)
	const t = templates.get(parts[0].key)
	assert.ok(t.exact && t.tris === Drape.mesh(SKIRT, Drape.SAMPLES[0]).tris)
	assert.ok(near(t.bounds.min[0], -7.55) && near(t.bounds.max[1], 1))
	assert.ok(parts[0].color.slice(0, 3).every((c) => c >= 0.012 && c < 0.02), 'black, lifted a little for the game lights')
	const p = G.apply(parts[0].xf, 0, 0.5, 0)
	assert.ok(near(p[0], 12.6) && near(p[1], 0.739) && near(p[2], 3.5), 'placed like the previs')
})

test('bake: the drape is drawn and blocks the floor where it stands (v2 obstacles and the toy occupancy)', async () => {
	const d = { id: 'drape_9', type: 'drape', name: 'Backdrop', size_m: [6, 1.5], color: '#151515', fullness: 60, pleat_m: 0.25, position: [0, 0, 0], rotation: [0, 0, 0] }
	const fake = { get: () => null, mesh: async () => null, fileOf: () => null }
	const plain = await bakeScene(sceneInputs({}), 'none-p', { mvrStore: fake })
	const v2 = await bakeScene(sceneInputs({ previs: { stage: { objects: [d] } } }), 'none-d', { mvrStore: fake })
	const drapeTris = Drape.mesh(d, Drape.SAMPLES[0]).tris
	assert.strictEqual(v2.json.stats.triangles - plain.json.stats.triangles, drapeTris, 'its pleats are drawn, nothing else added')
	assert.ok(v2.json.obstacles.some((o) => o.min[0] <= 0 && o.max[0] >= 0 && o.min[2] <= 0.05 && o.max[2] >= -0.05), 'an obstacle where it stands')
	const toy = await bakeScene(sceneInputs({ previs: { stage: { objects: [d] } } }), 'none-t', { mvrStore: fake, scale: 0.1 })
	const occ = fromJSON(toy.json.occ[0])
	for (const x of [-2.5, -1, 0, 1, 2.5]) {
		let blocked = false
		for (let z = -0.1; z <= 0.1; z += 0.01) blocked = blocked || occ.blocked(x, z)
		assert.ok(blocked, `a car cannot pass the drape at x ${x}`)
	}
	assert.ok(!occ.blocked(0, 2) && !occ.blocked(0, -2), 'free floor in front of and behind it')
})
