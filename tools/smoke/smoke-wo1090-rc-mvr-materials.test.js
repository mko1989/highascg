'use strict'

/**
 * WO-1090 — MVR-archive meshes keep their own materials in the game scene (owner 16.11: "in the game the textures for
 * carpet and focus heads load generic look instead of the one that is already in previs"). Hilton Wawer's room skins
 * are .glb files inside the MVR: a JPEG tiled over UVs in world metres (REPEAT; the carpet quad is 30 × 62 m with a
 * 4 m tile), emission on curtains / ceiling, one-sided walls facing in, double-sided chandeliers. Before, the bake read
 * every MVR mesh as positions + base colour (rc-scene-mesh.js readTemplate) and wrote a flat grey room. Now a mesh
 * with pictures or glow is read with its materials (rc-scene-rich.js) and the venue's texture rules (budget, mean
 * colour when a picture is left out) apply to it too.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { writeGlb, readGlb } = require('../../src/stage/glb-write')
const { accessor } = require('../../modules/rc-game/server/rc-scene-mesh')
const { bakeScene, sceneInputs } = require('../../modules/rc-game/server/rc-scene')
const { isRich } = require('../../modules/rc-game/server/rc-scene-rich')

const ID = 'c0ffee000090'
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 7), Buffer.from([0xff, 0xd9])])
const GLOW = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 9), Buffer.from([0xff, 0xd9])])
const TILE = 4

/** A GLB with images and full materials: meshes [{ positions, uvs, indices, material }], materials (glTF), images. */
function richGlb(meshes, materials, images) {
	const chunks = []
	let off = 0
	const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [],
		materials, textures: images.map((_, i) => ({ sampler: 0, source: i })), samplers: [{ wrapS: 10497, wrapT: 10497 }], images: [] }
	const view = (buf) => {
		json.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: buf.length })
		const pad = Buffer.alloc((4 - (buf.length % 4)) % 4)
		chunks.push(buf, pad)
		off += buf.length + pad.length
		return json.bufferViews.length - 1
	}
	const acc = (typed, type, extra = {}) => {
		json.accessors.push({ bufferView: view(Buffer.from(typed.buffer)), componentType: typed instanceof Float32Array ? 5126 : 5125, count: typed.length / { VEC3: 3, VEC2: 2, SCALAR: 1 }[type], type, ...extra })
		return json.accessors.length - 1
	}
	for (const im of images) json.images.push({ bufferView: view(im), mimeType: 'image/jpeg' })
	for (const m of meshes) {
		const min = [0, 1, 2].map((k) => Math.min(...m.positions.filter((_, i) => i % 3 === k)))
		const max = [0, 1, 2].map((k) => Math.max(...m.positions.filter((_, i) => i % 3 === k)))
		const attributes = { POSITION: acc(m.positions, 'VEC3', { min, max }), TEXCOORD_0: acc(m.uvs, 'VEC2') }
		json.meshes.push({ primitives: [{ attributes, indices: acc(m.indices, 'SCALAR'), material: m.material }] })
		json.nodes.push({ mesh: json.meshes.length - 1 })
		json.scenes[0].nodes.push(json.nodes.length - 1)
	}
	json.buffers.push({ byteLength: off })
	let js = Buffer.from(JSON.stringify(json))
	js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)])
	const bin = Buffer.concat(chunks)
	const head = Buffer.alloc(12)
	head.writeUInt32LE(0x46546c67, 0)
	head.writeUInt32LE(2, 4)
	head.writeUInt32LE(28 + js.length + bin.length, 8)
	const ch = (n, t) => Buffer.from(new Uint32Array([n, t]).buffer)
	return Buffer.concat([head, ch(js.length, 0x4e4f534a), js, ch(bin.length, 0x004e4942), bin])
}

