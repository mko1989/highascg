'use strict'

/**
 * WO-1074 — RC car game: the merged scene mesh. Template GLBs (one per MVR mesh key) are read into flat triangle
 * lists, simplified by vertex clustering when the scene is over the phone budget, instanced per visible part into one
 * position-only primitive per colour and written as ONE GLB (src/stage/glb-write.js, no normals → flat shading).
 * Budget order: weld only → drop fixtures → coarser clustering (1 → 8 cm) → drop the smallest objects.
 */

const { core } = require('./host')
const { readGlb, writeGlb } = core('src/stage/glb-write')
const { apply, boxUnder, compose, scaleOf } = require('./rc-scene-geom')

const MAX_TRIS = 400000
const MAX_BYTES = 7.5 * 1024 * 1024 // under the contract's 8 MB, room for the JSON chunk
const CELLS = [0.002, 0.01, 0.02, 0.03, 0.05, 0.08]
const DEFAULT_COLOR = [0.42, 0.42, 0.45, 1]

const TYPED = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }

function accessor(json, bin, i) {
	const a = json.accessors?.[i]
	if (!a || a.bufferView == null) return null
	const v = json.bufferViews[a.bufferView]
	const T = TYPED[a.componentType]
	const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type] || 1
	if (!T || !v) return null
	const base = bin.byteOffset + (v.byteOffset || 0) + (a.byteOffset || 0)
	const stride = v.byteStride || comps * T.BYTES_PER_ELEMENT
	const out = new (T === Float32Array ? Float32Array : Uint32Array)(a.count * comps)
	const dv = new DataView(bin.buffer)
	const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType]
	for (let e = 0; e < a.count; e++) for (let c = 0; c < comps; c++) out[e * comps + c] = dv[get](base + e * stride + c * T.BYTES_PER_ELEMENT, true)
	return out
}

/** glTF node → 12-number affine (matrix or TRS). */
function nodeXf(n) {
	if (Array.isArray(n.matrix) && n.matrix.length === 16) {
		const m = n.matrix
		return [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10], m[12], m[13], m[14]]
	}
	const [x, y, z, w] = n.rotation || [0, 0, 0, 1]
	const [sx, sy, sz] = n.scale || [1, 1, 1]
	const t = n.translation || [0, 0, 0]
	return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx,
		2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy,
		2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, t[0], t[1], t[2]]
}

/** GLB → template { prims: [{ pos, idx, color }], tris, bounds } with node transforms baked in; null when unreadable. */
function readTemplate(buf) {
	let g
	try {
		g = readGlb(buf)
	} catch {
		return null
	}
	const { json, bin } = g
	const prims = []
	const walk = (ni, parent, depth) => {
		const n = json.nodes?.[ni]
		if (!n || depth > 32) return
		const m = compose(parent, nodeXf(n))
		const mesh = n.mesh != null ? json.meshes?.[n.mesh] : null
		for (const p of mesh?.primitives || []) {
			if ((p.mode ?? 4) !== 4 || p.attributes?.POSITION == null) continue
			const raw = accessor(json, bin, p.attributes.POSITION)
			if (!raw) continue
			const pos = new Float32Array(raw.length)
			for (let i = 0; i < raw.length; i += 3) pos.set(apply(m, raw[i], raw[i + 1], raw[i + 2]), i)
			const idx = p.indices != null ? accessor(json, bin, p.indices) : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i)
			const f = json.materials?.[p.material]?.pbrMetallicRoughness?.baseColorFactor
			if (idx && idx.length >= 3) prims.push({ pos, idx: idx.subarray(0, idx.length - (idx.length % 3)), color: Array.isArray(f) ? f.slice(0, 3).concat(1) : null })
		}
		for (const c of n.children || []) walk(c, m, depth + 1)
	}
	const roots = json.scenes?.[json.scene || 0]?.nodes || (json.nodes || []).map((_, i) => i)
	for (const r of roots) walk(r, [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 0)
	if (!prims.length) return null
	const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
	let tris = 0
	for (const p of prims) {
		tris += p.idx.length / 3
		for (let i = 0; i < p.pos.length; i += 3) {
			for (let k = 0; k < 3; k++) {
				if (p.pos[i + k] < min[k]) min[k] = p.pos[i + k]
				if (p.pos[i + k] > max[k]) max[k] = p.pos[i + k]
			}
		}
	}
	return { prims, tris, bounds: { min, max }, simple: new Map() }
}

