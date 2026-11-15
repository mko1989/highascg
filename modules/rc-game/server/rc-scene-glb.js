'use strict'

/**
 * WO-1082 — the game scene's ONE GLB: one mesh `rc-scene`, one primitive per bucket (rc-scene-mesh.js instanceParts):
 * flat (positions only, no NORMAL — a viewer shades it flat), one material per colour, and per textured venue material
 * a primitive with TEXCOORD_0 and its shrunk image (rc-scene-tex.js) as baseColorTexture (REPEAT: Capture tiles its
 * floor textures). A textured primitive whose image was left out keeps its colour and drops its UVs.
 *
 *   sceneGlb(primitives, mats?) → Buffer
 *     primitives: [{ positions, indices, color, uvs?, tex?, mode? (1 = LINES: the venue's line work) }]   mats: Map tex → { name, image: { data, mime, key } | null }
 */

const pad4 = (n) => (n + 3) & ~3

function sceneGlb(primitives, mats = new Map()) {
	const chunks = []
	let offset = 0
	const json = { asset: { version: '2.0', generator: 'HighAsCG rc-game' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'rc-scene', mesh: 0 }],
		meshes: [{ name: 'rc-scene', primitives: [] }], materials: [], accessors: [], bufferViews: [], buffers: [] }
	const view = (typed, target) => {
		const bytes = Buffer.isBuffer(typed) ? typed : Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength)
		json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) })
		chunks.push(bytes)
		const padded = pad4(bytes.length)
		if (padded > bytes.length) chunks.push(Buffer.alloc(padded - bytes.length))
		offset += padded
		return json.bufferViews.length - 1
	}
	const flatMats = new Map()
	const flatMaterial = (color) => {
		const c = (color || [0.7, 0.7, 0.7, 1]).slice(0, 4).map((v) => Math.round(v * 1000) / 1000)
		const key = c.join(',')
		if (!flatMats.has(key)) {
			json.materials.push({ pbrMetallicRoughness: { baseColorFactor: c, metallicFactor: 0, roughnessFactor: 0.8 }, doubleSided: true })
			flatMats.set(key, json.materials.length - 1)
		}
		return flatMats.get(key)
	}
	const images = new Map() // image key → texture index
	const texture = (img) => {
		if (!images.has(img.key)) {
			json.images = json.images || []
			json.textures = json.textures || []
			json.samplers = json.samplers || [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }]
			json.images.push({ bufferView: view(img.data), mimeType: img.mime })
			json.textures.push({ sampler: 0, source: json.images.length - 1 })
			images.set(img.key, json.textures.length - 1)
		}
		return images.get(img.key)
	}
	for (const p of primitives) {
		if (!p.indices.length || !p.positions.length) continue
		const m = p.tex != null ? mats.get(p.tex) : null
		const textured = !!(m?.image && p.uvs && p.uvs.length === (p.positions.length / 3) * 2)
		const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
		for (let i = 0; i < p.positions.length; i += 3) {
			for (let k = 0; k < 3; k++) {
				if (p.positions[i + k] < min[k]) min[k] = p.positions[i + k]
				if (p.positions[i + k] > max[k]) max[k] = p.positions[i + k]
			}
		}
		const count = p.positions.length / 3
		json.accessors.push({ bufferView: view(p.positions, 34962), componentType: 5126, count, type: 'VEC3', min, max })
		const attributes = { POSITION: json.accessors.length - 1 }
		let material
		if (textured) {
			json.accessors.push({ bufferView: view(p.uvs, 34962), componentType: 5126, count, type: 'VEC2' })
			attributes.TEXCOORD_0 = json.accessors.length - 1
			const c = (p.color || [1, 1, 1, 1]).slice(0, 4).map((v) => Math.round(v * 1000) / 1000)
			json.materials.push({ ...(m.name ? { name: m.name } : {}), doubleSided: true,
				pbrMetallicRoughness: { baseColorFactor: c, baseColorTexture: { index: texture(m.image) }, metallicFactor: 0, roughnessFactor: 0.8 } })
			material = json.materials.length - 1
		} else material = flatMaterial(p.color)
		json.accessors.push({ bufferView: view(p.indices, 34963), componentType: 5125, count: p.indices.length, type: 'SCALAR' })
		json.meshes[0].primitives.push({ attributes, indices: json.accessors.length - 1, material, mode: p.mode === 1 ? 1 : 4 })
	}
	if (!json.meshes[0].primitives.length) {
		json.meshes = []
		json.nodes = []
		json.scenes[0].nodes = []
	}
	json.buffers.push({ byteLength: offset })
	if (!json.materials.length) delete json.materials
	let js = Buffer.from(JSON.stringify(json))
	js = Buffer.concat([js, Buffer.alloc(pad4(js.length) - js.length, 0x20)])
	const bin = Buffer.concat(chunks)
	const head = Buffer.alloc(12)
	head.writeUInt32LE(0x46546c67, 0)
	head.writeUInt32LE(2, 4)
	head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8)
	const chunkHead = (len, type) => {
		const b = Buffer.alloc(8)
		b.writeUInt32LE(len, 0)
		b.writeUInt32LE(type, 4)
		return b
	}
	return Buffer.concat([head, chunkHead(js.length, 0x4e4f534a), js, chunkHead(bin.length, 0x004e4942), bin])
}

module.exports = { sceneGlb }
