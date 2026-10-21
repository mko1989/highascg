'use strict'

/**
 * WO-612 T7 — the WO-614 stage exported as MVR (src/stage/mvr-export.js, GET /api/stage/mvr-export): one VideoScreen
 * per object with a generated GLB, its role as a CaptureDevice source and its crop as a Mapping. The round trip goes
 * through the real importer (store.importMvr, projects/_mvr test-isolated): every object comes back where it was.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const unzipper = require('unzipper')

const { buildStageMvr, godotMatrix, sizeM } = require('../../src/stage/mvr-export')
const { readGlb } = require('../../src/stage/glb-write')
const store = require('../../src/stage/mvr-store')
const { handleExport } = require('../../src/api/routes-stage-mvr')

const OBJECTS = [
	{ id: 'led_wall_1', type: 'led_wall', name: 'Main <LED>', panel_px: [192, 192], panel_mm: [500, 500], panels: [10, 6], curve_deg: 5, depth_m: 0.08,
		position: [1, 2, -7], rotation: [0, 30, 0], source: { role: 'pgm1', rect: { x: 0, y: 0, w: 1920, h: 1152 } } },
	{ id: 'tv_1', type: 'tv', name: 'TV L', diagonal_in: 65, aspect: [16, 9], portrait: true, bezel_mm: 10, depth_m: 0.06,
		position: [-4, 1.2, -3], rotation: [10, -20, 5], source: { role: 'pgm1', rect: { x: 1920, y: 0, w: 1080, h: 1920 } } },
	{ id: 'projection_1', type: 'projection', name: 'IMAG', screen_m: [4, 2.25], throw: 1.5, position: [6, 1, -5], rotation: [0, 0, 0],
		source: { role: 'opgui', rect: { x: 0, y: 0, w: 1920, h: 1080 } } },
	{ id: 'hidden', type: 'tv', visible: false },
	{ id: 'odd', type: 'camera' },
]

async function members(buf) {
	const dir = await unzipper.Open.buffer(buf)
	const out = {}
	for (const f of dir.files) out[f.path] = await f.buffer()
	return out
}

test('export: archive layout, sources, crops, mapping definitions', async () => {
	const { buffer, report } = buildStageMvr(OBJECTS, { name: 'Show', rasterFor: (role) => (role === 'pgm1' ? { w: 3840, h: 2160 } : null) })
	assert.deepStrictEqual(report, { screens: 3, skipped: 1, roles: ['pgm1', 'opgui'] })
	const files = await members(buffer)
	assert.deepStrictEqual(Object.keys(files).sort(), ['GeneralSceneDescription.xml', 'led_wall_1.glb', 'projection_1.glb', 'tv_1.glb'])
	const xml = files['GeneralSceneDescription.xml'].toString()
	assert.match(xml, /verMajor="1" verMinor="6"/)
	assert.match(xml, /name="Main &lt;LED&gt;"/)
	assert.match(xml, /<SizeX>3840<\/SizeX><SizeY>2160<\/SizeY>/, 'pgm1 uses the live raster')
	assert.match(xml, /<SizeX>1920<\/SizeX><SizeY>1080<\/SizeY>/, 'opgui falls back to the crops bounding box')
	assert.match(xml, /type="CaptureDevice">highascg:pgm1<\/Source>/)
	assert.match(xml, /<ux>1920<\/ux><uy>0<\/uy><ox>1080<\/ox><oy>1920<\/oy>/)
	for (const f of ['led_wall_1.glb', 'tv_1.glb', 'projection_1.glb']) assert.ok(readGlb(files[f]).json.meshes.length === 1, f)
	assert.strictEqual(buildStageMvr(OBJECTS).buffer.equals(buildStageMvr(OBJECTS).buffer), true, 'deterministic (stable uuids)')
})

test('round trip through the importer: every object comes back at its Godot transform', async () => {
	const { buffer } = buildStageMvr(OBJECTS)
	const rec = await store.importMvr(buffer, 'roundtrip.mvr')
	try {
		const objs = rec.scene.objects
		assert.strictEqual(objs.length, 3)
		for (const o of OBJECTS.slice(0, 3)) {
			const back = objs.find((x) => x.name === o.name)
			assert.ok(back, o.name)
			assert.strictEqual(back.kind, 'VideoScreen')
			assert.deepStrictEqual(back.sources, [{ type: 'CaptureDevice', linkedGeometry: o.id, value: `highascg:${o.source.role}` }])
			const g = godotMatrix(o)
			const want = [g[0], g[1], g[2], g[4], g[5], g[6], g[8], g[9], g[10], g[12], g[13], g[14]]
			back.parts[0].xform.forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 1e-4, `${o.id}[${i}] ${v} vs ${want[i]}`))
			assert.ok(await store.mesh(rec.id, back.parts[0].mesh), 'mesh served')
		}
	} finally {
		store.remove(rec.id)
	}
})

test('geometry sizes follow stage_objects.gd', () => {
	assert.deepStrictEqual(sizeM(OBJECTS[0]), [5, 3])
	const [w, h] = sizeM(OBJECTS[1])
	assert.ok(h > w && Math.abs(Math.hypot(w, h) - 65 * 0.0254) < 1e-9, 'portrait TV keeps its diagonal')
})

test('GET /api/stage/mvr-export: download headers; an empty stage is a 404 with a reason', () => {
	const ok = handleExport({ config: {} }, { loadProject: () => ({ name: 'My Show', previs: { stage: { objects: OBJECTS } } }) })
	assert.strictEqual(ok.status, 200)
	assert.strictEqual(ok.headers['Content-Disposition'], 'attachment; filename="My_Show.mvr"')
	assert.strictEqual(ok.headers['X-MVR-Screens'], '3')
	assert.ok(Buffer.isBuffer(ok.body))
	const empty = handleExport({ config: {} }, { loadProject: () => ({ previs: {} }) })
	assert.strictEqual(empty.status, 404)
	assert.match(JSON.parse(empty.body).error, /stage is empty/)
})
