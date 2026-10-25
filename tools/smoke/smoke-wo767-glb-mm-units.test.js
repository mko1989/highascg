'use strict'

/**
 * WO-767 — a GDTF mesh authored in mm with no unit scale (MAC Aura PXL: yoke.glb 409.9 units, declared 0.4099 m)
 * drew every head ~400 m wide and its pick box swallowed every click. The model route scales such a GLB to metres;
 * a model already in metres, or in mm with its own 0.001 node scale (Robe), is served unchanged.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { writeGlb } = require('../../src/stage/glb-write')
const { fixGlbUnits, glbExtent, parseGlb } = require('../../src/stage/glb-units')

const box = (side) =>
	writeGlb([{ name: 'body', primitives: [{ positions: new Float32Array([0, 0, 0, side, 0, 0, 0, side * 0.5, 0]), indices: new Uint32Array([0, 1, 2]), color: [0.2, 0.2, 0.2, 1] }] }])
const extent = (glb) => glbExtent(parseGlb(glb).json)

test('a mm model ~1000× its declared size is scaled to metres; the bytes stay a valid GLB', () => {
	const r = fixGlbUnits(box(409.936), 0.409936)
	assert.equal(r.scaled, true)
	assert.ok(Math.abs(extent(r.glb) - 0.409936) < 1e-4)
	assert.equal(r.glb.readUInt32LE(8), r.glb.length, 'header length')
	assert.equal(r.glb.readUInt32LE(12) % 4, 0, 'JSON chunk padded')
})

test('already metres, or mm with its own node scale: unchanged (idempotent)', () => {
	const m = box(0.41)
	assert.equal(fixGlbUnits(m, 0.41).scaled, false)
	const once = fixGlbUnits(box(409.9), 0.41).glb
	const twice = fixGlbUnits(once, 0.41)
	assert.equal(twice.scaled, false, 'the 0.001 node scale is measured through')
	assert.equal(twice.glb, once)
})

test('no declared size: only a mesh larger than any fixture body (> 20 m) is taken as mm', () => {
	assert.equal(fixGlbUnits(box(384), 0).scaled, true)
	assert.equal(fixGlbUnits(box(2.4), 0).scaled, false, 'a 2.4 m batten stays')
	assert.equal(fixGlbUnits(Buffer.from('not a glb'), 1).scaled, false)
})

test('wired: the fixture-type model route and GDTF meshes inside an MVR', () => {
	const route = fs.readFileSync(path.join(__dirname, '../../src/api/routes-fixture-types.js'), 'utf8')
	assert.match(route, /fixGlbUnits\(buf, declaredSize\(m\[1\], file\)\)\.glb/)
	const mvr = fs.readFileSync(path.join(__dirname, '../../src/stage/mvr-store.js'), 'utf8')
	assert.match(mvr, /out = fixGlbUnits\(out\)\.glb/)
})
