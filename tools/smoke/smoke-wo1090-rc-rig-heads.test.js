'use strict'

/**
 * WO-1090 — the patched heads in the game scene are their GDTF rigs, as the previs draws them (fixtures_3d.gd): the
 * rig's meshes (black fixture body where the model leaves the colour open) at pose_xform(pose) · node chain · mesh_xf,
 * the MVR object a head was patched from not drawn, one fixture's body within FIX_MAX_TRIS (decimated by clustering),
 * the heads' share of the budget after the room's own plan, and the moving parts in GLB nodes of their own
 * (userData rcHead / rcAxis) with the axes at rest in the scene JSON — the client turns them with the live beams
 * (head-follow.js solveHead). A head is drawn, never an obstacle nor in the height field (it hangs above the cars and
 * moves), so the room's tracks do not depend on the rig.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { writeGlb, readGlb } = require('../../src/stage/glb-write')
const M = require('../../modules/rc-game/server/rc-scene-mesh')
const O = require('../../modules/rc-game/server/rc-scene-occ')
const { bakeScene, sceneInputs } = require('../../modules/rc-game/server/rc-scene')
const { axesOf } = require('../../modules/rc-game/server/rc-scene-fixtures')

const ID = 'feed00001090'
const TYPE = 'abcdef012345'
const UUID = '1ae0accb-54f2-2c12-63d6-ad66bb39d5d7'

/** A UV sphere of `seg` × `seg` quads (radius r) — a dense head (2 × seg² triangles). */
function sphereGlb(r, seg, color) {
	const pos = [], idx = []
	for (let i = 0; i <= seg; i++) {
		for (let j = 0; j <= seg; j++) {
			const th = (i / seg) * Math.PI, ph = (j / seg) * 2 * Math.PI
			pos.push(r * Math.sin(th) * Math.cos(ph), r * Math.cos(th), r * Math.sin(th) * Math.sin(ph))
		}
	}
	for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) {
		const a = i * (seg + 1) + j, b = a + seg + 1
		idx.push(a, b, a + 1, b, b + 1, a + 1)
	}
	return writeGlb([{ name: 's', primitives: [{ positions: new Float32Array(pos), indices: new Uint32Array(idx), ...(color ? { color } : {}) }] }])
}
const cubeGlb = () => {
	const pos = [], idx = []
	for (let i = 0; i < 8; i++) pos.push(i & 1 ? 0.5 : -0.5, i & 2 ? 0.5 : -0.5, i & 4 ? 0.5 : -0.5)
	for (const f of [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]) idx.push(f[0], f[1], f[2], f[0], f[2], f[3])
	return writeGlb([{ name: 'cube', primitives: [{ positions: new Float32Array(pos), indices: new Uint32Array(idx), color: [0.4, 0.4, 0.4, 1] }] }])
}

// The rig as gdtf-store.js visual().rig gives it (Godot frame, metres): Base → Yoke (pan) → Head (tilt) → Lens (beam)
const I = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const rig = { mode: 'Std', nodes: [
	{ id: 'Base', kind: 'Geometry', parent: -1, xf: [...I, 0, 0, 0], mesh: 'models/gltf/base.glb' },
	{ id: 'Yoke', kind: 'Axis', parent: 0, axis: 'pan', xf: [...I, 0, -0.1, 0], mesh: 'models/gltf/yoke.glb' },
	{ id: 'Head', kind: 'Axis', parent: 1, axis: 'tilt', xf: [...I, 0, -0.25, 0], mesh: 'models/gltf/head.glb' },
	{ id: 'Lens', kind: 'Beam', parent: 2, xf: [...I, 0, -0.15, 0], beam: { beamType: 'Spot', beamAngle: 15 } },
], meshes: ['models/gltf/base.glb', 'models/gltf/yoke.glb', 'models/gltf/head.glb'] }
const models = { 'models/gltf/base.glb': sphereGlb(0.15, 12), 'models/gltf/yoke.glb': sphereGlb(0.1, 10), 'models/gltf/head.glb': sphereGlb(0.12, 48) }
const gdtf = { visual: (t, m) => (t === TYPE && m === 'Std' ? { rig } : null), member: async (t, f) => (t === TYPE ? models[f] || null : null), info: (t) => (t === TYPE ? {} : null) }

const W = 20, D = 20
const scene = { objects: [
	{ uuid: 'FLOOR', layer: 'Floor', parts: [{ mesh: 'cube', xform: [W, 0, 0, 0, 0.02, 0, 0, 0, D, 0, -0.01, 0] }] },
	// the MVR's own model of the patched head: a 1 m box at the head's place — replaced by the rig
	{ uuid: UUID.toUpperCase(), layer: 'Fronty', kind: 'Fixture', fixture: { spec: 'X.gdtf', mode: 'Std' }, parts: [{ mesh: 'fxbox', xform: [...I, 4, 1, -2] }] },
] }
const reads = []
const store = { get: (id) => (id === ID ? { name: 'Rig', scene } : null), mesh: async (id, key) => (reads.push(key), key === 'cube' || key === 'fxbox' ? cubeGlb() : null) }
// a head hanging LOW (its body 0.4–0.9 m above the floor): it must not block the floor's occupancy
const patch = [{ id: `mvr-${UUID}`, name: 'Focus Profile 1', typeId: TYPE, mode: 'Std', pose: { x: 4, y: 2, z: 0.9, hang: 'truss' }, enabled: true }]
// the type's previs colour (fixture_colors) tints the body as fixtures_3d.gd head_color does
const project = { name: 'Rig', fixtures: { patch }, previs: { mvr: { id: ID, name: 'Rig' }, fixture_colors: { [TYPE]: '#ff0000' } } }

