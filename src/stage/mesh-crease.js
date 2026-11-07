'use strict'

/**
 * WO-994 — per-corner normals with hard edges for 3DS meshes (MVR set pieces, older GDTF bodies).
 *
 * A 3DS mesh shares one vertex between every face that meets there, across a table's 90° edges too. Averaging the face
 * normals per vertex (glb-write smoothNormals) bends the light around those corners: boxes look like soft blobs and
 * flat tops shade as gradients. 3DS's own answer is smoothing groups (chunk 0x4150, one bit mask per face; faces
 * share a normal only if their masks share a bit, mask 0 = flat). Files without them (Capture's MVR export) get an
 * auto-smooth crease angle instead: faces meeting at less than `angleDeg` share a normal.
 *
 * Only faces that share a vertex index are neighbours: a vertex the file itself split stays a hard edge. GDTF bodies
 * often put every face in smoothing group 1 and mark their edges that way (welding by position smeared them). Output
 * vertices are split wherever the corner normals differ. Pure.
 */

const DEFAULT_ANGLE = 40

/**
 * @param {Float32Array} positions xyz per vertex
 * @param {Uint32Array|number[]} indices triangle list
 * @param {{ smoothing?: Uint32Array|null, angleDeg?: number }} [opts]
 * @returns {{ positions: Float32Array, normals: Float32Array, indices: Uint32Array }}
 */
function creaseNormals(positions, indices, opts = {}) {
	const nf = Math.floor(indices.length / 3)
	const smoothing = opts.smoothing && opts.smoothing.length >= nf ? opts.smoothing : null
	const cosMax = Math.cos(((opts.angleDeg ?? DEFAULT_ANGLE) * Math.PI) / 180)

	// Unit face normals, and each corner's angle: a corner normal is the angle-weighted sum (symmetric, unlike area
	// weighting, where a quad split into two triangles pulls the normal towards its own facet).
	const unit = new Float64Array(nf * 3)
	const corner = new Float64Array(nf * 3)
	const ang = (p, q, r) => {
		const ax = positions[q] - positions[p], ay = positions[q + 1] - positions[p + 1], az = positions[q + 2] - positions[p + 2]
		const bx = positions[r] - positions[p], by = positions[r + 1] - positions[p + 1], bz = positions[r + 2] - positions[p + 2]
		const l = Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz)
		return l > 0 ? Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / l))) : 0
	}
	for (let f = 0; f < nf; f++) {
		const a = indices[f * 3] * 3, b = indices[f * 3 + 1] * 3, c = indices[f * 3 + 2] * 3
		const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2]
		const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2]
		const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
		const l = Math.hypot(nx, ny, nz)
		corner[f * 3] = ang(a, b, c)
		corner[f * 3 + 1] = ang(b, c, a)
		corner[f * 3 + 2] = ang(c, a, b)
		if (l > 0) {
			unit[f * 3] = nx / l
			unit[f * 3 + 1] = ny / l
			unit[f * 3 + 2] = nz / l
		}
	}

	const around = Array.from({ length: positions.length / 3 }, () => []) // corner ids f * 3 + k, per vertex
	for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) around[indices[f * 3 + k]].push(f * 3 + k)

	const joins = (f, g) => {
		if (f === g) return true
		if (smoothing) return (smoothing[f] & smoothing[g]) !== 0
		const d = unit[f * 3] * unit[g * 3] + unit[f * 3 + 1] * unit[g * 3 + 1] + unit[f * 3 + 2] * unit[g * 3 + 2]
		return d >= cosMax
	}

	// One output vertex per (source vertex, corner normal); identical corners share it.
	const outPos = []
	const outNrm = []
	const outIdx = new Uint32Array(nf * 3)
	const made = new Map()
	for (let f = 0; f < nf; f++) {
		for (let k = 0; k < 3; k++) {
			const v = indices[f * 3 + k]
			let x = 0, y = 0, z = 0
			for (const gc of around[v]) {
				const g = (gc / 3) | 0
				if (!joins(f, g)) continue
				const w = corner[gc]
				x += unit[g * 3] * w
				y += unit[g * 3 + 1] * w
				z += unit[g * 3 + 2] * w
			}
			let l = Math.hypot(x, y, z)
			if (!(l > 0)) {
				;[x, y, z] = [unit[f * 3], unit[f * 3 + 1], unit[f * 3 + 2]]
				l = Math.hypot(x, y, z)
				if (!(l > 0)) [x, y, z, l] = [0, 1, 0, 1]
			}
			x /= l
			y /= l
			z /= l
			const key = `${v}|${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`
			let o = made.get(key)
			if (o === undefined) {
				o = outPos.length / 3
				made.set(key, o)
				outPos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2])
				outNrm.push(x, y, z)
			}
			outIdx[f * 3 + k] = o
		}
	}
	return { positions: new Float32Array(outPos), normals: new Float32Array(outNrm), indices: outIdx }
}

module.exports = { creaseNormals, DEFAULT_ANGLE }
