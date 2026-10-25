'use strict'

/**
 * WO-767 — GLB models authored in millimetres with no unit scale. glTF is metres by definition, but some vendor GDTFs
 * ship mm meshes anyway: Martin MAC Aura PXL (rid159073) has yoke.glb 409.9 units wide where its description.xml
 * declares the Yoke model 0.4099 m, so every head drew ~400 m wide and its pick box swallowed every click (owner 25.10:
 * "a huge building around the scene"). Robe's mm meshes carry node scale 0.001 and are fine — that is why the
 * extent is measured through the node transforms, never from raw accessor bounds.
 *
 * `fixGlbUnits` measures the scene's extent and, when it is ~1000× the declared size (or, without one, larger than any
 * fixture body can be), wraps the scene roots in one node scaled 0.001. Pure; everything else in the file is kept.
 */

const MAGIC = 0x46546c67 // 'glTF'
const CHUNK_JSON = 0x4e4f534a
/** declared size × this range ⇒ the file is in mm (1000×, with slack for a declared box that is not the mesh's) */
const MM_RATIO = [300, 3000]
/** No fixture body is this large (m); a GDTF mesh over it with no declared size is taken as mm. */
const FIXTURE_MAX_M = 20

function parseGlb(buf) {
	if (!Buffer.isBuffer(buf) || buf.length < 20 || buf.readUInt32LE(0) !== MAGIC) return null
	const jsonLen = buf.readUInt32LE(12)
	if (buf.readUInt32LE(16) !== CHUNK_JSON || 20 + jsonLen > buf.length) return null
	try {
		return { json: JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')), rest: buf.subarray(20 + jsonLen) }
	} catch {
		return null
	}
}

function writeGlbJson(json, rest) {
	let txt = Buffer.from(JSON.stringify(json), 'utf8')
	const pad = (4 - (txt.length % 4)) % 4
	if (pad) txt = Buffer.concat([txt, Buffer.alloc(pad, 0x20)])
	const head = Buffer.alloc(20)
	head.writeUInt32LE(MAGIC, 0)
	head.writeUInt32LE(2, 4)
	head.writeUInt32LE(20 + txt.length + rest.length, 8)
	head.writeUInt32LE(txt.length, 12)
	head.writeUInt32LE(CHUNK_JSON, 16)
	return Buffer.concat([head, txt, rest])
}

/** Column-major 4×4 from a glTF node (matrix, or T·R·S). */
function nodeMatrix(n) {
	if (Array.isArray(n.matrix) && n.matrix.length === 16) return n.matrix.map(Number)
	const [tx, ty, tz] = n.translation || [0, 0, 0]
	const [x, y, z, w] = n.rotation || [0, 0, 0, 1]
	const [sx, sy, sz] = n.scale || [1, 1, 1]
	return [
		(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
		2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
		2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
		tx, ty, tz, 1,
	]
}

function mul(a, b) {
	const o = new Array(16).fill(0)
	for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
	return o
}

const apply = (m, p) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r])

/** Largest side (glTF units, node transforms applied) of the default scene's bounding box, or 0. */
function glbExtent(json) {
	const nodes = json?.nodes || []
	const scene = (json?.scenes || [])[json?.scene ?? 0]
	const roots = scene?.nodes || nodes.map((_, i) => i)
	const lo = [Infinity, Infinity, Infinity]
	const hi = [-Infinity, -Infinity, -Infinity]
	const walk = (i, parent, depth) => {
		const n = nodes[i]
		if (!n || depth > 64) return
		const m = mul(parent, nodeMatrix(n))
		for (const prim of json.meshes?.[n.mesh]?.primitives || []) {
			const acc = json.accessors?.[prim.attributes?.POSITION]
			if (!acc?.min || !acc?.max) continue
			for (let c = 0; c < 8; c++) {
				const p = apply(m, [0, 1, 2].map((k) => (c >> k) & 1 ? acc.max[k] : acc.min[k]))
				for (let k = 0; k < 3; k++) {
					lo[k] = Math.min(lo[k], p[k])
					hi[k] = Math.max(hi[k], p[k])
				}
			}
		}
		for (const ch of n.children || []) walk(ch, m, depth + 1)
	}
	const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
	for (const r of roots) walk(r, I, 0)
	return Number.isFinite(lo[0]) ? Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) : 0
}

/**
 * @param {Buffer} buf GLB bytes
 * @param {number} [declaredM] the model's declared largest side in metres (GDTF Model Length / Width / Height)
 * @returns {{ glb: Buffer, scaled: boolean, extent: number }}
 */
function fixGlbUnits(buf, declaredM) {
	const g = parseGlb(buf)
	if (!g) return { glb: buf, scaled: false, extent: 0 }
	const extent = glbExtent(g.json)
	const d = Number(declaredM)
	const mm = d > 0 ? extent / d >= MM_RATIO[0] && extent / d <= MM_RATIO[1] : extent > FIXTURE_MAX_M
	if (!mm) return { glb: buf, scaled: false, extent }
	const json = g.json
	json.nodes = json.nodes || []
	json.scenes = json.scenes?.length ? json.scenes : [{ nodes: json.nodes.map((_, i) => i) }]
	const si = json.scene ?? 0
	json.nodes.push({ name: 'highascg_mm_to_m', scale: [0.001, 0.001, 0.001], children: json.scenes[si].nodes || [] })
	json.scenes[si].nodes = [json.nodes.length - 1]
	return { glb: writeGlbJson(json, g.rest), scaled: true, extent }
}

module.exports = { fixGlbUnits, glbExtent, parseGlb, MM_RATIO, FIXTURE_MAX_M }