/** The carpet: one 30 × 62 m quad on y = 0, UVs in world metres / TILE (so −3.75 … 3.75 × −7.75 … 7.75). */
const carpetGlb = () => {
	const W = 30, D = 62
	const positions = new Float32Array([-W / 2, 0, -D / 2, W / 2, 0, -D / 2, W / 2, 0, D / 2, -W / 2, 0, D / 2])
	const uvs = new Float32Array([-W / 2 / TILE, -D / 2 / TILE, W / 2 / TILE, -D / 2 / TILE, W / 2 / TILE, D / 2 / TILE, -W / 2 / TILE, D / 2 / TILE])
	return richGlb([{ positions, uvs, indices: new Uint32Array([0, 2, 1, 0, 3, 2]), material: 0 }],
		[{ name: 'carpet', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 } }], [JPEG])
}

/** A curtain (one-sided, glowing through its own picture) and a chandelier pendant (double-sided, glowing). */
const skinsGlb = () => {
	const q = (x0, x1, y0, y1, z) => new Float32Array([x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z])
	const uv = new Float32Array([0, 0, 6, 0, 6, 2, 0, 2])
	return richGlb([
		{ positions: q(-10, 10, 0.5, 5.5, -29), uvs: uv, indices: new Uint32Array([0, 1, 2, 0, 2, 3]), material: 0 },
		{ positions: q(-1, 1, 4, 5, 0), uvs: uv, indices: new Uint32Array([0, 1, 2, 0, 2, 3]), material: 1 },
	], [
		{ name: 'curtain', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.9 }, emissiveTexture: { index: 0 }, emissiveFactor: [0.15, 0.15, 0.15] },
		{ name: 'crystal', doubleSided: true, pbrMetallicRoughness: { baseColorTexture: { index: 1 }, baseColorFactor: [1, 0.9, 0.8, 1], metallicFactor: 0, roughnessFactor: 0.3 },
			emissiveTexture: { index: 1 }, emissiveFactor: [0.7, 0.7, 0.7] },
	], [JPEG, GLOW])
}

const cubeGlb = () => {
	const pos = [], idx = []
	for (let i = 0; i < 8; i++) pos.push(i & 1 ? 0.5 : -0.5, i & 2 ? 0.5 : -0.5, i & 4 ? 0.5 : -0.5)
	for (const f of [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]) idx.push(f[0], f[1], f[2], f[0], f[2], f[3])
	return writeGlb([{ name: 'cube', primitives: [{ positions: new Float32Array(pos), indices: new Uint32Array(idx), color: [0.3, 0.3, 0.32, 1] }] }])
}

const I = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const scene = {
	objects: [
		{ uuid: 'DYWAN', layer: 'Dywan', parts: [{ mesh: 'mvr:skin_dywan.glb', xform: [...I, 0, 0.24, 0] }] },
		{ uuid: 'SKINS', layer: 'Zasłony', parts: [{ mesh: 'mvr:skins.glb', xform: [...I, 0, 0.24, 0] }] },
		{ uuid: 'STAGE', layer: 'Scena', parts: [{ mesh: 'mvr:scena.glb', xform: [3, 0, 0, 0, 0.4, 0, 0, 0, 15, 11, 0.44, 3.5] }] },
	],
}
const files = { 'mvr:skin_dywan.glb': carpetGlb(), 'mvr:skins.glb': skinsGlb(), 'mvr:scena.glb': cubeGlb() }
const store = { get: (id) => (id === ID ? { name: 'Hilton-like', scene } : null), mesh: async (id, key) => files[key] || null }
const project = { name: 'Rich', previs: { mvr: { id: ID, name: 'Hilton-like' }, tracking: { grid: { width: 3, depth: 15, x_offset: 11, y_offset: -3.5, z_offset: 0.64 } } } }
const encodeImage = async (data, mime) => ({ data, mime }) // smokes never spawn ffmpeg
const meanColor = async () => [0.5, 0.25, 0.1]

function glbOf(buf) {
	const { json, bin } = readGlb(buf)
	const prims = json.meshes.flatMap((m) => m.primitives)
	const byName = (name) => {
		const mi = json.materials.findIndex((m) => m.name === name)
		return { mat: json.materials[mi], prim: prims.find((p) => p.material === mi) }
	}
	return { json, bin, byName }
}

test('a rich MVR mesh is told from a flat one', () => {
	assert.equal(isRich(carpetGlb()), true)
	assert.equal(isRich(skinsGlb()), true)
	assert.equal(isRich(cubeGlb()), false)
})

