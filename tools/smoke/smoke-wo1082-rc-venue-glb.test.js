'use strict'

/**
 * WO-1082 — the game scene draws the project's venue .glb (project.previs.mvr.venue_glb, WO-1003) the way the previs
 * does (modules/rc-game/server/rc-scene-venue.js): an MVR object's .glb meshes replace its MVR parts (by the Capture
 * uuid), fixtures keep the MVR's, .glb-only objects are added on their Capture layer, layer colours never repaint a
 * .glb mesh, textures ride along (rc-scene-tex.js, shrunk) with their UVs, LINES become one line primitive, a flat
 * carpet is neither an obstacle nor the hall floor's height problem, and the rev follows the venue file.
 * Synthetic Capture-like .glb built here; the image encoder and the mean colour are injected (ffmpeg is tested apart).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { PNG } = require('pngjs')
const { writeGlb, readGlb } = require('../../src/stage/glb-write')
const M = require('../../modules/rc-game/server/rc-scene-mesh')
const V = require('../../modules/rc-game/server/rc-scene-venue')
const T = require('../../modules/rc-game/server/rc-scene-tex')
const O = require('../../modules/rc-game/server/rc-scene-occ')
const { bakeScene, createSceneBaker, sceneInputs } = require('../../modules/rc-game/server/rc-scene')

const ID = 'a1b2c3d4e5f6'
const boxXf = (s, c) => [s[0], 0, 0, 0, s[1], 0, 0, 0, s[2], c[0], c[1], c[2]]

function cubeGlb() {
	const pos = [],
		idx = []
	for (let i = 0; i < 8; i++) pos.push(i & 1 ? 0.5 : -0.5, i & 2 ? 0.5 : -0.5, i & 4 ? 0.5 : -0.5)
	for (const f of [
		[0, 2, 3, 1],
		[4, 5, 7, 6],
		[0, 1, 5, 4],
		[2, 6, 7, 3],
		[0, 4, 6, 2],
		[1, 3, 7, 5],
	])
		idx.push(f[0], f[1], f[2], f[0], f[2], f[3])
	return writeGlb([
		{
			name: 'cube',
			primitives: [{ positions: new Float32Array(pos), indices: new Uint32Array(idx), color: [0.5, 0.5, 0.5, 1] }],
		},
	])
}

/** An opaque RGB PNG (colour type 2: no alpha → the encoder writes JPEG). */
function png(w, h, rgb) {
	const p = new PNG({ width: w, height: h })
	for (let i = 0; i < w * h; i++) p.data.set([...rgb, 255], i * 4)
	return PNG.sync.write(p, { colorType: 2 })
}

