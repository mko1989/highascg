'use strict'

/**
 * WO-1098 — the venue's buckets (venue-build.js classify) → indexed meshes, cheap enough for the previs and the phones
 * (owner 15.11 about a 13 736-object MVR: "remove most of them … leave only essentials"):
 *   weld     — corners with the same position (0.5 mm), normal and (textured only) UV share one vertex;
 *   drop     — degenerate triangles (collapsed by the weld or under 1 mm²) and repeated ones (the same three vertices;
 *              in a double-sided bucket a face and its reverse are one);
 *   budget   — when the whole venue is over `budget` triangles, buckets are water-filled smallest first (a room shell of
 *              a few hundred triangles is never touched) and each one over its share is simplified by vertex clustering
 *              at the finest grid cell that fits (bisection), its normals then smoothed. Clustering is instancing-free and
 *              keeps a repeated part (16 chandeliers) identical in each copy, since each copy is clustered alike.
 * Pure.
 */

const { smoothNormals } = require('./glb-write')

const Q = 2000 // weld grid: 0.5 mm

/**
 * One bucket → { positions, normals, uvs?, indices (Uint32Array), degenerate, duplicate, trisIn }.
 * `uvOf(t, k)` → [u, v] for a textured bucket (null = no UVs).
 */
function weldBucket(cls, obj, b, uvOf = null) {
	const { P, N, fn, flip, area } = cls
	const T = obj.tris
	const map = new Map()
	const pos = [], nrm = [], uv = uvOf ? [] : null
	const idx = []
	const seen = new Set()
	let degenerate = 0, duplicate = 0
	const order = [[0, 1, 2], [0, 2, 1]]
	for (let i = 0; i < b.list.length; i++) {
		const t = b.list[i]
		if (area[t] < 1e-6) {
			degenerate++
			continue
		}
		const f = flip[t]
		const tri = []
		for (const k of order[f]) {
			const vi = T.v[3 * t + k] * 3
			const ni = T.vn[3 * t + k]
			const s = f ? -1 : 1
			const nx = ni >= 0 ? N[ni * 3] * s : fn[3 * t] * s
			const ny = ni >= 0 ? N[ni * 3 + 1] * s : fn[3 * t + 1] * s
			const nz = ni >= 0 ? N[ni * 3 + 2] * s : fn[3 * t + 2] * s
			const u = uvOf ? uvOf(t, k) : null
			const key = `${Math.round(P[vi] * Q)},${Math.round(P[vi + 1] * Q)},${Math.round(P[vi + 2] * Q)},${Math.round(nx * 64)},${Math.round(ny * 64)},${Math.round(nz * 64)}${u ? `,${Math.round(u[0] * 4096)},${Math.round(u[1] * 4096)}` : ''}`
			let v = map.get(key)
			if (v === undefined) {
				v = pos.length / 3
				map.set(key, v)
				pos.push(P[vi], P[vi + 1], P[vi + 2])
				nrm.push(nx, ny, nz)
				if (uv) uv.push(u[0], u[1])
			}
			tri.push(v)
		}
		const [a, c, d] = tri
		if (a === c || c === d || a === d) {
			degenerate++
			continue
		}
		const sorted = [a, c, d].sort((x, y) => x - y).join(',')
		const key = b.sided === 2 ? sorted : (a < c && a < d ? `${a},${c},${d}` : c < d ? `${c},${d},${a}` : `${d},${a},${c}`)
		if (seen.has(key)) {
			duplicate++
			continue
		}
		seen.add(key)
		idx.push(a, c, d)
	}
	return { positions: new Float32Array(pos), normals: new Float32Array(nrm), uvs: uv ? new Float32Array(uv) : null,
		indices: new Uint32Array(idx), degenerate, duplicate, trisIn: b.list.length }
}

/**
 * Vertex clustering at `cell` metres: each grid cell's vertices → their mean; collapsed / repeated triangles dropped.
 * The grid starts at the mesh's own lower corner, so two copies of one part cluster alike wherever they hang.
 */