/** The unit box (−0.5 … 0.5) as a template — stage objects, a stage deck. */
function boxTemplate() {
	const pos = [], idx = []
	for (let i = 0; i < 8; i++) pos.push(i & 1 ? 0.5 : -0.5, i & 2 ? 0.5 : -0.5, i & 4 ? 0.5 : -0.5)
	for (const f of [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]) idx.push(f[0], f[1], f[2], f[0], f[2], f[3])
	return { prims: [{ pos: new Float32Array(pos), idx: new Uint32Array(idx), color: null }], tris: 12,
		bounds: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] }, simple: new Map(), exact: true }
}

/** Vertex clustering at `cell` (template units): vertices snapped to a grid and merged, collapsed / repeated triangles dropped. */
function cluster(prim, cell) {
	const map = new Map()
	const rem = new Uint32Array(prim.pos.length / 3)
	const pos = []
	for (let i = 0; i < rem.length; i++) {
		const x = Math.round(prim.pos[3 * i] / cell), y = Math.round(prim.pos[3 * i + 1] / cell), z = Math.round(prim.pos[3 * i + 2] / cell)
		const k = `${x},${y},${z}`
		let v = map.get(k)
		if (v === undefined) {
			v = pos.length / 3
			map.set(k, v)
			pos.push(prim.pos[3 * i], prim.pos[3 * i + 1], prim.pos[3 * i + 2])
		}
		rem[i] = v
	}
	const idx = []
	const seen = new Set()
	for (let i = 0; i + 2 < prim.idx.length; i += 3) {
		const a = rem[prim.idx[i]], b = rem[prim.idx[i + 1]], c = rem[prim.idx[i + 2]]
		if (a === b || b === c || a === c) continue
		const s = a < b ? (b < c ? `${a},${b},${c}` : a < c ? `${a},${c},${b}` : `${c},${a},${b}`) : a < c ? `${b},${a},${c}` : b < c ? `${b},${c},${a}` : `${c},${b},${a}`
		if (seen.has(s)) continue
		seen.add(s)
		idx.push(a, b, c)
	}
	return { pos: new Float32Array(pos), idx: new Uint32Array(idx), color: prim.color }
}

/** A template simplified at world `cell` (template used at most at `scale`) → { prims, tris, verts } (cached). */
function simplified(t, cell, scale) {
	const key = `${cell}`
	if (t.exact) return t.simple.get(key) || (t.simple.set(key, { prims: t.prims, tris: t.tris, verts: t.prims[0].pos.length / 3 }), t.simple.get(key))
	if (!t.simple.has(key)) {
		const prims = t.prims.map((p) => cluster(p, cell / Math.max(scale, 1e-6)))
		t.simple.set(key, { prims, tris: prims.reduce((s, p) => s + p.idx.length / 3, 0), verts: prims.reduce((s, p) => s + p.pos.length / 3, 0) })
	}
	return t.simple.get(key)
}

/**
 * Which parts to draw and at what simplification. parts: [{ key, xf, fixture }]; templates: Map key → template.
 * → { cell, keep: boolean[], tris, bytes, dropped: { fixtures, objects, cell } }.
 */
