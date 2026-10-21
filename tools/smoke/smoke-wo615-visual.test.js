'use strict'

/**
 * WO-615 T5 — what the previs draws of a GDTF fixture: gdtf-rig.js (the mode's geometry with GeometryReference
 * instanced, Godot-frame transforms, pan / tilt axes marked, box meshes sized) and gdtf-visual.js (DMX → axis
 * degrees honouring mode masters, beam intensity / colour / zoom with ancestor scope), the engine's frameOf, the
 * store cache and the /rig + /model routes. Fixture: tools/fixtures/gdtf/test-spot.xml (synthetic).
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { zipStored } = require('./lib/zip-stored')
const { parseDescription } = require('../../src/fixtures/gdtf-parse')
const { buildRig, conj } = require('../../src/fixtures/gdtf-rig')
const { compileVisual, decodeVisual, cieToRgb } = require('../../src/fixtures/gdtf-visual')
const { applyType, writeGdtf } = require('../../src/fixtures/gdtf-patch')
const { FollowEngine } = require('../../src/fixtures/follow-engine')
const store = require('../../src/fixtures/gdtf-store')
const { RouteRegistry } = require('../../src/api/route-registry')
const { register } = require('../../src/api/routes-fixture-types')

const XML = fs.readFileSync(path.join(__dirname, '../fixtures/gdtf/test-spot.xml'), 'utf8')
let _type = null
async function type() {
	if (!_type) _type = await parseDescription(XML, ['description.xml'])
	return _type
}
async function planOf(name) {
	const t = await type()
	const m = t.modes.find((x) => x.name === name)
	return { t, m, rig: buildRig(t, m), plan: compileVisual(t, m, buildRig(t, m)) }
}
function frame(m, values, address = 1) {
	const buf = new Uint8Array(512)
	writeGdtf(buf, applyType({ address, pan: {}, tilt: {} }, m), values)
	return buf
}

test('rig: mode geometry flattened parent-first, axes marked, GDTF Z-up → Godot Y-up', async () => {
	const { rig } = await planOf('Standard')
	assert.deepStrictEqual(
		rig.nodes.map((n) => [n.id, n.parent, n.kind, n.axis || '']),
		[
			['Base', -1, 'Geometry', ''],
			['Yoke', 0, 'Axis', 'pan'],
			['Head', 1, 'Axis', 'tilt'],
			['Beam', 2, 'Beam', ''],
		]
	)
	assert.deepStrictEqual(rig.nodes[1].xf.slice(9), [0, 0.2, 0], 'GDTF z +0.2 → Godot y +0.2')
	assert.strictEqual(rig.nodes[3].beam.beamAngle, 18)
	assert.strictEqual(rig.nodes[0].mesh, 'prim:box', 'no archive file → a box of the model size')
	assert.deepStrictEqual(rig.nodes[0].mesh_xf.slice(0, 9), [0.4, 0, 0, 0, 0.2, 0, 0, 0, 0.3], 'L×W×H → Godot x, y(H), z(W)')
	assert.deepStrictEqual(rig.meshes, [])
	// A rotation about GDTF Z is the same rotation about Godot Y.
	const c = Math.cos(0.5)
	const s = Math.sin(0.5)
	const g = conj([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
	assert.deepStrictEqual(g.slice(0, 9).map((v) => Math.round(v * 1e4) / 1e4),
		[c, 0, -s, 0, 1, 0, s, 0, c].map((v) => Math.round(v * 1e4) / 1e4))
})

test('rig: GeometryReference instanced under the reference name; a file model is a mesh', async () => {
	const t = await type()
	const withFile = { ...t, files: ['description.xml', 'models/gltf/base.glb'] }
	const rig = buildRig(withFile, t.modes.find((m) => m.name === 'Pixels'))
	assert.deepStrictEqual(rig.nodes.map((n) => [n.id, n.parent, n.kind]), [
		['Bar', -1, 'Geometry'],
		['Pixel 1', 0, 'Beam'],
		['Pixel 2', 0, 'Beam'],
		['Pixel 3', 0, 'Beam'],
	])
	assert.deepStrictEqual(rig.nodes[1].xf.slice(9), [-0.1, 0, 0])
	assert.strictEqual(rig.nodes[0].mesh, 'models/gltf/base.glb')
	assert.deepStrictEqual(rig.meshes, ['models/gltf/base.glb'])
})

test('decode: defaults dark, dimmer + wheel colour, pan degrees, mode master picks the function', async () => {
	const { m, plan } = await planOf('Standard')
	const dark = decodeVisual(plan, frame(m, null))
	assert.deepStrictEqual(dark.beams.Beam, { i: 0, c: [1, 1, 1], zoom: 18 }, 'dimmer default 0; no zoom channel → BeamAngle')
	const red = decodeVisual(plan, frame(m, { Dimmer: 1, Color1: { set: 'Red' }, Pan: 90, Tilt: 45 }, 20), 20)
	assert.strictEqual(red.beams.Beam.i, 1)
	assert.deepStrictEqual(red.beams.Beam.c.map((v) => Math.round(v * 10) / 10), [1, 0, 0])
	assert.strictEqual(Math.round(red.axes.Yoke), 90)
	assert.strictEqual(Math.round(red.axes.Head), 45)
	const raw = (panMode) => decodeVisual(plan, frame(m, { Pan: { dmx: 49152 }, PanMode: { dmx: panMode } })).axes.Yoke
	assert.strictEqual(Math.round(raw(0)), 135, 'PanMode 0 → "Pan" ±270')
	assert.strictEqual(Math.round(raw(1)), 90, 'PanMode 1 → "Pan 360" ±180')
	assert.strictEqual(raw(200), undefined, 'no function under that master value')
})

test('decode: pixels — bar dimmer × the cell’s own colour (ancestor scope)', async () => {
	const { m, plan } = await planOf('Pixels')
	const v = decodeVisual(plan, frame(m, { Dimmer: 1, 'Pixel 2/ColorAdd_R': 0.5 }))
	assert.deepStrictEqual(v.beams['Pixel 1'], { i: 0, c: [0, 0, 0], zoom: 60 })
	assert.strictEqual(v.beams['Pixel 2'].i, 0.502)
	assert.deepStrictEqual(v.beams['Pixel 2'].c, [1, 0, 0])
	const off = decodeVisual(plan, frame(m, { Dimmer: 0, ColorAdd_R: 1 }))
	assert.ok(Object.values(off.beams).every((b) => b.i === 0), 'bar master at 0 darkens every cell')
})

test('decode: a Closed shutter set darkens, subtractive CMY filters, zoom physical; CIE white ≈ white', () => {
	const fn = (attribute, extra = {}) => ({ name: attribute, attribute, from: 0, to: 255, physFrom: 0, physTo: 1, sets: [],
		modeMaster: '', ...extra })
	const ch = (offset, f, geometry = 'B') => ({ name: `${geometry}_${f.attribute}`, geometry, offsets: [offset], res: 1,
		default: 0, functions: [f] })
	const channels = [
		ch(1, fn('Dimmer')),
		ch(2, fn('Shutter1', { sets: [{ name: 'Closed', from: 0, to: 9 }, { name: 'Open', from: 10, to: 255 }] })),
		ch(3, fn('ColorSub_C')),
		ch(4, fn('Zoom', { physFrom: 10, physTo: 50 }), 'Head'),
	]
	const rig = { nodes: [{ id: 'Head', parent: -1, kind: 'Axis' }, { id: 'B', parent: 0, kind: 'Beam', beam: { beamAngle: 25 } }] }
	const plan = compileVisual({ wheels: {} }, { channels }, rig)
	const buf = new Uint8Array(512)
	buf.set([255, 255, 255, 255])
	assert.deepStrictEqual(decodeVisual(plan, buf).beams.B, { i: 1, c: [0, 1, 1], zoom: 50 })
	buf[1] = 5
	assert.strictEqual(decodeVisual(plan, buf).beams.B.i, 0, 'shutter on "Closed"')
	assert.ok(cieToRgb([0.3127, 0.329]).every((v) => v > 0.98), 'D65 → white')
})

test('engine frameOf + store visual: what the WS tracking:fixtures decodes', async () => {
	const t = await type()
	const TYPE = 'bbbbbbbbbbbb'
	const e = new FollowEngine({ hub: { list: () => [], now: () => 0 }, send: () => {},
		resolveMode: (id, name) => (id === TYPE ? t.modes.find((x) => x.name === name) : null) })
	e.configure({ patch: [{ id: 'spot', typeId: TYPE, mode: 'Standard', protocol: 'sacn', universe: 3, address: 11 }] })
	e.program(['spot'], { Dimmer: 0.5 })
	e.tick()
	const fx = e.fixtures[0]
	const buf = e.frameOf(fx)
	assert.strictEqual(buf[10 + 5], 128, 'dimmer at address 11 + offset 6')
	const { plan } = await planOf('Standard')
	assert.strictEqual(Math.round(decodeVisual(plan, buf, fx.address).beams.Beam.i * 10) / 10, 0.5)
	assert.strictEqual(e.frameOf({ ...fx, to: null }), null)
})

test('routes: /rig and /model (glb served, junk paths refused); store visual is cached and cleared on remove', async () => {
	const glb = Buffer.from('glTF-test')
	const s = await store.importGdtf(zipStored({ 'description.xml': XML, 'models/gltf/base.glb': glb }), 'T@S.gdtf')
	const routes = new RouteRegistry()
	register(routes)
	const get = (p, query = {}) => routes.dispatch('GET', p, '', {}, undefined, query)
	const rig = await get(`/api/fixtures/types/${s.id}/rig`, { mode: 'Standard' })
	assert.strictEqual(rig.status, 200)
	assert.deepStrictEqual(JSON.parse(rig.body).meshes, ['models/gltf/base.glb'])
	assert.strictEqual((await get(`/api/fixtures/types/${s.id}/rig`, { mode: 'x' })).status, 404)
	const model = await get(`/api/fixtures/types/${s.id}/model`, { path: 'models/gltf/base.glb' })
	assert.strictEqual(model.status, 200)
	assert.strictEqual(model.headers['Content-Type'], 'model/gltf-binary')
	assert.deepStrictEqual(model.body, glb)
	assert.strictEqual((await get(`/api/fixtures/types/${s.id}/model`, { path: 'description.xml' })).status, 400)
	assert.strictEqual((await get(`/api/fixtures/types/${s.id}/model`, { path: 'models/3ds/none.3ds' })).status, 404)
	assert.strictEqual(store.visual(s.id, 'Standard'), store.visual(s.id, 'Standard'), 'cached')
	assert.ok(store.remove(s.id))
	assert.strictEqual(store.visual(s.id, 'Standard'), null)
})