function cluster(m, cell) {
	const n = m.positions.length / 3
	const o = [Infinity, Infinity, Infinity]
	for (let i = 0; i < n * 3; i++) if (m.positions[i] < o[i % 3]) o[i % 3] = m.positions[i]
	const map = new Map()
	const rem = new Uint32Array(n)
	const acc = [], cnt = [], uv = m.uvs ? [] : null
	for (let i = 0; i < n; i++) {
		const x = m.positions[3 * i], y = m.positions[3 * i + 1], z = m.positions[3 * i + 2]
		let k = `${Math.floor((x - o[0]) / cell)},${Math.floor((y - o[1]) / cell)},${Math.floor((z - o[2]) / cell)}`
		if (uv) k += `,${Math.round(m.uvs[2 * i] * 64)},${Math.round(m.uvs[2 * i + 1] * 64)}`
		let v = map.get(k)
		if (v === undefined) {
			v = cnt.length
			map.set(k, v)
			acc.push(0, 0, 0)
			cnt.push(0)
			if (uv) uv.push(m.uvs[2 * i], m.uvs[2 * i + 1])
		}
		acc[3 * v] += x
		acc[3 * v + 1] += y
		acc[3 * v + 2] += z
		cnt[v]++
		rem[i] = v
	}
	const idx = []
	const seen = new Set()
	for (let i = 0; i + 2 < m.indices.length; i += 3) {
		const a = rem[m.indices[i]], b = rem[m.indices[i + 1]], c = rem[m.indices[i + 2]]
		if (a === b || b === c || a === c) continue
		const s = [a, b, c].sort((p, q) => p - q).join(',')
		if (seen.has(s)) continue
		seen.add(s)
		idx.push(a, b, c)
	}
	const pos = new Float32Array(acc.length)
	for (let v = 0; v < cnt.length; v++) for (let j = 0; j < 3; j++) pos[3 * v + j] = acc[3 * v + j] / cnt[v]
	// drop the vertices no triangle uses
	const used = new Int32Array(cnt.length).fill(-1)
	const P2 = [], U2 = uv ? [] : null
	const I2 = new Uint32Array(idx.length)
	for (let i = 0; i < idx.length; i++) {
		const v = idx[i]
		if (used[v] < 0) {
			used[v] = P2.length / 3
			P2.push(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2])
			if (U2) U2.push(uv[2 * v], uv[2 * v + 1])
		}
		I2[i] = used[v]
	}
	const positions = new Float32Array(P2)
	return { positions, normals: smoothNormals(positions, I2), uvs: U2 ? new Float32Array(U2) : null, indices: I2 }
}

/** The finest cell (bisection, 1 mm … 2 m) at which `m` clusters to ≤ `target` triangles → { mesh, cell } (null: none). */
function clusterTo(m, target, { minCell = 0.001, maxCell = 2, steps = 12 } = {}) {
	let best
	let lo = minCell, hi = maxCell
	const top = cluster(m, hi)
	if (top.indices.length / 3 > target) return { mesh: top, cell: hi, over: true }
	best = { mesh: top, cell: hi }
	for (let i = 0; i < steps; i++) {
		const mid = Math.sqrt(lo * hi)
		const r = cluster(m, mid)
		if (r.indices.length / 3 <= target) {
			best = { mesh: r, cell: mid }
			hi = mid
		} else lo = mid
	}
	return best
}

/**
 * Water-fill `meshes` (welded, [{ key, mesh }]) under `budget` triangles. Buckets of the same group (`group`, e.g.
 * "Chandeliers|<material>") share one cell so every copy of a repeated part looks the same.
 * → { meshes (same order, simplified where needed), decimated: [{ key, trisIn, trisOut, cell }] }
 */
function fitBudget(items, budget, onStep = () => {}) {
	const tris = (m) => m.indices.length / 3
	const total = items.reduce((s, it) => s + tris(it.mesh), 0)
	const out = items.map((it) => it.mesh)
	const decimated = []
	if (!(budget > 0) || total <= budget) return { meshes: out, decimated, total, after: total }
	// groups: sum per group; water-fill over groups
	const groups = new Map()
	items.forEach((it, i) => {
		const g = it.group || it.key
		const e = groups.get(g) || groups.set(g, { g, list: [], tris: 0 }).get(g)
		e.list.push(i)
		e.tris += tris(it.mesh)
	})
	const order = [...groups.values()].sort((a, b) => a.tris - b.tris)
	let left = budget
	for (let gi = 0; gi < order.length; gi++) {
		const e = order[gi]
		const share = left / (order.length - gi)
		if (e.tris <= share) {
			left -= e.tris
			continue
		}
		// one cell for the whole group: bisect on the group's first (largest) member scaled by its fraction
		const per = share / e.tris
		const first = e.list.reduce((a, i) => (tris(items[i].mesh) > tris(items[a].mesh) ? i : a), e.list[0])
		const fit = clusterTo(items[first].mesh, Math.max(1, Math.floor(tris(items[first].mesh) * per)))
		let used = 0
		for (const i of e.list) {
			const m = i === first ? fit.mesh : cluster(items[i].mesh, fit.cell)
			out[i] = m
			used += tris(m)
			onStep(i)
		}
		decimated.push({ key: e.g, trisIn: e.tris, trisOut: used, cell: Math.round(fit.cell * 10000) / 10000 })
		left -= used
	}
	return { meshes: out, decimated, total, after: out.reduce((s, m) => s + tris(m), 0) }
}

module.exports = { weldBucket, cluster, fitBudget }
