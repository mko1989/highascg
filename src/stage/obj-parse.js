'use strict'

/**
 * WO-1098 — our own Wavefront OBJ reader (no third-party library: OBJ is a plain text format). Streaming: feed it text
 * chunks (`write`) and it keeps only the parsed numbers — a 77 MB SketchUp export is never one string.
 *
 *   const p = createObjParser(); p.write(text) …; const obj = p.end()
 *   obj = { v: Float64Array (xyz), vt: Float64Array (uv), vn: Float64Array (xyz), tris: { v, vt, vn: Int32Array (3 per
 *           triangle, -1 = none), mat, grp: Uint32Array (1 per triangle) }, materials: string[], groups: string[],
 *           mtllibs: string[], units: 'm'|'in'|'mm'|'cm'|'ft'|'' (from "# File units = …"), generator ("# Exported
 *           from SketchUp, …" → 'SketchUp'), faces, ngons, concave,
 *           skipped (faces with a missing / out-of-range index), lines }
 *
 * Faces: triangles, quads and n-gons (a convex polygon is fanned; a concave one is ear-clipped in the plane of its
 * Newell normal), `v`, `v/vt`, `v//vn`, `v/vt/vn`, negative (relative) indices. `g` (the whole name list — SketchUp
 * writes the instance chain "Mesh1 Group3 … Model"), `o`, `usemtl`, `mtllib` (file names may hold spaces), `s` ignored
 * (the vn give the hard edges). Other statements (l, p, curv …) are skipped.
 */

const UNITS = { meters: 'm', meter: 'm', m: 'm', inches: 'in', inch: 'in', in: 'in', millimeters: 'mm', millimeter: 'mm', mm: 'mm',
	centimeters: 'cm', centimeter: 'cm', cm: 'cm', feet: 'ft', foot: 'ft', ft: 'ft' }
const UNIT_M = { m: 1, in: 0.0254, mm: 0.001, cm: 0.01, ft: 0.3048 }

/** A growable typed array. */
class Grow {
	constructor(T, n = 1024) {
		this.T = T
		this.a = new T(n)
		this.n = 0
	}
	push(x) {
		if (this.n === this.a.length) {
			const b = new this.T(this.a.length * 2)
			b.set(this.a)
			this.a = b
		}
		this.a[this.n++] = x
	}
	done() {
		return this.a.slice(0, this.n)
	}
}

/**
 * Triangulate polygon `poly` (vertex indices into `v`, xyz) → corner positions in the polygon, 3 per triangle.
 * Convex → fan from 0; otherwise ear clipping projected on the plane that drops the Newell normal's largest axis.
 */
function triangulate(v, poly) {
	const n = poly.length
	if (n === 3) return [0, 1, 2]
	let nx = 0, ny = 0, nz = 0
	for (let i = 0; i < n; i++) {
		const a = poly[i] * 3, b = poly[(i + 1) % n] * 3
		nx += (v[a + 1] - v[b + 1]) * (v[a + 2] + v[b + 2])
		ny += (v[a + 2] - v[b + 2]) * (v[a] + v[b])
		nz += (v[a] - v[b]) * (v[a + 1] + v[b + 1])
	}
	const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz)
	// 2D axes (u, w) and the sign that makes a counter-clockwise polygon positive
	const [iu, iw, s] = az >= ax && az >= ay ? [0, 1, Math.sign(nz) || 1] : ax >= ay ? [1, 2, Math.sign(nx) || 1] : [2, 0, Math.sign(ny) || 1]
	const P = (k) => [v[poly[k] * 3 + iu], v[poly[k] * 3 + iw]]
	const cross = (a, b, c) => ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) * s
	const pts = poly.map((_, k) => P(k))
	let convex = true
	for (let i = 0; i < n && convex; i++) if (cross(pts[i], pts[(i + 1) % n], pts[(i + 2) % n]) < -1e-12) convex = false
	const out = []
	if (convex) {
		for (let i = 1; i + 1 < n; i++) out.push(0, i, i + 1)
		return out
	}
	out.concave = true
	const idx = [...Array(n).keys()]
	const inside = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0
	let guard = 0
	while (idx.length > 3 && guard++ < n * n) {
		let clipped = false
		for (let i = 0; i < idx.length; i++) {
			const i0 = idx[(i + idx.length - 1) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length]
			const a = pts[i0], b = pts[i1], c = pts[i2]
			if (cross(a, b, c) <= 1e-12) continue // reflex or flat corner: not an ear
			let ear = true
			for (const j of idx) {
				if (j === i0 || j === i1 || j === i2) continue
				if (inside(pts[j], a, b, c)) {
					ear = false
					break
				}
			}
			if (!ear) continue
			out.push(i0, i1, i2)
			idx.splice(i, 1)
			clipped = true
			break
		}
		if (!clipped) break // degenerate / self-intersecting: fan the rest
	}
	for (let i = 1; i + 1 < idx.length; i++) out.push(idx[0], idx[i], idx[i + 1])
	return out
}

