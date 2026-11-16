'use strict'
/**
 * WO-1098 — the OBJ venue importer's pure parts: the OBJ parser (triangles, quads, n-gons fan / ear-clipped, negative
 * indices, groups, materials, units comment, bad references), MTL (colours, d / Tr, map_Kd with spaces and options),
 * texture lookup (path, name, SketchUp "_N_" variant, normalised material name, .skp material folders, missing),
 * the room sort (up axis, units, floor / walls / ceiling sidedness), weld / degenerate / duplicate, the triangle budget,
 * and the GLB writer's rich path round-trip (materials, UVs, REPEAT sampler, root node, layer extension).
 */
const test = require('node:test')
const assert = require('node:assert')

const { parseObj, triangulate, createObjParser, UNIT_M } = require('../../src/stage/obj-parse')
const { parseMtl, mapPath, textureIndex, findTexture, skpMaterials, norm, pbrOf } = require('../../src/stage/obj-mtl')
const { classify, detectUp, unitsOf, instancesOf } = require('../../src/stage/venue-build')
const { weldBucket, cluster, fitBudget } = require('../../src/stage/venue-optimize')
const { writeGlb, readGlb } = require('../../src/stage/glb-write')

test('OBJ faces: triangle, quad, n-gon fan, concave ear clip, negative indices, v/vt/vn forms', () => {
	const o = parseObj([
		'# File units = inches', 'mtllib a b.mtl', 'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0', 'vt 0 0', 'vt 1 0', 'vt 1 1', 'vn 0 0 1',
		'o Room', 'g Wall_1 Base_1', 'usemtl Red', 's 1', 'f 1 2 3', 'f 1/1 2/2 3/3 4/1', 'f -4//1 -3//1 -2//1 -1//1',
		'v 2 0 0', 'v 2 2 0', 'v 1 2 0', 'v 1 1.5 0', 'v 0 1.5 0', 'v 0 2 0', 'v -1 2 0', 'v -1 0 0',
		'g Base_2', 'usemtl Blue', 'f 2 5 6 7 8 9 10 11 12 1', 'f 1 2 99', 'l 1 2',
	].join('\n'))
	assert.strictEqual(o.units, 'in')
	assert.deepStrictEqual(o.mtllibs, ['a b.mtl'], 'a library name with a space')
	assert.strictEqual(o.faces, 4, 'the face with a bad index is skipped, not a face')
	assert.strictEqual(o.skipped, 1)
	assert.strictEqual(o.ngons, 3, 'faces over 3 corners: two quads and the 10-gon')
	// 1 + 2 + 2 + (10-gon → 8)
	assert.strictEqual(o.tris.mat.length, 13)
	assert.strictEqual(o.concave, 1, 'the 10-gon notch is concave → ear clipping')
	assert.deepStrictEqual([...o.tris.v.slice(0, 3)], [0, 1, 2], '0-based')
	assert.deepStrictEqual([...o.tris.v.slice(9, 12)], [0, 1, 2], 'negative indices count back from the last vertex')
	assert.strictEqual(o.tris.vn[9], 0)
	assert.strictEqual(o.tris.vt[3], 0, 'quad v/vt')
	assert.strictEqual(o.tris.vn[3], -1, 'no normal given')
	assert.deepStrictEqual(o.materials, ['', 'Red', 'Blue'])
	assert.strictEqual(o.groups[o.tris.grp[0]], 'Wall_1 Base_1')
	assert.strictEqual(o.materials[o.tris.mat[12]], 'Blue')
	// ear clipping covers the polygon's area exactly (no triangle outside the notch)
	const P = o.v
	let area = 0
	for (let t = 5; t < 13; t++) {
		const [a, b, c] = [0, 1, 2].map((k) => o.tris.v[3 * t + k] * 3)
		area += ((P[b] - P[a]) * (P[c + 1] - P[a + 1]) - (P[c] - P[a]) * (P[b + 1] - P[a + 1])) / 2
	}
	assert.ok(Math.abs(Math.abs(area) - 5.5) < 1e-9, `area ${area}`)
	assert.strictEqual(UNIT_M.in, 0.0254)
})

