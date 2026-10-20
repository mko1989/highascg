'use strict'

/**
 * WO-612 T2 — Autodesk 3DS mesh reader → GLB. MVR (and older GDTF) geometry may be 3DS: 1 unit = 1 mm, Z-up.
 * The GLB comes out in glTF's frame (Y-up, metres) so every MVR mesh, glb or 3ds, is placed the same way.
 * Chunks: MAIN 4D4D → EDIT 3D3D → OBJECT 4000 (name) → TRIMESH 4100: VERTICES 4110, FACES 4120 (+ MSH_MAT_GROUP
 * 4130); MATERIAL AFFF: NAME A000, DIFFUSE A020 (COLOR_24 0011 / COLOR_F 0010). Pure.
 */

const { writeGlb } = require('./glb-write')

function cstring(buf, at, end) {
	let i = at
	while (i < end && buf[i] !== 0) i++
	return { text: buf.toString('latin1', at, i), next: Math.min(end, i + 1) }
}

function* chunks(buf, start, end) {
	let at = start
	while (at + 6 <= end) {
		const id = buf.readUInt16LE(at)
		const len = buf.readUInt32LE(at + 2)
		if (len < 6 || at + len > end) return
		yield { id, start: at + 6, end: at + len }
		at += len
	}
}

function readColor(buf, start, end) {
	for (const c of chunks(buf, start, end)) {
		if (c.id === 0x0011 || c.id === 0x0012) return [buf[c.start] / 255, buf[c.start + 1] / 255, buf[c.start + 2] / 255, 1]
		if (c.id === 0x0010 || c.id === 0x0013)
			return [buf.readFloatLE(c.start), buf.readFloatLE(c.start + 4), buf.readFloatLE(c.start + 8), 1]
	}
	return null
}

/** → { objects: [{ name, vertices: Float32Array (mm, Z-up), faces: Uint32Array, groups: [{ material, faces: [] }] }],
 *      materials: Map(name → rgba) } */
function parse3ds(buf) {
	const objects = []
	const materials = new Map()
	if (!Buffer.isBuffer(buf) || buf.length < 6 || buf.readUInt16LE(0) !== 0x4d4d) throw new Error('not a 3DS file')
	const main = buf.readUInt32LE(2)
	for (const c of chunks(buf, 6, Math.min(main, buf.length))) {
		if (c.id !== 0x3d3d) continue
		for (const e of chunks(buf, c.start, c.end)) {
			if (e.id === 0xafff) {
				let name = ''
				let color = null
				for (const m of chunks(buf, e.start, e.end)) {
					if (m.id === 0xa000) name = cstring(buf, m.start, m.end).text
					if (m.id === 0xa020) color = readColor(buf, m.start, m.end)
				}
				if (name) materials.set(name, color)
			}
			if (e.id !== 0x4000) continue
			const { text: name, next } = cstring(buf, e.start, e.end)
			for (const t of chunks(buf, next, e.end)) {
				if (t.id !== 0x4100) continue
				const obj = { name, vertices: new Float32Array(0), faces: new Uint32Array(0), groups: [] }
				for (const d of chunks(buf, t.start, t.end)) {
					if (d.id === 0x4110) {
						const n = buf.readUInt16LE(d.start)
						obj.vertices = new Float32Array(n * 3)
						for (let i = 0; i < n * 3 && d.start + 2 + i * 4 + 4 <= d.end; i++) obj.vertices[i] = buf.readFloatLE(d.start + 2 + i * 4)
					}
					if (d.id === 0x4120) {
						const n = buf.readUInt16LE(d.start)
						obj.faces = new Uint32Array(n * 3)
						for (let i = 0; i < n; i++) {
							const at = d.start + 2 + i * 8
							obj.faces[i * 3] = buf.readUInt16LE(at)
							obj.faces[i * 3 + 1] = buf.readUInt16LE(at + 2)
							obj.faces[i * 3 + 2] = buf.readUInt16LE(at + 4)
						}
						for (const g of chunks(buf, d.start + 2 + n * 8, d.end)) {
							if (g.id !== 0x4130) continue
							const { text: material, next: at } = cstring(buf, g.start, g.end)
							const k = buf.readUInt16LE(at)
							const faces = []
							for (let i = 0; i < k; i++) faces.push(buf.readUInt16LE(at + 2 + i * 2))
							obj.groups.push({ material, faces })
						}
					}
				}
				objects.push(obj)
			}
		}
	}
	return { objects, materials }
}

/** 3DS bytes → GLB bytes (glTF frame: x, z, −y; mm → m). One primitive per material group. */
function threeDsToGlb(buf) {
	const { objects, materials } = parse3ds(buf)
	const meshes = []
	for (const o of objects) {
		const nv = o.vertices.length / 3
		const nf = o.faces.length / 3
		if (!nv || !nf) continue
		const positions = new Float32Array(o.vertices.length)
		for (let i = 0; i < nv; i++) {
			positions[i * 3] = o.vertices[i * 3] / 1000
			positions[i * 3 + 1] = o.vertices[i * 3 + 2] / 1000
			positions[i * 3 + 2] = -o.vertices[i * 3 + 1] / 1000
		}
		const used = new Uint8Array(nf)
		const groups = o.groups.map((g) => ({ color: materials.get(g.material) || null, faces: g.faces.filter((f) => f < nf) }))
		for (const g of groups) for (const f of g.faces) used[f] = 1
		const rest = []
		for (let f = 0; f < nf; f++) if (!used[f]) rest.push(f)
		if (rest.length) groups.push({ color: null, faces: rest })
		const primitives = []
		for (const g of groups) {
			if (!g.faces.length) continue
			const indices = new Uint32Array(g.faces.length * 3)
			g.faces.forEach((f, i) => indices.set(o.faces.subarray(f * 3, f * 3 + 3), i * 3))
			if (indices.some((v) => v >= nv)) continue
			primitives.push({ positions, indices, color: g.color || undefined })
		}
		meshes.push({ name: o.name || 'mesh', primitives })
	}
	if (!meshes.length) throw new Error('3DS file has no triangle meshes')
	return writeGlb(meshes)
}

module.exports = { parse3ds, threeDsToGlb }
