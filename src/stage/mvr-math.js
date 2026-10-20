'use strict'

/**
 * WO-612 — 4×4 transforms for the MVR importer. Column-major arrays (m[col * 4 + row]), metres, the MVR / GDTF frame
 * (right-handed, Z-up). `toGodot` converts to the Godot previs frame (Y-up: x, z, −y) for a mesh stored in glTF's
 * frame (Y-up), which every mesh the importer serves is (glb as-is, 3DS converted). Pure.
 */

const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

function mul(a, b) {
	const o = new Array(16).fill(0)
	for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
	return o
}

function nums(text) {
	return String(text ?? '').match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi)?.map(Number) || []
}

/** MVR <Matrix>{u}{v}{w}{o}: axis columns + origin in mm. Missing / malformed → identity. */
function mvrMatrix(text) {
	const n = nums(text)
	if (n.length !== 12 || n.some((v) => !Number.isFinite(v))) return [...IDENTITY]
	return [n[0], n[1], n[2], 0, n[3], n[4], n[5], 0, n[6], n[7], n[8], 0, n[9] / 1000, n[10] / 1000, n[11] / 1000, 1]
}

/** GDTF Position="{r0}{r1}{r2}{r3}": rows, translation in the 4th column, metres. */
function gdtfMatrix(text) {
	const n = nums(text)
	if (n.length !== 16 || n.some((v) => !Number.isFinite(v))) return [...IDENTITY]
	const o = []
	for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o.push(n[r * 4 + c])
	return o
}

// glTF (Y-up) → MVR (Z-up): x→x, y→z, z→−y. MVR → Godot: x→x, y→−z, z→y. GODOT_FROM_MVR · MVR_FROM_GLTF = identity.
const MVR_FROM_GLTF = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]
const GODOT_FROM_MVR = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]

/** World (MVR frame) transform of a glTF-frame mesh → Godot Transform3D as 12 numbers: basis x, y, z columns, origin. */
function toGodot(m) {
	const g = mul(mul(GODOT_FROM_MVR, m), MVR_FROM_GLTF)
	const r = (v) => Math.round(v * 1e6) / 1e6
	return [g[0], g[1], g[2], g[4], g[5], g[6], g[8], g[9], g[10], g[12], g[13], g[14]].map(r)
}

/** Scale along the MVR axes (one value = uniform). */
function scale(x, y = x, z = x) {
	return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]
}

module.exports = { IDENTITY, mul, mvrMatrix, gdtfMatrix, toGodot, scale, MVR_FROM_GLTF, GODOT_FROM_MVR }