test('the carpet keeps its picture, REPEAT wrap and its tiling UVs (≫ 1, not clamped, not atlased)', async () => {
	const { json, glb } = await bakeScene(sceneInputs(project), 'rich', { mvrStore: store, scale: 0.1, encodeImage, meanColor })
	const g = glbOf(glb)
	const { mat, prim } = g.byName('carpet')
	assert.ok(mat?.pbrMetallicRoughness.baseColorTexture, 'the carpet has its base colour texture')
	const tex = g.json.textures[mat.pbrMetallicRoughness.baseColorTexture.index]
	assert.equal(g.json.samplers[tex.sampler].wrapS, 10497)
	assert.equal(g.json.samplers[tex.sampler].wrapT, 10497)
	const uv = accessor(g.json, g.bin, prim.attributes.TEXCOORD_0)
	const us = [...uv].filter((_, i) => i % 2 === 0), vs = [...uv].filter((_, i) => i % 2 === 1)
	assert.deepEqual([Math.min(...us), Math.max(...us)], [-3.75, 3.75], 'u spans the room in 4 m tiles')
	assert.deepEqual([Math.min(...vs), Math.max(...vs)], [-7.75, 7.75], 'v spans the room in 4 m tiles')
	assert.equal(mat.pbrMetallicRoughness.roughnessFactor, 1)
	assert.equal(mat.doubleSided, false, 'one-sided as authored')
	const img = g.json.images[tex.source]
	const v = g.json.bufferViews[img.bufferView]
	assert.ok(Buffer.from(g.bin.buffer, g.bin.byteOffset + v.byteOffset, v.byteLength).equals(JPEG), 'the picture is the one in the archive (encoder stubbed)')
	assert.equal(json.materials.textures, 2)
	assert.equal(json.materials.leftOut, 0)
	assert.equal(json.tracks.length > 0, true, 'the room still makes tracks')
})

test('emission, its picture and double-sidedness survive; a flat mesh stays flat', async () => {
	const { glb } = await bakeScene(sceneInputs(project), 'rich', { mvrStore: store, scale: 0.1, encodeImage, meanColor })
	const g = glbOf(glb)
	const curtain = g.byName('curtain').mat, crystal = g.byName('crystal').mat
	assert.deepEqual(curtain.emissiveFactor, [0.15, 0.15, 0.15])
	assert.equal(curtain.emissiveTexture.index, curtain.pbrMetallicRoughness.baseColorTexture.index, 'the curtain glows through its own picture')
	assert.equal(curtain.doubleSided, false)
	assert.equal(crystal.doubleSided, true)
	assert.deepEqual(crystal.emissiveFactor, [0.7, 0.7, 0.7])
	assert.deepEqual(crystal.pbrMetallicRoughness.baseColorFactor, [1, 0.9, 0.8, 1])
	const flat = g.json.materials.filter((m) => !m.pbrMetallicRoughness.baseColorTexture)
	assert.ok(flat.some((m) => Math.abs(m.pbrMetallicRoughness.baseColorFactor[0] - 0.297) < 0.02), 'the stage cube keeps its flat colour')
})

test('over the texture budget a picture is left out and its mesh is drawn in its mean colour, without UVs', async () => {
	const huge = async () => ({ data: Buffer.alloc(2 * 1024 * 1024, 1), mime: 'image/jpeg' })
	const { json, glb } = await bakeScene(sceneInputs(project), 'over', { mvrStore: store, scale: 0.1, encodeImage: huge, meanColor })
	assert.ok(json.materials.leftOut >= 1)
	const g = glbOf(glb)
	assert.equal((g.json.images || []).length, 0, 'no picture shipped')
	assert.ok(g.json.meshes[0].primitives.every((p) => p.attributes.TEXCOORD_0 == null), 'no UVs without a picture')
	assert.ok(g.json.materials.some((m) => m.pbrMetallicRoughness.baseColorFactor.slice(0, 3).join() === '0.5,0.25,0.1'), 'the carpet in its mean colour')
})
