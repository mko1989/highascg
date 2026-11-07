'use strict'
/** WO-994 — 3DS normals keep hard edges (crease angle / smoothing groups) instead of one averaged normal per vertex. */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { creaseNormals, DEFAULT_ANGLE } = require('../../src/stage/mesh-crease')

// Unit cube, 8 shared corners, 12 outward triangles — the shape Capture exports for a table top.
const CUBE_P = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1])
const CUBE_I = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]

function cylinder(seg) {
	const p = []
	const idx = []
	for (let i = 0; i < seg; i++) {
		const a = (i / seg) * Math.PI * 2
		p.push(Math.cos(a), Math.sin(a), 0, Math.cos(a), Math.sin(a), 1)
	}
	for (let i = 0; i < seg; i++) {
		const j = (i + 1) % seg
		idx.push(i * 2, j * 2, j * 2 + 1, i * 2, j * 2 + 1, i * 2 + 1)
	}
	return { p: new Float32Array(p), idx }
}

const axisAligned = (n) => {
	for (let k = 0; k < n.length; k += 3) {
		const m = [Math.abs(n[k]), Math.abs(n[k + 1]), Math.abs(n[k + 2])].sort((a, b) => b - a)
		if (Math.abs(m[0] - 1) > 1e-6 || m[1] > 1e-6) return false
	}
	return true
}

test('a cube keeps its edges: 24 corners, every normal on an axis, pointing out', () => {
	const r = creaseNormals(CUBE_P, CUBE_I)
	assert.strictEqual(r.positions.length / 3, 24)
	assert.strictEqual(r.indices.length, 36)
	assert.ok(axisAligned(r.normals), 'no averaged diagonal normals')
	for (let v = 0; v < 24; v++) {
		const d = (r.positions[v * 3] - 0.5) * r.normals[v * 3] + (r.positions[v * 3 + 1] - 0.5) * r.normals[v * 3 + 1] +
			(r.positions[v * 3 + 2] - 0.5) * r.normals[v * 3 + 2]
		assert.ok(d > 0, 'outward')
	}
})

test('a 16-sided cylinder stays smooth (22.5° < crease angle), an 8-sided prism (45°) goes faceted', () => {
	assert.ok(DEFAULT_ANGLE > 22.5 && DEFAULT_ANGLE < 45)
	const c16 = cylinder(16)
	assert.strictEqual(creaseNormals(c16.p, c16.idx).positions.length / 3, 32, 'no split vertices')
	const c8 = cylinder(8)
	assert.strictEqual(creaseNormals(c8.p, c8.idx).positions.length / 3, 32, 'every vertex split in two (8 × 2 × 2)')
})

test("a vertex the file split itself stays a hard edge, even in one smoothing group (GDTF bodies)", () => {
	// The cube with its own 24 corners (4 per side), every face in group 1: still 24 corners, axis normals.
	const p = []
	const idx = []
	for (let f = 0; f < CUBE_I.length; f += 6) {
		const quad = [...new Set(CUBE_I.slice(f, f + 6))]
		const base = p.length / 3
		for (const v of quad) p.push(...CUBE_P.slice(v * 3, v * 3 + 3))
		for (const v of CUBE_I.slice(f, f + 6)) idx.push(base + quad.indexOf(v))
	}
	const r = creaseNormals(new Float32Array(p), idx, { smoothing: new Uint32Array(12).fill(1) })
	assert.strictEqual(r.positions.length / 3, 24)
	assert.ok(axisAligned(r.normals))
})

test('angle-weighted: a cylinder whose quads are split in two triangles still gets radial normals', () => {
	const c = cylinder(16)
	const r = creaseNormals(c.p, c.idx)
	for (let v = 0; v < r.positions.length / 3; v++) {
		const dot = r.positions[v * 3] * r.normals[v * 3] + r.positions[v * 3 + 1] * r.normals[v * 3 + 1]
		assert.ok(dot > 0.9999, 'normal is the radial direction, not pulled towards one facet')
	}
})

test('3DS smoothing groups win over the angle: mask 0 = flat, a shared bit = smooth', () => {
	const c = cylinder(16)
	const flat = creaseNormals(c.p, c.idx, { smoothing: new Uint32Array(32) })
	assert.strictEqual(flat.positions.length / 3, 64, 'mask 0 → every face its own normal')
	const one = creaseNormals(CUBE_P, CUBE_I, { smoothing: new Uint32Array(12).fill(1) })
	assert.strictEqual(one.positions.length / 3, 8, 'one group → smooth even at 90°')
})

test('degenerate faces do not produce NaN normals', () => {
	const r = creaseNormals(new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]), [0, 1, 2])
	assert.ok([...r.normals].every(Number.isFinite))
})

test('the 3DS converter uses it, smoothing groups included', () => {
	const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src/stage/mvr-3ds.js'), 'utf8')
	assert.match(src, /creaseNormals\(glPos, src, \{ smoothing \}\)/)
	assert.match(src, /g\.id === 0x4150/)
})