/** A Capture-like venue .glb (frame = the MVR parts' frame): nodes carry CAPTURE_model identifiers and layer ids. */
function venueGlb() {
	const bins = []
	let off = 0
	const json = {
		asset: {
			version: '2.0',
			generator: 'Capture test',
			extensions: {
				CAPTURE_model: {
					layers: [
						{ identifier: 'L-DECOR', name: 'Decor' },
						{ identifier: 'L-HID', name: 'Hidden' },
					],
				},
			},
		},
		extensionsUsed: ['KHR_texture_transform', 'CAPTURE_model'],
		scene: 0,
		scenes: [{ nodes: [] }],
		nodes: [],
		meshes: [],
		accessors: [],
		bufferViews: [],
		buffers: [],
		materials: [],
		textures: [{ source: 0 }],
		images: [],
	}
	const view = (buf, target) => {
		json.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: buf.length, ...(target ? { target } : {}) })
		const pad = (4 - (buf.length % 4)) % 4
		bins.push(buf, Buffer.alloc(pad))
		off += buf.length + pad
		return json.bufferViews.length - 1
	}
	const acc = (arr, type, target) => {
		const typed = type === 'SCALAR' ? Uint32Array.from(arr) : Float32Array.from(arr)
		const n = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type]
		const a = {
			bufferView: view(Buffer.from(typed.buffer), target),
			componentType: type === 'SCALAR' ? 5125 : 5126,
			count: arr.length / n,
			type,
		}
		if (type === 'VEC3') {
			a.min = [0, 1, 2].map((k) => Math.min(...arr.filter((_, i) => i % 3 === k)))
			a.max = [0, 1, 2].map((k) => Math.max(...arr.filter((_, i) => i % 3 === k)))
		}
		json.accessors.push(a)
		return json.accessors.length - 1
	}
	json.images.push({ bufferView: view(png(8, 8, [200, 40, 40])), mimeType: 'image/png' })
	json.materials.push({
		name: 'Carpet',
		pbrMetallicRoughness: {
			baseColorFactor: [0.8, 0.8, 0.8, 1],
			baseColorTexture: { index: 0, extensions: { KHR_texture_transform: {} } },
		},
	})
	json.materials.push({ name: 'Wood', pbrMetallicRoughness: { baseColorFactor: [0.6, 0.4, 0.2, 1] } })
	const quad = (w, d) => [0, 0, 0, w, 0, 0, w, 0, d, 0, 0, d]
	const cube = []
	for (let i = 0; i < 8; i++) cube.push(i & 1 ? 0.5 : -0.5, i & 2 ? 0.5 : -0.5, i & 4 ? 0.5 : -0.5)
	const cubeIdx = []
	for (const f of [
		[0, 2, 3, 1],
		[4, 5, 7, 6],
		[0, 1, 5, 4],
		[2, 6, 7, 3],
		[0, 4, 6, 2],
		[1, 3, 7, 5],
	])
		cubeIdx.push(f[0], f[1], f[2], f[0], f[2], f[3])
	const mesh = (prims) => (json.meshes.push({ primitives: prims }), json.meshes.length - 1)
	const node = (n) => {
		json.nodes.push(n)
		json.scenes[0].nodes.push(json.nodes.length - 1)
		return json.nodes.length - 1
	}
	const cap = (identifier, layer) => ({
		extensions: { CAPTURE_model: { identifier, ...(layer ? { layer_identifier: layer } : {}) } },
	})
	// the carpet: a 30 × 20 m textured plane 1 cm above the floor (UVs tile 10 × 5)
	const carpet = mesh([
		{
			attributes: {
				POSITION: acc(quad(30, 20), 'VEC3', 34962),
				TEXCOORD_0: acc([0, 0, 10, 0, 10, 5, 0, 5], 'VEC2', 34962),
			},
			indices: acc([0, 2, 1, 0, 3, 2], 'SCALAR', 34963),
			material: 0,
			mode: 4,
		},
	])
	node({ mesh: carpet, translation: [-15, 0.01, -5], ...cap('CARPET') })
	// the MVR floor object, drawn by the .glb as a wood slab (10 cm)
	const slab = mesh([
		{ attributes: { POSITION: acc(cube, 'VEC3', 34962) }, indices: acc(cubeIdx, 'SCALAR', 34963), material: 1, mode: 4 },
	])
	node({ mesh: slab, translation: [0, -0.05, 5], scale: [40, 0.1, 30], ...cap('FLOOR') })
	// the fixture's .glb model (dropped: the MVR keeps its own) and a .glb-only table in "Decor" (a group gives the layer)
	node({ mesh: slab, translation: [0, 6, 10], scale: [0.3, 0.3, 0.3], ...cap('SPOT') })
	const table = node({ mesh: slab, translation: [0, 0.4, 0], scale: [1, 0.8, 1], ...cap('TABLE') })
	json.scenes[0].nodes.pop()
	node({ translation: [6, 0, 8], children: [table], ...cap('GROUP', 'L-DECOR') })
	// a .glb-only object on a hidden layer, and line work (LINES, no material)
	node({ mesh: slab, translation: [-6, 0.5, 8], ...cap('HIDDENX', 'L-HID') })
	const line = mesh([
		{ attributes: { POSITION: acc([0, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2.001, 0], 'VEC3', 34962) }, mode: 1 },
	])
	node({ mesh: line, translation: [3, 0, 3], ...cap('LINES', 'L-DECOR') })
	const bin = Buffer.concat(bins)
	json.buffers.push({ byteLength: bin.length })
	let js = Buffer.from(JSON.stringify(json))
	js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)])
	const head = Buffer.alloc(12)
	head.writeUInt32LE(0x46546c67, 0)
	head.writeUInt32LE(2, 4)
	head.writeUInt32LE(28 + js.length + bin.length, 8)
	const ch = (len, type) => {
		const b = Buffer.alloc(8)
		b.writeUInt32LE(len, 0)
		b.writeUInt32LE(type, 4)
		return b
	}
	return Buffer.concat([head, ch(js.length, 0x4e4f534a), js, ch(bin.length, 0x004e4942), bin])
}

