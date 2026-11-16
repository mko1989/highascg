'use strict'

/**
 * WO-1098 — a parsed OBJ (obj-parse.js) → the venue's parts in glTF terms (Y up, metres): which layer each triangle
 * belongs to, which way it faces, and the welded, de-duplicated buckets (one per layer node × material × sidedness).
 * Decimation is venue-optimize.js; textures and the GLB are venue-convert.js. Pure.
 *
 * Units: option > the file's "# File units = …" comment > SketchUp's default (inches) for a SketchUp export, else metres.
 * Up axis: option ('y' | 'z') > detected — the axis whose faces carry the most area (a room's floor and ceiling).
 *
 * Layers (glTF nodes the previs toggles like MVR layers, WO-1003 venue model):
 *   Chandeliers — repeated component instances (SketchUp "Name_1", "Name_2" …) hanging in the upper half of the room
 *                 and carrying ≥ 200 triangles each; one node per instance;
 *   Floor       — level faces at the floor (the lowest level holding ≥ 25 % of the footprint);
 *   Ceiling     — everything from the lowest large downward-facing level in the upper half up;
 *   Walls       — the rest within 1 m of the room's side planes;
 *   Objects     — the rest (free-standing things: a stage, columns, furniture).
 *
 * Sidedness (the previs convention: a room shell is one-sided facing in, so a camera outside sees in; inside, nothing
 * of the room disappears): Floor faces up, level Ceiling faces face down, wall faces lying on the room's side planes face
 * in — all single-sided; every other face is drawn double-sided (pilasters, coffer sides, curtains, chandeliers).
 * SketchUp exports the room's floor facing down and its walls mixed, so the winding of a shell face is FIXED here, not
 * trusted.
 */

const { UNIT_M } = require('./obj-parse')

const LAYERS = ['Floor', 'Walls', 'Ceiling', 'Chandeliers', 'Objects']
const LEVEL = 0.98 // |ny| over this: a level face
const WALL_BAND = 1.5 // m from a side plane: Walls, not Objects
const ON_PLANE = 0.1 // m: a wall face lying on the side plane (single-sided, facing in)

/** Detected up axis of raw OBJ coordinates: 'y' | 'z' (area of faces whose normal lies along each axis). */
function detectUp(obj) {
	const V = obj.v, T = obj.tris.v
	let ay = 0, az = 0
	for (let t = 0; t < T.length; t += 3) {
		const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3
		const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2]
		const wx = V[c] - V[a], wy = V[c + 1] - V[a + 1], wz = V[c + 2] - V[a + 2]
		const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx
		const l = Math.hypot(nx, ny, nz)
		if (!l) continue
		if (Math.abs(ny) > LEVEL * l) ay += l
		if (Math.abs(nz) > LEVEL * l) az += l
	}
	return az > ay ? 'z' : 'y'
}

/** Units → { unit, scale, source }. */
function unitsOf(obj, opt) {
	if (opt && UNIT_M[opt]) return { unit: opt, scale: UNIT_M[opt], source: 'option' }
	if (obj.units && UNIT_M[obj.units]) return { unit: obj.units, scale: UNIT_M[obj.units], source: 'file' }
	const unit = /sketchup/i.test(obj.generator || '') ? 'in' : 'm'
	return { unit, scale: UNIT_M[unit], source: 'default' }
}

/** Positions / normals in glTF frame (Y up, metres) as Float64Arrays. */
function toFrame(obj, scale, up) {
	const n = obj.v.length / 3
	const P = new Float64Array(n * 3)
	for (let i = 0; i < n; i++) {
		const x = obj.v[3 * i] * scale, y = obj.v[3 * i + 1] * scale, z = obj.v[3 * i + 2] * scale
		P[3 * i] = x
		P[3 * i + 1] = up === 'z' ? z : y
		P[3 * i + 2] = up === 'z' ? -y : z
	}
	const m = obj.vn.length / 3
	const N = new Float64Array(m * 3)
	for (let i = 0; i < m; i++) {
		const x = obj.vn[3 * i], y = obj.vn[3 * i + 1], z = obj.vn[3 * i + 2]
		const l = Math.hypot(x, y, z) || 1
		N[3 * i] = x / l
		N[3 * i + 1] = (up === 'z' ? z : y) / l
		N[3 * i + 2] = (up === 'z' ? -y : z) / l
	}
	return { P, N }
}