test('OBJ streaming: chunks split anywhere give the same result; triangulate returns corner ids', () => {
	const text = 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n'
	const p = createObjParser()
	for (const ch of text.match(/.{1,3}/gs)) p.write(ch)
	const a = p.end(), b = parseObj(text)
	assert.deepStrictEqual([...a.tris.v], [...b.tris.v])
	assert.strictEqual(triangulate(new Float64Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), [0, 1, 2, 3]).length, 6)
})

test('MTL: colours, opacity (d / Tr), map_Kd options and spaces, roughness guess', () => {
	const m = parseMtl([
		'newmtl Glass', 'Kd 0.5 0.5 0.5', 'd 0.5', 'Ks 0.9 0.9 0.9',
		'newmtl Photo', 'Kd 1 1 1', 'Tr 0.25', 'map_Kd -s 1 1 1 -bm 0.5 Hilton DT Marcin1\\M 2015 01.jpg',
		'newmtl Plain', 'Ns 98',
	].join('\r\n'))
	assert.strictEqual(m.get('Glass').d, 0.5)
	assert.strictEqual(m.get('Photo').d, 0.75)
	assert.strictEqual(m.get('Photo').mapKd, 'Hilton DT Marcin1\\M 2015 01.jpg')
	assert.strictEqual(mapPath('-clamp on tex.png'), 'tex.png')
	assert.strictEqual(mapPath('1.jpg'), '1.jpg', 'a numeric file name is never eaten as an option value')
	assert.strictEqual(pbrOf(m.get('Glass')).roughness, 0.45)
	assert.strictEqual(pbrOf(m.get('Plain')).roughness, 0.14)
	assert.strictEqual(norm('Zasłona3'), 'zas_ona3')
	assert.strictEqual(norm('20150401_122228'), 'm_20150401_122228')
})

test('textures: path / name / variant / material name / .skp material folder / missing', () => {
	const f = (rel) => ({ rel, read: async () => Buffer.from(rel) })
	const files = [f('tex/Wall.JPG'), f('other/Carpet 1.png'), f('x.skp/materials/Zasłona2/Zasłona1.png'), f('x.skp/materials/20150401/20150401.jpg')]
	const skp = skpMaterials([
		['x.skp/materials/Zasłona3/material.xml', '<mat:material name="Zasłona3" x="1"><mat:image path="x.skp/materials/Zasłona2/Zasłona1.png" xScale="100" yScale="50"/></mat:material>'],
		['x.skp/materials/20150401/material.xml', '<mat:material name="20150401"><mat:image path="./20150401.jpg" xScale="10" yScale="10"/></mat:material>'],
	])
	assert.deepStrictEqual(skp.map((s) => s.image), ['x.skp/materials/Zasłona2/Zasłona1.png', 'x.skp/materials/20150401/20150401.jpg'])
	assert.deepStrictEqual(skp[0].tileM.map((v) => +v.toFixed(3)), [2.54, 1.27], 'inches → metres')
	const ix = textureIndex(files, skp)
	assert.strictEqual(findTexture(ix, 'tex\\wall.jpg', 'Wall').how, 'path', 'back slashes, any case')
	assert.strictEqual(findTexture(ix, 'gone/Carpet 1.png', 'C').file.rel, 'other/Carpet 1.png')
	assert.strictEqual(findTexture(ix, 'gone/Carpet 1.png', 'C').how, 'name')
	const v = findTexture(ix, 'Model/M_20150401_3_.jpg', 'M_20150401_3_')
	assert.deepStrictEqual([v.how, v.file.rel], ['variant', 'x.skp/materials/20150401/20150401.jpg'], 'the "_N_" copy → its base picture')
	const z = findTexture(ix, 'Model/Zas_ona3.png', 'Zas_ona3')
	assert.deepStrictEqual([z.how, z.file.rel], ['material', 'x.skp/materials/Zasłona2/Zasłona1.png'], 'SketchUp material folder by normalised name')
	assert.deepStrictEqual(z.tileM.map((x) => +x.toFixed(2)), [2.54, 1.27])
	assert.strictEqual(findTexture(ix, 'Model/Nope.jpg', 'Nope'), null, 'missing → null (reported, colour kept)')
})