const scene = () => ({
	name: 'Synthetic venue',
	objects: [
		{ uuid: 'FLOOR', layer: 'Venue', parts: [{ mesh: 'cube', xform: boxXf([40, 0.1, 30], [0, -0.05, 5]) }] },
		{ uuid: 'CARPET', layer: 'Carpet', parts: [{ mesh: 'cube', xform: boxXf([30, 0.001, 20], [0, 0.01, 5]) }] },
		{ uuid: 'leg', layer: 'Truss', parts: [{ mesh: 'cube', xform: boxXf([0.4, 5, 0.4], [-12, 2.5, 12]) }] },
		// a 1.5 × 1.5 m rug, 2 cm thick, on the carpet (flat decor: driven over) and a 10 cm step beside it (blocks)
		{ uuid: 'rug', layer: 'Decor', parts: [{ mesh: 'cube', xform: boxXf([1.5, 0.02, 1.5], [-6, 0.02, 0]) }] },
		{ uuid: 'step', layer: 'Decor', parts: [{ mesh: 'cube', xform: boxXf([1.5, 0.1, 1.5], [-6, 0.06, 4]) }] },
		// a thin plate rising 0 → 12 cm over 4 m (x 0 … 4 after place.x): floor where it is below 3 cm, an obstacle above
		{ uuid: 'slope', layer: 'Decor', parts: [{ mesh: 'cube', xform: [4, 0.12, 0, 0, 0.005, 0, 0, 0, 1.5, 0, 0.06, -6] }] },
		{
			uuid: 'SPOT',
			layer: 'Lights',
			fixture: true,
			parts: [{ mesh: 'cube', xform: boxXf([0.3, 0.3, 0.3], [0, 6, 10]) }],
		},
	],
})
const cfg = {
	id: ID,
	name: 'Synthetic',
	place: { x: 2, y: 0, z: 0, yaw: 0 },
	hidden_layers: ['Hidden'],
	layer_colors: { Carpet: '#ffffff', Venue: '#00ff00' },
	venue_glb: 'venue.glb',
}
const store = (calls = { mesh: 0 }) => ({
	calls,
	get: (id) => (id === ID ? { name: 'Synthetic venue', scene: scene() } : null),
	mesh: async (id, key) => (calls.mesh++, key === 'cube' ? cubeGlb() : null),
})
const fakeEncode = async (data, mime) => ({ data: Buffer.from(data), mime })
const meanColor = async () => [0.5, 0.1, 0.1]

function withVenue(fn) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-venue-'))
	const file = path.join(dir, 'venue.glb')
	fs.writeFileSync(file, venueGlb())
	return Promise.resolve(fn(file, dir)).finally(() => fs.rmSync(dir, { recursive: true, force: true }))
}

test('venueParts: MVR objects swap to their .glb meshes, fixtures keep the MVR, .glb-only objects join on their Capture layer', () => {
	const model = V.parseVenue(venueGlb())
	assert.ok(model.capture)
	const v = V.venueParts(scene(), cfg, model)
	const by = (u) => v.parts.filter((p) => p.uuid === u)
	assert.equal(v.swapped, 2, 'floor + carpet')
	assert.ok(
		by('floor').every((p) => p.key.startsWith(V.KEY) && p.color === null),
		'a .glb part is never repainted by a layer colour'
	)
	assert.ok(
		by('leg').every((p) => p.key === 'cube'),
		'no .glb mesh → the MVR part'
	)
	assert.ok(
		by('spot').every((p) => p.key === 'cube' && p.fixture),
		'a fixture keeps its MVR part'
	)
	assert.deepEqual(Object.keys(v.layers).sort(), ['Decor'], 'table + lines on Decor; the hidden-layer extra is left out')
	assert.equal(v.extra, 2)
	const table = by('table')[0]
	assert.deepEqual(
		table.xf.slice(9).map((x) => Math.round(x * 1000) / 1000),
		[8, 0.4, 8],
		'group + node transforms + place.x'
	)
	assert.equal(table.layer, 'Decor', 'layer from the parent group')
	assert.ok(model.hasLines(Number(by('lines')[0].key.slice(V.KEY.length))))
})