async function planBudget(parts, templates, pause = async () => {}, budget = {}) {
	const maxTris = budget.maxTris || MAX_TRIS, maxBytes = budget.maxBytes || MAX_BYTES
	const scale = new Map()
	for (const p of parts) scale.set(p.key, Math.max(scale.get(p.key) || 0, scaleOf(p.xf)))
	const cost = async (cell, keep) => {
		let tris = 0, verts = 0, k = 0
		for (let i = 0; i < parts.length; i++) {
			if (!keep[i]) continue
			const t = templates.get(parts[i].key)
			if (!t) continue
			if (!t.simple.has(`${cell}`) && ++k % 8 === 0) await pause()
			const s = simplified(t, cell, scale.get(parts[i].key))
			tris += s.tris
			verts += s.verts
		}
		return { tris, bytes: tris * 12 + verts * 12 }
	}
	const fits = (c) => c.tris <= maxTris && c.bytes <= maxBytes
	let keep = parts.map(() => true)
	let c = await cost(CELLS[0], keep)
	const dropped = { fixtures: 0, objects: 0, cell: CELLS[0] }
	if (fits(c)) return { cell: CELLS[0], keep, ...c, dropped }
	keep = parts.map((p) => !p.fixture)
	dropped.fixtures = new Set(parts.filter((p) => p.fixture).map((p) => p.uuid)).size
	let cell = CELLS[0]
	for (cell of CELLS) {
		c = await cost(cell, keep)
		if (fits(c)) return { cell, keep, ...c, dropped: { ...dropped, cell } }
	}
	// Still over: the smallest objects go (by their world box diagonal), whole objects at a time.
	const size = parts.map((p) => {
		const t = templates.get(p.key)
		if (!t) return 0
		const b = boxUnder(p.xf, t.bounds.min, t.bounds.max)
		return Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])
	})
	const order = parts.map((_, i) => i).filter((i) => keep[i]).sort((a, b) => size[a] - size[b] || a - b)
	const gone = new Set()
	let over = { ...c }
	for (const i of order) {
		if (fits(over)) break
		const s = templates.get(parts[i].key) ? simplified(templates.get(parts[i].key), cell, scale.get(parts[i].key)) : { tris: 0, verts: 0 }
		keep[i] = false
		gone.add(parts[i].uuid || `part${i}`)
		over = { tris: over.tris - s.tris, bytes: over.bytes - s.tris * 12 - s.verts * 12 }
	}
	return { cell, keep, ...over, dropped: { ...dropped, objects: gone.size, cell } }
}

/** Colour → bucket key (linear, 1/64 steps; keeps the material count small). */
const colorKey = (c) => c.slice(0, 3).map((v) => Math.round(Math.max(0, Math.min(1, v)) * 64)).join(',')

/**
 * Instance the kept parts into one primitive per colour (glb-write Prims, flat); `onTri(9 floats)` sees every world
 * triangle (obstacles). → { primitives, tris }.
 */
async function instanceParts(parts, templates, plan, onTri, pause = async () => {}) {
	const scale = new Map()
	for (const p of parts) scale.set(p.key, Math.max(scale.get(p.key) || 0, scaleOf(p.xf)))
	const buckets = new Map()
	let done = 0, tris = 0
	for (let i = 0; i < parts.length; i++) {
		if (!plan.keep[i]) continue
		const p = parts[i]
		const t = templates.get(p.key)
		if (!t) continue
		const s = simplified(t, plan.cell, scale.get(p.key))
		for (const pr of s.prims) {
			const color = p.color || pr.color || DEFAULT_COLOR
			const key = colorKey(color)
			if (!buckets.has(key)) buckets.set(key, { color: key.split(',').map((v) => Number(v) / 64).concat(1), pos: [], idx: [] })
			const b = buckets.get(key)
			const base = b.pos.length / 3
			const w = []
			for (let v = 0; v < pr.pos.length; v += 3) {
				const q = apply(p.xf, pr.pos[v], pr.pos[v + 1], pr.pos[v + 2])
				b.pos.push(q[0], q[1], q[2])
				w.push(q)
			}
			for (let k = 0; k < pr.idx.length; k += 3) {
				b.idx.push(base + pr.idx[k], base + pr.idx[k + 1], base + pr.idx[k + 2])
				if (onTri) {
					const A = w[pr.idx[k]], B = w[pr.idx[k + 1]], C = w[pr.idx[k + 2]]
					onTri(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2])
				}
			}
			tris += pr.idx.length / 3
			done += pr.idx.length / 3
		}
		if (done > 20000) {
			done = 0
			await pause()
		}
	}
	const primitives = [...buckets.values()].map((b) => ({ positions: new Float32Array(b.pos), indices: new Uint32Array(b.idx), color: b.color, flat: true }))
	return { primitives, tris }
}

/** Primitives → ONE GLB (one mesh, one node). */
const sceneGlb = (primitives) => writeGlb([{ name: 'rc-scene', primitives }])

module.exports = { MAX_TRIS, MAX_BYTES, readTemplate, boxTemplate, cluster, planBudget, instanceParts, sceneGlb }