function createObjParser() {
	const v = new Grow(Float64Array, 1 << 16)
	const vt = new Grow(Float64Array, 1 << 12)
	const vn = new Grow(Float64Array, 1 << 12)
	const tv = new Grow(Int32Array, 1 << 16), tt = new Grow(Int32Array, 1 << 16), tn = new Grow(Int32Array, 1 << 16)
	const tmat = new Grow(Uint32Array, 1 << 14), tgrp = new Grow(Uint32Array, 1 << 14)
	const materials = [''], matIds = new Map([['', 0]])
	const groups = [''], grpIds = new Map([['', 0]])
	const mtllibs = []
	let mat = 0, grp = 0, units = '', generator = '', faces = 0, ngons = 0, concave = 0, skipped = 0, lines = 0
	let rest = ''
	const intern = (list, ids, s) => {
		let i = ids.get(s)
		if (i === undefined) {
			i = list.length
			list.push(s)
			ids.set(s, i)
		}
		return i
	}
	const ref = (s, count) => {
		if (s === undefined || s === '') return -1
		const i = parseInt(s, 10)
		if (!Number.isFinite(i) || i === 0) return -2
		const k = i > 0 ? i - 1 : count + i
		return k >= 0 && k < count ? k : -2
	}
	const face = (parts) => {
		const n = parts.length - 1
		if (n < 3) return void skipped++
		const pv = new Array(n), pt = new Array(n), pn = new Array(n)
		const nv = v.n / 3, nt = vt.n / 2, nn = vn.n / 3
		for (let i = 0; i < n; i++) {
			const c = parts[i + 1].split('/')
			pv[i] = ref(c[0], nv)
			pt[i] = ref(c[1], nt)
			pn[i] = ref(c[2], nn)
			if (pv[i] < 0 || pt[i] === -2 || pn[i] === -2) return void skipped++
		}
		faces++
		if (n > 3) ngons++
		const corners = triangulate(v.a, pv)
		if (corners.concave) concave++
		for (let k = 0; k < corners.length; k++) {
			const c = corners[k]
			tv.push(pv[c])
			tt.push(pt[c])
			tn.push(pn[c])
			if (k % 3 === 2) {
				tmat.push(mat)
				tgrp.push(grp)
			}
		}
	}
	const line = (raw) => {
		lines++
		const s = raw.trim()
		if (!s) return
		if (s[0] === '#') {
			const m = /^#\s*File units\s*=\s*([A-Za-z]+)/i.exec(s)
			if (m) units = UNITS[m[1].toLowerCase()] || units
			const g = /^#\s*Exported from\s+([^,(]+)/i.exec(s)
			if (g && !generator) generator = g[1].trim()
			return
		}
		const sp = s.indexOf(' ')
		const kw = sp < 0 ? s : s.slice(0, sp)
		const arg = sp < 0 ? '' : s.slice(sp + 1).trim()
		if (kw === 'v') {
			const p = arg.split(/\s+/)
			v.push(+p[0] || 0)
			v.push(+p[1] || 0)
			v.push(+p[2] || 0)
		} else if (kw === 'vt') {
			const p = arg.split(/\s+/)
			vt.push(+p[0] || 0)
			vt.push(+p[1] || 0)
		} else if (kw === 'vn') {
			const p = arg.split(/\s+/)
			vn.push(+p[0] || 0)
			vn.push(+p[1] || 0)
			vn.push(+p[2] || 0)
		} else if (kw === 'f') face(s.split(/\s+/))
		else if (kw === 'usemtl') mat = intern(materials, matIds, arg)
		else if (kw === 'g' || kw === 'o') grp = intern(groups, grpIds, arg)
		else if (kw === 'mtllib' && arg) mtllibs.push(arg)
	}
	return {
		/** Feed text; a partial last line is kept for the next call. */
		write(text) {
			const s = rest + text
			let at = 0
			for (;;) {
				const nl = s.indexOf('\n', at)
				if (nl < 0) break
				line(s.slice(at, nl))
				at = nl + 1
			}
			rest = s.slice(at)
		},
		end() {
			if (rest) line(rest)
			rest = ''
			return { v: v.done(), vt: vt.done(), vn: vn.done(), tris: { v: tv.done(), vt: tt.done(), vn: tn.done(), mat: tmat.done(), grp: tgrp.done() },
				materials, groups, mtllibs, units, generator, faces, ngons, concave, skipped, lines }
		},
		/** progress counters while parsing */
		stats: () => ({ lines, faces, vertices: v.n / 3, triangles: tmat.n }),
	}
}

/** Parse a whole OBJ text (tests, small files). */
function parseObj(text) {
	const p = createObjParser()
	p.write(String(text))
	return p.end()
}

module.exports = { createObjParser, parseObj, triangulate, UNIT_M }