/** A 10 × 4 × 8 m room (floor y 0, ceiling y 4), faces as an exporter writes them: floor facing down (outward). */
function roomObj(zUp = false, unit = '') {
	const V = [[0, 0, 0], [10, 0, 0], [10, 0, 8], [0, 0, 8], [0, 4, 0], [10, 4, 0], [10, 4, 8], [0, 4, 8]]
	const out = unit ? [`# File units = ${unit}`] : []
	const k = unit === 'inches' ? 1 / 0.0254 : 1
	for (const [x, y, z] of V) out.push(zUp ? `v ${x * k} ${-z * k} ${y * k}` : `v ${x * k} ${y * k} ${z * k}`)
	out.push('g Floor', 'f 1 2 3 4', 'g Ceiling', 'f 5 8 7 6', 'g Walls', 'f 1 5 6 2', 'f 2 6 7 3', 'f 3 7 8 4', 'f 4 8 5 1')
	return parseObj(out.join('\n'))
}

test('room sort: up axis, units, floor / ceiling / walls single-sided facing in', () => {
	for (const [zUp, unit] of [[false, ''], [true, ''], [false, 'inches']]) {
		const o = roomObj(zUp, unit)
		assert.strictEqual(detectUp(o), zUp ? 'z' : 'y')
		const c = classify(o, {})
		assert.strictEqual(c.up, zUp ? 'z' : 'y')
		assert.ok(Math.abs(c.bounds.max[0] - 10) < 1e-6 && Math.abs(c.bounds.max[1] - 4) < 1e-6, `metres, Y up (${unit || 'm'})`)
		assert.strictEqual(c.floorY, 0)
		assert.strictEqual(c.ceilingY, 4)
		const by = (l) => c.buckets.filter((b) => b.layer === l)
		assert.deepStrictEqual([by('Floor').length, by('Ceiling').length, by('Walls').length], [1, 1, 1])
		for (const b of c.buckets) assert.strictEqual(b.sided, 1, `${b.layer} single-sided`)
		// after the flip every face normal points into the room
		for (const b of c.buckets) for (const t of b.list) {
			const s = c.flip[t] ? -1 : 1
			const n = [c.fn[3 * t] * s, c.fn[3 * t + 1] * s, c.fn[3 * t + 2] * s]
			const P = c.P, a = o.tris.v[3 * t] * 3
			const toC = [5 - P[a], 2 - P[a + 1], 4 - P[a + 2]]
			assert.ok(n[0] * toC[0] + n[1] * toC[1] + n[2] * toC[2] > 0, `${b.layer} faces in`)
		}
	}
	assert.deepStrictEqual(unitsOf({ units: '', generator: 'SketchUp' }), { unit: 'in', scale: 0.0254, source: 'default' })
	assert.strictEqual(unitsOf({ units: 'in' }, 'mm').unit, 'mm', 'the operator\'s choice wins')
	assert.deepStrictEqual(instancesOf(['Part_3 Lamp_1', 'Part_9 Lamp_2', 'Wall_1']), ['Lamp_1', 'Lamp_2', ''])
})

