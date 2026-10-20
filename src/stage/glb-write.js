'use strict'

/**
 * WO-612 — minimal glTF 2.0 binary (GLB) writer for meshes the server builds or converts (3DS → GLB for the Godot
 * previs; Godot loads every MVR mesh the same way, through GLTFDocument). Positions / normals float32, uint32 indices,
 * one node per mesh, one PBR material per colour. Pure.
 *
 * @typedef {{ positions: Float32Array, normals?: Float32Array, indices: Uint32Array, color?: number[] }} Prim
 * @typedef {{ name: string, primitives: Prim[] }} Mesh
 */

function pad4(n) {
	return (n + 3) & ~3
}

/** Smooth per-vertex normals (area-weighted face normals) for an indexed triangle list. */
function smoothNormals(pos, idx) {
	const n = new Float32Array(pos.length)
	for (let i = 0; i + 2 < idx.length; i += 3) {
		const [a, b, c] = [idx[i] * 3, idx[i + 1] * 3, idx[i + 2] * 3]
		const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2]
		const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2]
		const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
		for (const k of [a, b, c]) {
			n[k] += nx
			n[k + 1] += ny
			n[k + 2] += nz
		}
	}
	for (let k = 0; k < n.length; k += 3) {
		const l = Math.hypot(n[k], n[k + 1], n[k + 2]) || 1
		n[k] /= l
		n[k + 1] /= l
		n[k + 2] /= l
	}
	return n
}

/** @param {Mesh[]} meshes → Buffer (GLB) */
function writeGlb(meshes) {
	const chunks = []
	let offset = 0
	const json = { asset: { version: '2.0', generator: 'HighAsCG' }, scene: 0, scenes: [{ nodes: [] }], nodes: [],
		meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] }
	const mats = new Map()
	const view = (typed, target) => {
		const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength)
		json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target })
		chunks.push(bytes)
		const padded = pad4(bytes.length)
		if (padded > bytes.length) chunks.push(Buffer.alloc(padded - bytes.length))
		offset += padded
		return json.bufferViews.length - 1
	}
	const material = (color) => {
		const c = (color || [0.7, 0.7, 0.7, 1]).map((v) => Math.round(v * 1000) / 1000)
		const key = c.join(',')
		if (!mats.has(key)) {
			json.materials.push({ pbrMetallicRoughness: { baseColorFactor: c, metallicFactor: 0, roughnessFactor: 0.8 },
				doubleSided: true })
			mats.set(key, json.materials.length - 1)
		}
		return mats.get(key)
	}
	for (const m of meshes) {
		const prims = []
		for (const p of m.primitives) {
			if (!p.indices.length || !p.positions.length) continue
			const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
			for (let i = 0; i < p.positions.length; i += 3) {
				for (let k = 0; k < 3; k++) {
					min[k] = Math.min(min[k], p.positions[i + k])
					max[k] = Math.max(max[k], p.positions[i + k])
				}
			}
			const count = p.positions.length / 3
			json.accessors.push({ bufferView: view(p.positions, 34962), componentType: 5126, count, type: 'VEC3', min, max })
			const posAcc = json.accessors.length - 1
			json.accessors.push({ bufferView: view(p.normals || smoothNormals(p.positions, p.indices), 34962),
				componentType: 5126, count, type: 'VEC3' })
			const nAcc = json.accessors.length - 1
			json.accessors.push({ bufferView: view(p.indices, 34963), componentType: 5125, count: p.indices.length, type: 'SCALAR' })
			prims.push({ attributes: { POSITION: posAcc, NORMAL: nAcc }, indices: json.accessors.length - 1,
				material: material(p.color), mode: 4 })
		}
		if (!prims.length) continue
		json.meshes.push({ name: m.name, primitives: prims })
		json.nodes.push({ name: m.name, mesh: json.meshes.length - 1 })
		json.scenes[0].nodes.push(json.nodes.length - 1)
	}
	json.buffers.push({ byteLength: offset })
	if (!json.materials.length) delete json.materials
	return packGlb(json, Buffer.concat(chunks))
}

function packGlb(json, bin) {
	let js = Buffer.from(JSON.stringify(json))
	js = Buffer.concat([js, Buffer.alloc(pad4(js.length) - js.length, 0x20)])
	bin = Buffer.concat([bin, Buffer.alloc(pad4(bin.length) - bin.length)])
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

/** GLB → { json, bin } (tests / bounds checks). */
function readGlb(buf) {
	if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB')
	const jl = buf.readUInt32LE(12)
	const json = JSON.parse(buf.subarray(20, 20 + jl).toString('utf8'))
	const bl = 20 + jl < buf.length ? buf.readUInt32LE(20 + jl) : 0
	return { json, bin: bl ? buf.subarray(28 + jl, 28 + jl + bl) : Buffer.alloc(0) }
}

const TEX_SLOTS = ['normalTexture', 'occlusionTexture', 'emissiveTexture']
const PBR_SLOTS = ['baseColorTexture', 'metallicRoughnessTexture']

/**
 * Self-contained GLB: images given by `uri` (a sibling file in the MVR/GDTF archive) are embedded from `read(uri)`;
 * if any cannot be read, every texture is dropped (materials keep their factors) — a loader with no base path
 * (Godot GLTFDocument.append_from_buffer) refuses the whole file over one external image.
 */
async function embedGlbImages(buf, read) {
	const { json, bin } = readGlb(buf)
	const ext = (json.images || []).filter((im) => im.uri && !/^data:/.test(im.uri))
	if (!ext.length) return buf
	let out = bin
	let ok = true
	for (const im of ext) {
		const data = await Promise.resolve(read(decodeURIComponent(im.uri))).catch(() => null)
		if (!data) {
			ok = false
			break
		}
		out = Buffer.concat([out, Buffer.alloc(pad4(out.length) - out.length)])
		json.bufferViews = json.bufferViews || []
		json.bufferViews.push({ buffer: 0, byteOffset: out.length, byteLength: data.length })
		out = Buffer.concat([out, data])
		im.bufferView = json.bufferViews.length - 1
		im.mimeType = im.mimeType || (/\.jpe?g$/i.test(im.uri) ? 'image/jpeg' : 'image/png')
		delete im.uri
	}
	if (!ok) {
		for (const k of ['images', 'textures', 'samplers']) delete json[k]
		for (const m of json.materials || []) {
			for (const k of TEX_SLOTS) delete m[k]
			for (const k of PBR_SLOTS) if (m.pbrMetallicRoughness) delete m.pbrMetallicRoughness[k]
		}
		return packGlb(json, bin)
	}
	json.buffers = json.buffers?.length ? json.buffers : [{}]
	json.buffers[0].byteLength = out.length
	return packGlb(json, out)
}

module.exports = { writeGlb, readGlb, embedGlbImages, smoothNormals }