test('bakeScene with the venue: textured carpet, .glb-only table, line work, fixtures from the MVR; the carpet is no obstacle', async () => {
	await withVenue(async (file) => {
		const inp = sceneInputs({ name: 'P', previs: { mvr: cfg } })
		const { json, glb } = await bakeScene(inp, 'v1', {
			mvrStore: store(),
			venueFile: (n) => (n === 'venue.glb' ? file : null),
			encodeImage: fakeEncode,
			meanColor,
		})
		assert.equal(json.dropped.venueGlb, 'used')
		assert.equal(json.dropped.meshesFailed, 0)
		assert.deepEqual(
			{ swapped: json.venue.swapped, extra: json.venue.extra, textures: json.venue.textures },
			{ swapped: 2, extra: 2, textures: 1 }
		)
		assert.ok(json.venue.lineSegments >= 1)
		const { json: gj, bin } = readGlb(glb)
		const prims = gj.meshes[0].primitives
		const carpet = prims.find((p) => gj.materials[p.material].name === 'Carpet')
		assert.ok(
			carpet && carpet.attributes.TEXCOORD_0 != null && carpet.attributes.NORMAL == null,
			'the carpet keeps its UVs (flat shading)'
		)
		assert.equal(gj.textures[gj.materials[carpet.material].pbrMetallicRoughness.baseColorTexture.index].source, 0)
		assert.equal(gj.images[0].mimeType, 'image/png')
		assert.deepEqual(gj.samplers[0].wrapS, 10497, 'REPEAT: Capture tiles its floor textures')
		const pos = M.accessor(gj, bin, carpet.attributes.POSITION)
		assert.ok(
			pos[0] === -13 || pos[3] === -13 || Math.min(...pos.filter((_, i) => i % 3 === 0)) === -13,
			'placed: −15 + place.x 2'
		)
		const uv = M.accessor(gj, bin, carpet.attributes.TEXCOORD_0)
		assert.equal(Math.max(...uv), 10)
		const colors = prims
			.filter((p) => p.attributes.TEXCOORD_0 == null)
			.map((p) => gj.materials[p.material].pbrMetallicRoughness.baseColorFactor.slice(0, 3))
		assert.ok(
			!colors.some((c) => c[0] === 0 && c[1] === 1 && c[2] === 0),
			'the Venue layer colour (green) does not repaint the .glb floor'
		)
		assert.ok(
			colors.some((c) => Math.abs(c[0] - 0.6) < 0.02 && Math.abs(c[1] - 0.4) < 0.02),
			"the .glb's own wood colour"
		)
		assert.ok(
			prims.some((p) => p.mode === 1),
			'the line work is a LINES primitive'
		)
		assert.equal(json.dropped.fixtures, 0)
		// the wood slab's top (0) and the carpet (1 cm up) are one floor level; the carpet blocks nothing, the .glb-only table does
		const hall = json.floors.find((f) => f.id === 'hall')
		assert.ok(Math.abs(hall.y - 0.01) < 1e-6, `hall y ${hall.y}`)
		const s = json.scale || 1
		assert.ok(s === 1 && json.obstacles.length >= 1)
		const at = (x, z) => json.obstacles.some((o) => x >= o.min[0] && x <= o.max[0] && z >= o.min[2] && z <= o.max[2])
		assert.ok(
			at(7.6, 8) && at(8.6, 8),
			"the .glb-only table's sides are obstacles (the grid samples triangles: the box is hollow)"
		)
		assert.ok(at(-10, 12), 'the MVR truss leg is')
		assert.ok(!at(0, 0) && !at(-8, 0) && !at(14, 2), 'the carpet is not an obstacle anywhere')
	})
})

test('toy scale: the carpet leaves the occupancy grid empty; a missing / unreadable venue falls back to the MVR', async () => {
	await withVenue(async (file, dir) => {
		const inp = sceneInputs({ name: 'P', previs: { mvr: cfg } })
		const deps = { mvrStore: store(), venueFile: () => file, encodeImage: fakeEncode, meanColor, scale: 0.1 }
		const { json } = await bakeScene(inp, 'v2', deps)
		const g = O.fromJSON(json.occ[0])
		assert.ok(!g.blocked(0, 0) && !g.blocked(-8, 0) && !g.blocked(14, 2), 'carpet cells are free')
		assert.ok(g.blocked(7.52, 8) || g.blocked(7.48, 8), 'the table side is not')
		// rug −4.75 … −3.25 (x, after place.x), −0.75 … 0.75 (z): its edges and top lie within 3 cm (0.3 u) of the floor
		for (const [x, z] of [[-4.75, 0], [-3.25, 0], [-4, -0.75], [-4, 0.75], [-4, 0]]) assert.ok(!g.blocked(x, z), `flat rug (${x}, ${z}) is floor`)
		assert.ok(g.blocked(-4.75, 4) || g.blocked(-4.77, 4), 'the 10 cm step is an obstacle')
		// the band starts at 0.3 u: the low end of a sloped plate is floor even though the plate rises higher elsewhere
		for (const x of [0.2, 0.5]) assert.ok(!g.blocked(x, -6), `sloped plate below 3 cm (x ${x}) is floor`)
		for (const x of [1.4, 1.7]) assert.ok(g.blocked(x, -6), `sloped plate inside the band, 3 … 6 cm (x ${x}), blocks`)
		const bad = path.join(dir, 'bad.glb')
		fs.writeFileSync(bad, 'not a glb')
		assert.equal((await bakeScene(inp, 'v3', { ...deps, venueFile: () => bad })).json.dropped.venueGlb, 'unreadable')
		const miss = await bakeScene(inp, 'v4', { ...deps, venueFile: () => null })
		assert.equal(miss.json.dropped.venueGlb, 'missing')
		assert.equal(miss.json.venue, undefined)
	})
})