let baked = null
const bake = () => (baked ||= bakeScene(sceneInputs(project), 'rig', { mvrStore: store, scale: 0.1, gdtf }))

test('the patch is part of the bake input (a moved head re-bakes)', () => {
	const inp = sceneInputs(project)
	assert.equal(inp.patch.length, 1)
	assert.deepEqual(Object.keys(inp.patch[0]).sort(), ['enabled', 'id', 'mode', 'pose', 'typeId'])
	assert.equal(inp.patch[0].pose.z, 0.9)
	assert.deepEqual(axesOf(rig.nodes), { pan: 1, tilt: 2 })
})

test('the rig replaces the MVR model; one head stays within FIX_MAX_TRIS (the 4608-triangle head decimated)', async () => {
	const { json, glb } = await bake()
	assert.ok(!reads.includes('fxbox'), 'the MVR object the head was patched from is not even read')
	assert.equal(json.rig.heads, 1)
	assert.equal(json.rig.drawn, 1)
	assert.equal(json.dropped.fixtures, 0)
	const raw = 2 * (12 * 12 + 10 * 10 + 48 * 48)
	assert.ok(raw > M.FIX_MAX_TRIS, 'the test head is over the budget as authored')
	assert.ok(json.rig.triangles > 0 && json.rig.triangles <= M.FIX_MAX_TRIS, `${json.rig.triangles} triangles`)
	const { json: g } = readGlb(glb)
	const rest = g.nodes.find((n) => n.name === 'rc-scene')
	const tint = g.materials.filter((m) => m.pbrMetallicRoughness.baseColorFactor.slice(0, 3).join() === '1,0,0')
	assert.ok(rest && tint.length, 'the body wears its type colour, not glb-write grey')
})

test('pan and tilt parts are GLB nodes of their own, the axes at rest in the JSON (pose_xform · chain)', async () => {
	const { json, glb } = await bake()
	const { json: g } = readGlb(glb)
	const heads = g.nodes.filter((n) => n.extras?.rcHead === `mvr-${UUID}`)
	assert.deepEqual(heads.map((n) => n.extras.rcAxis).sort(), ['pan', 'tilt'])
	const tris = (n) => g.meshes[n.mesh].primitives.reduce((s, p) => s + g.accessors[p.indices].count / 3, 0)
	assert.ok(heads.every((n) => tris(n) > 0))
	assert.equal(json.heads.length, 1)
	const h = json.heads[0]
	// pose (x, y, z) → Godot (x, z, −y): (4, 0.9, −2); yoke 0.1 below, head 0.35 below
	assert.deepEqual(h.pan, { o: [4, 0.8, -2], a: [0, 1, 0] })
	assert.deepEqual(h.tilt, { o: [4, 0.55, -2], a: [1, 0, 0] })
	assert.deepEqual(h.d, [0, -1, 0])
})

test('a head is drawn, not an obstacle: the floor under a low head stays free', async () => {
	const { json } = await bake()
	const g = O.fromJSON(json.occ.find((o) => o.floor === 'hall'))
	const free = (x, z) => g.bits[Math.floor((z - g.z0) / g.cell) * g.w + Math.floor((x - g.x0) / g.cell)] !== 1
	assert.ok(free(4, -2) && free(4.05, -2.05))
})

test('the heads get what the room left: a full room draws none, a short budget decimates', async () => {
	const parts = [0, 1, 2].map((i) => ({ key: `k${i}`, xf: [...I, i, 0, 0], uuid: `fx${i}`, fixture: true }))
	const tpl = () => {
		const { json, bin } = readGlb(sphereGlb(0.2, 30))
		const t = M.readTemplate(sphereGlb(0.2, 30))
		return json && bin && t
	}
	const templates = new Map(parts.map((p) => [p.key, tpl()]))
	const none = await M.planFixtures(parts, templates, { tris: 0, bytes: 0 })
	assert.equal(none.dropped, 3)
	const some = await M.planFixtures(parts, templates, { tris: 900, bytes: 1e9 })
	assert.ok(some.tris <= 900 && some.dropped === 0, JSON.stringify(some))
	assert.ok(some.cells.every((c) => c > 0.002), 'decimated')
})

test('the client turns the head nodes so their beam meets the streamed direction (head-follow.js)', async () => {
	const { solveHead, rotate } = await import('../../modules/rc-game/client/head-follow.js')
	const h = { pan: { o: [4, 0.8, -2], a: [0, 1, 0] }, tilt: { o: [4, 0.55, -2], a: [1, 0, 0] }, d: [0, -1, 0] }
	for (const [pan, tilt] of [[0.3, 0.6], [-2.5, 1.2], [3, -0.4], [0, 0]]) {
		const d = rotate(rotate(h.d, h.tilt.a, tilt), h.pan.a, pan)
		const s = solveHead(h, d, 0)
		const back = rotate(rotate(h.d, h.tilt.a, s.tilt), h.pan.a, s.pan)
		assert.ok(Math.hypot(back[0] - d[0], back[1] - d[1], back[2] - d[2]) < 1e-9, `${pan}, ${tilt}`)
	}
	const src = fs.readFileSync(path.join(__dirname, '../../modules/rc-game/client/stage-fx.js'), 'utf8')
	assert.match(src, /follow\.turn\(l\.id, l\.cur\.d\)/, 'stage-fx hands every smoothed beam to the head models')
	assert.match(src, /follow\.load\(s\.heads\)/)
})