test('weld, degenerate and duplicate faces; budget water-fill keeps small parts, one cell per group', () => {
	const o = parseObj('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nv 0.5 0 0\nf 1 2 3\nf 1 3 4\nf 1 2 3\nf 1 5 2\n')
	const c = classify(o, { up: 'y' })
	const all = { node: 'x', layer: 'Objects', mat: 0, sided: 2, list: Int32Array.from([0, 1, 2, 3]) }
	const m = weldBucket(c, o, all)
	assert.strictEqual(m.indices.length / 3, 2)
	assert.strictEqual(m.duplicate, 1)
	assert.strictEqual(m.degenerate, 1, 'zero area')
	assert.strictEqual(m.positions.length / 3, 4, 'shared corners welded')
	// a dense sphere-ish grid: budget
	const grid = (n, off) => {
		const pos = [], idx = []
		for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) pos.push(off + i / n, Math.sin(i / 3) * 0.2, j / n)
		for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
			const a = i * (n + 1) + j
			idx.push(a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1)
		}
		return { positions: new Float32Array(pos), normals: new Float32Array(pos.length), indices: new Uint32Array(idx), uvs: null }
	}
	const items = [{ key: 'small', mesh: grid(2, 0) }, { key: 'c1', group: 'C', mesh: grid(60, 5) }, { key: 'c2', group: 'C', mesh: grid(60, 9) }]
	const r = fitBudget(items, 2000)
	assert.ok(r.after <= 2000, `${r.after} ≤ budget`)
	assert.strictEqual(r.meshes[0], items[0].mesh, 'the small part is untouched')
	assert.strictEqual(r.meshes[1].indices.length, r.meshes[2].indices.length, 'both copies alike')
	assert.strictEqual(r.decimated.length, 1)
	assert.strictEqual(r.decimated[0].trisIn, 14400)
	assert.strictEqual(cluster(grid(4, 0), 10).indices.length, 0, 'a huge cell collapses everything')
})

test('GLB writer rich path: materials, UVs, REPEAT sampler, root node, extension — round trip', () => {
	const tri = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), indices: new Uint32Array([0, 1, 2]) }
	const png = Buffer.from('89504e470d0a1a0a', 'hex')
	const materials = new Map([
		['Photo', { color: [1, 1, 1, 1], image: { data: png, mime: 'image/png' }, doubleSided: false, alpha: 'BLEND', roughness: 0.8, metallic: 0 }],
		['Plain', { color: [0.5, 0.25, 0.1, 1], doubleSided: true, roughness: 0.9, metallic: 0 }],
	])
	const glb = writeGlb([
		{ name: 'Walls', primitives: [{ ...tri, uvs: new Float32Array([0, 0, 3, 0, 0, 3]), material: 'Photo' }, { ...tri, uvs: new Float32Array([0, 0, 1, 0, 0, 1]), material: 'Plain' }],
			node: { extensions: { HIGHASCG_venue: { layer_identifier: 'venue-layer-walls' } } } },
	], { materials, root: { name: 'venue', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 3, 1] },
		asset: { extensions: { HIGHASCG_venue: { layers: [{ identifier: 'venue-layer-walls', name: 'Walls' }] } } }, extensionsUsed: ['HIGHASCG_venue'] })
	const { json, bin } = readGlb(glb)
	assert.deepStrictEqual(json.extensionsUsed, ['HIGHASCG_venue'])
	assert.strictEqual(json.asset.extensions.HIGHASCG_venue.layers[0].name, 'Walls')
	const root = json.nodes[json.scenes[0].nodes[0]]
	assert.strictEqual(root.name, 'venue')
	assert.deepStrictEqual(root.matrix.slice(12, 15), [2, 0, 3])
	const child = json.nodes[root.children[0]]
	assert.strictEqual(child.extensions.HIGHASCG_venue.layer_identifier, 'venue-layer-walls')
	const prims = json.meshes[child.mesh].primitives
	assert.ok(prims[0].attributes.TEXCOORD_0 != null, 'textured: UVs kept')
	assert.strictEqual(prims[1].attributes.TEXCOORD_0, undefined, 'untextured: no UVs written')
	const mPhoto = json.materials[prims[0].material]
	assert.strictEqual(mPhoto.alphaMode, 'BLEND')
	assert.strictEqual(json.samplers[json.textures[mPhoto.pbrMetallicRoughness.baseColorTexture.index].sampler].wrapS, 10497, 'REPEAT: big SketchUp UVs tile')
	assert.strictEqual(json.materials[prims[1].material].doubleSided, true)
	const img = json.images[0]
	assert.strictEqual(img.mimeType, 'image/png')
	const v = json.bufferViews[img.bufferView]
	assert.deepStrictEqual(Buffer.from(bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength)), png)
	// the plain path is unchanged: no materials option → one default node per mesh, no samplers
	const plain = readGlb(writeGlb([{ name: 'a', primitives: [tri] }])).json
	assert.strictEqual(plain.samplers, undefined)
	assert.strictEqual(plain.nodes.length, 1)
})