test('the rev follows the venue file (name, size, mtime) so a new export re-bakes', async () => {
	await withVenue(async (file, dir) => {
		let project = { name: 'P', previs: { mvr: cfg } }
		const recFile = path.join(dir, 'rec.json')
		fs.writeFileSync(recFile, '{}')
		const mk = () =>
			createSceneBaker({
				loadProject: () => project,
				mvrStore: { ...store(), fileOf: () => recFile },
				cacheDir: path.join(dir, 'c'),
				venueFile: () => file,
				now: (() => {
					let t = 0
					return () => (t += 5000)
				})(),
			})
		const r1 = mk().rev()
		fs.utimesSync(file, new Date(), new Date(Date.now() + 60000))
		const r2 = mk().rev()
		assert.notEqual(r1, r2, 'mtime changed → new rev')
		project = { name: 'P', previs: { mvr: { ...cfg, venue_glb: '' } } }
		assert.notEqual(mk().rev(), r2, 'venue removed → new rev')
		const src = fs.readFileSync(path.join(__dirname, '../../modules/rc-game/server/rc-scene.js'), 'utf8')
		assert.match(src, /inp\.venue, inp\.venueStat/, 'the rev hashes the venue name and its file stat')
	})
})

test('textures: shrunk to the budget (largest halved first), duplicates encoded once; heavy textured materials go flat', async () => {
	const seen = []
	const enc = async (data, mime, edge) => (seen.push(edge), { data: Buffer.alloc(edge * 10), mime: 'image/jpeg' })
	const a = { data: png(512, 512, [1, 2, 3]), mime: 'image/png' }
	const out = await T.shrinkImages([a, a, null, { data: png(256, 128, [9, 9, 9]), mime: 'image/png' }], {
		encode: enc,
		budget: 6000,
		maxEdge: 1024,
	})
	assert.equal(out[0].key, out[1].key, 'one encode for identical bytes')
	assert.equal(out[2], null)
	assert.equal(out[0].edge, 256, 'the largest was halved once')
	assert.ok(out[0].data.length + out[3].data.length <= 6000)
	assert.equal(out[3].edge, 256, 'the long edge is never upscaled')
	assert.deepEqual(seen, [512, 256, 256])
	assert.deepEqual((await T.shrinkImages([a], { encode: enc, budget: 10 }))[0], null, 'cannot fit → left out')
	const model = V.parseVenue(venueGlb())
	const parts = V.venueParts(scene(), cfg, model).parts
	const old = V.TEX_MAX_TRIS
	assert.ok(old >= 1000)
	const flat = await V.flattenHeavyTextures(
		{ ...model, trisByMaterial: () => new Map([[0, old + 1]]) },
		parts,
		meanColor
	)
	assert.deepEqual(flat, ['Carpet'])
	const t = model.template(0) // the carpet's mesh: now in its picture's mean colour × factor, no UVs
	assert.ok(t.prims.every((p) => !p.uv) && Math.abs(t.prims[0].color[0] - 0.4) < 1e-6)
})

test('ffmpeg encoder (when installed): a PNG comes back as a JPEG no larger than the asked edge; its mean colour', async (t) => {
	try {
		execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
	} catch {
		t.skip('ffmpeg not installed')
		return
	}
	const out = await T.ffmpegEncode(png(300, 100, [255, 0, 0]), 'image/png', 64)
	assert.ok(out && out.mime === 'image/jpeg' && out.data[0] === 0xff && out.data[1] === 0xd8)
	assert.ok(T.edgeOf(out.data) <= 64 && T.edgeOf(out.data) >= 60, `edge ${T.edgeOf(out.data)}`)
	const c = await T.ffmpegMeanColor({ data: png(16, 16, [255, 0, 0]), mime: 'image/png' })
	assert.ok(c[0] > 0.9 && c[1] < 0.05 && c[2] < 0.05, JSON.stringify(c))
})