/** Repeated component instances: group-name token "Base_N" whose Base has ≥ 2 instances → per group id the root-most one. */
function instancesOf(groups) {
	const bases = new Map() // base → Set(N)
	const toks = groups.map((g) => String(g).split(/\s+/))
	for (const t of toks) for (const w of t) {
		const m = /^(.+)_(\d+)$/.exec(w)
		if (m) (bases.get(m[1]) || bases.set(m[1], new Set()).get(m[1])).add(m[2])
	}
	return toks.map((t) => {
		for (let i = t.length - 1; i >= 0; i--) {
			const m = /^(.+)_(\d+)$/.exec(t[i])
			if (m && bases.get(m[1]).size >= 2) return t[i]
		}
		return ''
	})
}

/**
 * Classify + orient + bucket. → { bounds, floorY, ceilingY, up, units, layers: { name: tris }, buckets: [{ node, layer,
 * mat (index), sided: 1|2, tris: Int32Array of corner ids (3 per triangle, into `corners`) }], P, N, corners: { v, vt,
 * vn, flip: Uint8Array per triangle } }
 */
function classify(obj, opts = {}) {
	const units = unitsOf(obj, opts.units)
	const up = opts.up === 'y' || opts.up === 'z' ? opts.up : detectUp(obj)
	const { P, N } = toFrame(obj, units.scale, up)
	const T = obj.tris, nt = T.mat.length
	// face normals, areas, centroids, bounds
	const fn = new Float64Array(nt * 3), area = new Float64Array(nt), cy = new Float64Array(nt)
	const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
	for (let t = 0; t < nt; t++) {
		const a = T.v[3 * t] * 3, b = T.v[3 * t + 1] * 3, c = T.v[3 * t + 2] * 3
		const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2]
		const wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2]
		const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx
		const l = Math.hypot(nx, ny, nz)
		area[t] = l / 2
		if (l) {
			fn[3 * t] = nx / l
			fn[3 * t + 1] = ny / l
			fn[3 * t + 2] = nz / l
		}
		cy[t] = (P[a + 1] + P[b + 1] + P[c + 1]) / 3
		for (const k of [a, b, c]) for (let j = 0; j < 3; j++) {
			if (P[k + j] < lo[j]) lo[j] = P[k + j]
			if (P[k + j] > hi[j]) hi[j] = P[k + j]
		}
	}
	if (!nt) return { empty: true, units, up, buckets: [], layers: {}, P, N }
	const footprint = Math.max(1e-9, (hi[0] - lo[0]) * (hi[2] - lo[2]))
	// level-face area by height (1 cm bins): floor = lowest level ≥ 25 % footprint, ceiling = lowest level ≥ 10 %
	// footprint in the upper half (either facing: exporters write room faces pointing out as often as in)
	const levels = new Map()
	for (let t = 0; t < nt; t++) {
		if (Math.abs(fn[3 * t + 1]) <= LEVEL) continue
		const k = Math.round(cy[t] * 100)
		levels.set(k, (levels.get(k) || 0) + area[t])
	}
	const sortedK = (m) => [...m.keys()].sort((a, b) => a - b)
	const floorK = sortedK(levels).find((k) => levels.get(k) >= 0.25 * footprint)
	const floorY = floorK != null ? floorK / 100 : lo[1]
	const mid = (floorY + hi[1]) / 2
	const ceilK = sortedK(levels).find((k) => k / 100 > mid && levels.get(k) >= 0.1 * footprint)
	const ceilingY = ceilK != null ? ceilK / 100 : hi[1]
	// chandeliers: repeated instances in the upper half, ≥ 200 triangles each
	const inst = instancesOf(obj.groups)
	const instStat = new Map()
	for (let t = 0; t < nt; t++) {
		const key = inst[T.grp[t]]
		if (!key) continue
		const s = instStat.get(key) || instStat.set(key, { n: 0, minY: Infinity, x: 0, z: 0 }).get(key)
		s.n++
		for (let k = 0; k < 3; k++) {
			const vi = T.v[3 * t + k] * 3
			s.minY = Math.min(s.minY, P[vi + 1])
			s.x += P[vi] / 3
			s.z += P[vi + 2] / 3
		}
	}
	const hanging = (key) => {
		const s = key && instStat.get(key)
		return !!s && s.n >= 200 && s.minY > mid
	}
	const layer = new Uint8Array(nt), flip = new Uint8Array(nt), sided = new Uint8Array(nt), node = new Array(nt)
	const L = Object.fromEntries(LAYERS.map((n, i) => [n, i]))
	const counts = Object.fromEntries(LAYERS.map((n) => [n, 0]))
	for (let t = 0; t < nt; t++) {
		const ny = fn[3 * t + 1]
		const key = inst[T.grp[t]]
		let ly, s = 2, f = 0
		let minY = Infinity
		for (let k = 0; k < 3; k++) minY = Math.min(minY, P[T.v[3 * t + k] * 3 + 1])
		if (hanging(key)) ly = L.Chandeliers
		else if (Math.abs(ny) > LEVEL && Math.abs(cy[t] - floorY) < 0.05) {
			ly = L.Floor
			s = 1
			f = ny < 0 ? 1 : 0
		} else if (minY >= ceilingY - 0.02 && ceilK != null) {
			ly = L.Ceiling
			if (Math.abs(ny) > LEVEL) {
				s = 1
				f = ny > 0 ? 1 : 0
			}
		} else {
			const a = T.v[3 * t] * 3, b = T.v[3 * t + 1] * 3, c = T.v[3 * t + 2] * 3
			const cx = (P[a] + P[b] + P[c]) / 3, cz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3
			const d = [cx - lo[0], hi[0] - cx, cz - lo[2], hi[2] - cz]
			const near = Math.min(...d)
			ly = near <= WALL_BAND ? L.Walls : L.Objects
			const i = d.indexOf(near)
			const nx = fn[3 * t], nz = fn[3 * t + 2]
			const along = i < 2 ? nx : nz
			if (ly === L.Walls && near <= ON_PLANE && Math.abs(along) > LEVEL) {
				s = 1
				const inward = i === 0 || i === 2 ? 1 : -1 // the min plane faces +, the max plane faces −
				f = along * inward < 0 ? 1 : 0
			}
		}
		layer[t] = ly
		sided[t] = s
		flip[t] = f
		node[t] = ly === L.Chandeliers ? `Chandeliers ${key}` : LAYERS[ly]
		counts[LAYERS[ly]]++
	}
	// buckets: node × material × sidedness
	const byKey = new Map()
	for (let t = 0; t < nt; t++) {
		const k = `${node[t]}\u0000${T.mat[t]}\u0000${sided[t]}`
		let b = byKey.get(k)
		if (!b) byKey.set(k, (b = { node: node[t], layer: LAYERS[layer[t]], mat: T.mat[t], sided: sided[t], list: [] }))
		b.list.push(t)
	}
	const buckets = [...byKey.values()].map((b) => ({ ...b, list: Int32Array.from(b.list) }))
	// instance nodes get readable names: "Chandelier 1" … by position (rows along x, then along z)
	const hang = [...new Set(buckets.filter((b) => b.layer === 'Chandeliers').map((b) => b.node))]
	const at = (n) => instStat.get(n.slice('Chandeliers '.length))
	const c = (n, k) => at(n)[k] / at(n).n
	hang.sort((a, b) => Math.round(c(a, 'x')) - Math.round(c(b, 'x')) || c(a, 'z') - c(b, 'z'))
	const nice = new Map(hang.map((n, i) => [n, `Chandelier ${i + 1}`]))
	for (const b of buckets) if (nice.has(b.node)) b.node = nice.get(b.node)
	return { units, up, P, N, fn, flip, area, buckets, layers: counts, floorY, ceilingY,
		bounds: { min: lo, max: hi }, triangles: nt }
}

module.exports = { LAYERS, classify, detectUp, unitsOf, instancesOf }
