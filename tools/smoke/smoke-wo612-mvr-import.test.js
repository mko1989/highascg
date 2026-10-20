'use strict'

/**
 * WO-612 — MVR import for the Godot previs: transforms (MVR mm Z-up → Godot m Y-up), 3DS → GLB, scene walk (groups,
 * Symbol → Symdef, fixtures through nested GDTF, a missing GDTF → box), the store (projects/_mvr, test-isolated) and
 * the /api/stage/mvr routes with a real multipart upload. The archives are built here (stored ZIP entries).
 */

const { test } = require('node:test')
const assert = require('node:assert')
const zlib = require('zlib')
const { Readable } = require('stream')
const { mvrMatrix, gdtfMatrix, toGodot, IDENTITY } = require('../../src/stage/mvr-math')
const { threeDsToGlb } = require('../../src/stage/mvr-3ds')
const { writeGlb, readGlb, embedGlbImages } = require('../../src/stage/glb-write')
const store = require('../../src/stage/mvr-store')
const { RouteRegistry } = require('../../src/api/route-registry')
const { register } = require('../../src/api/routes-stage-mvr')

function zip(files) {
	const locals = []
	const central = []
	let at = 0
	for (const [name, data] of Object.entries(files)) {
		const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
		const n = Buffer.from(name)
		const crc = zlib.crc32(buf)
		const h = Buffer.alloc(30)
		h.writeUInt32LE(0x04034b50, 0)
		h.writeUInt16LE(20, 4)
		h.writeUInt32LE(crc, 14)
		h.writeUInt32LE(buf.length, 18)
		h.writeUInt32LE(buf.length, 22)
		h.writeUInt16LE(n.length, 26)
		const c = Buffer.alloc(46)
		c.writeUInt32LE(0x02014b50, 0)
		c.writeUInt16LE(20, 4)
		c.writeUInt16LE(20, 6)
		c.writeUInt32LE(crc, 16)
		c.writeUInt32LE(buf.length, 20)
		c.writeUInt32LE(buf.length, 24)
		c.writeUInt16LE(n.length, 28)
		c.writeUInt32LE(at, 42)
		locals.push(h, n, buf)
		central.push(c, n)
		at += 30 + n.length + buf.length
	}
	const cd = Buffer.concat(central)
	const end = Buffer.alloc(22)
	end.writeUInt32LE(0x06054b50, 0)
	end.writeUInt16LE(Object.keys(files).length, 8)
	end.writeUInt16LE(Object.keys(files).length, 10)
	end.writeUInt32LE(cd.length, 12)
	end.writeUInt32LE(at, 16)
	return Buffer.concat([...locals, cd, end])
}

/** A 3DS file: one object, one triangle (mm, Z-up), material "red". */
function tiny3ds() {
	const ch = (id, ...body) => {
		const b = Buffer.concat(body)
		const h = Buffer.alloc(6)
		h.writeUInt16LE(id, 0)
		h.writeUInt32LE(6 + b.length, 2)
		return Buffer.concat([h, b])
	}
	const u16 = (...v) => Buffer.from(new Uint16Array(v).buffer)
	const f32 = (...v) => Buffer.from(new Float32Array(v).buffer)
	const mat = ch(0xafff, ch(0xa000, Buffer.from('red\0')), ch(0xa020, ch(0x0011, Buffer.from([255, 0, 0]))))
	const verts = ch(0x4110, u16(3), f32(0, 0, 0, 1000, 0, 0, 0, 0, 1800))
	const faces = ch(0x4120, u16(1, 0, 1, 2, 0), ch(0x4130, Buffer.from('red\0'), u16(1, 0)))
	return ch(0x4d4d, ch(0x3d3d, mat, ch(0x4000, Buffer.from('person\0'), ch(0x4100, verts, faces))))
}

const cubeGlb = () => writeGlb([{ name: 'c', primitives: [{ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) }] }])

function sampleMvr() {
	const gdtf = zip({
		'description.xml': `<?xml version="1.0"?><GDTF DataVersion="1.2"><FixtureType Name="Spot">
			<Models><Model Name="Base" File="base" Length="0.3" Width="0.3" Height="0.1"/>
				<Model Name="Head" File="" Length="0.2" Width="0.2" Height="0.3" PrimitiveType="Head"/>
				<Model Name="Pig" File="" Length="0.1" Width="0.1" Height="0.1" PrimitiveType="Pigtail"/></Models>
			<Geometries><Geometry Name="Base" Model="Base" Position="{1,0,0,0}{0,1,0,0}{0,0,1,0}{0,0,0,1}">
				<Axis Name="Head" Model="Head" Position="{1,0,0,0}{0,1,0,0}{0,0,1,-0.2}{0,0,0,1}">
					<Beam Name="Beam" Model="Head" Position="{1,0,0,0}{0,1,0,0}{0,0,1,0}{0,0,0,1}"/></Axis>
				<Geometry Name="Pig" Model="Pig" Position="{1,0,0,0}{0,1,0,0}{0,0,1,0}{0,0,0,1}"/></Geometry></Geometries>
			<DMXModes><DMXMode Name="Std" Geometry="Base"/></DMXModes></FixtureType></GDTF>`,
		'models/gltf/base.glb': cubeGlb(),
	})
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GeneralSceneDescription verMajor="1" verMinor="6" provider="test" providerVersion="1">
<Scene><AUXData><Symdef uuid="S1" name="Sym"><ChildList><Geometry3D fileName="person"/></ChildList></Symdef></AUXData>
<Layers><Layer uuid="L1" name="Stage"><ChildList>
	<SceneObject uuid="O1" name="Riser"><Matrix>{1,0,0}{0,1,0}{0,0,1}{1000,0,0}</Matrix>
		<Geometries><Geometry3D fileName="cube.glb"/><Symbol uuid="X" symdef="s1"><Matrix>{1,0,0}{0,1,0}{0,0,1}{0,2000,0}</Matrix></Symbol></Geometries></SceneObject>
	<GroupObject uuid="G1" name="Truss"><Matrix>{1,0,0}{0,1,0}{0,0,1}{0,0,6000}</Matrix><ChildList>
		<Fixture uuid="F1" name="Spot 1"><Matrix>{1,0,0}{0,1,0}{0,0,1}{500,0,0}</Matrix><GDTFSpec>Maker@Spot</GDTFSpec><GDTFMode>Std</GDTFMode>
			<Addresses><Address break="0">513</Address></Addresses><FixtureID>101</FixtureID></Fixture>
		<Fixture uuid="F2" name="Ghost"><GDTFSpec>Nobody@Ghost.gdtf</GDTFSpec><GDTFMode>A</GDTFMode></Fixture>
	</ChildList></GroupObject>
	<VideoScreen uuid="V1" name="LED"><Sources><Source linkedGeometry="Display" type="NDI">PGM</Source></Sources></VideoScreen>
</ChildList></Layer></Layers></Scene></GeneralSceneDescription>`
	return zip({ 'GeneralSceneDescription.xml': xml, 'cube.glb': cubeGlb(), 'person.3ds': tiny3ds(), 'Maker@Spot.gdtf': gdtf })
}

function writeGlbJson(json, bin) {
	let js = Buffer.from(JSON.stringify(json))
	js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)])
	const head = Buffer.alloc(20)
	head.writeUInt32LE(0x46546c67, 0)
	head.writeUInt32LE(2, 4)
	head.writeUInt32LE(28 + js.length + bin.length, 8)
	head.writeUInt32LE(js.length, 12)
	head.writeUInt32LE(0x4e4f534a, 16)
	const bh = Buffer.alloc(8)
	bh.writeUInt32LE(bin.length, 0)
	bh.writeUInt32LE(0x004e4942, 4)
	return Buffer.concat([head, js, bh, bin])
}

const origin = (x) => x.slice(9, 12)

test('transforms: MVR mm Z-up → Godot m Y-up; GDTF row matrices', () => {
	assert.deepStrictEqual(toGodot(IDENTITY), [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0])
	assert.deepStrictEqual(origin(toGodot(mvrMatrix('{1,0,0}{0,1,0}{0,0,1}{1000,2000,3000}'))), [1, 3, -2])
	assert.deepStrictEqual(gdtfMatrix('{1,0,0,0.5}{0,1,0,-0.1}{0,0,1,0.2}{0,0,0,1}').slice(12, 15), [0.5, -0.1, 0.2])
	assert.deepStrictEqual(mvrMatrix('garbage'), [...IDENTITY])
})

test('3DS → GLB: mm Z-up → m Y-up, material colour kept', () => {
	const { json, bin } = readGlb(threeDsToGlb(tiny3ds()))
	const acc = json.accessors[json.meshes[0].primitives[0].attributes.POSITION]
	const v = new Float32Array(bin.buffer.slice(bin.byteOffset + json.bufferViews[acc.bufferView].byteOffset), 0, 9)
	assert.deepStrictEqual([...v].map((x) => Math.round(x * 1000) / 1000 + 0), [0, 0, 0, 1, 0, 0, 0, 1.8, 0])
	assert.deepStrictEqual(json.materials[0].pbrMetallicRoughness.baseColorFactor, [1, 0, 0, 1])
	assert.throws(() => threeDsToGlb(Buffer.from('nope')), /not a 3DS/)
})

test('external image URIs: embedded from the archive, or every texture dropped when one is missing', async () => {
	const { json, bin } = readGlb(cubeGlb())
	json.images = [{ uri: 'deck%20tex.png' }]
	json.textures = [{ source: 0 }]
	json.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }]
	const withImg = writeGlbJson(json, bin)
	const png = Buffer.from('89504e470d0a1a0a', 'hex')
	const a = readGlb(await embedGlbImages(withImg, (u) => (u === 'deck tex.png' ? png : null)))
	const im = a.json.images[0]
	assert.equal(im.uri, undefined)
	assert.equal(im.mimeType, 'image/png')
	const bv = a.json.bufferViews[im.bufferView]
	assert.equal(bv.byteOffset % 4, 0)
	assert.deepEqual(a.bin.subarray(bv.byteOffset, bv.byteOffset + bv.byteLength), png)
	assert.ok(a.json.buffers[0].byteLength >= bv.byteOffset + bv.byteLength)
	const b = readGlb(await embedGlbImages(withImg, async () => null))
	assert.equal(b.json.images, undefined)
	assert.equal(b.json.textures, undefined)
	assert.equal(b.json.materials[0].pbrMetallicRoughness.baseColorTexture, undefined)
	const plain = cubeGlb()
	assert.equal(await embedGlbImages(plain, () => null), plain)
})

test('import: groups, symbols, GDTF fixture parts, missing GDTF box, video screen; meshes served as GLB', async () => {
	const rec = await store.importMvr(sampleMvr(), 'Sample.mvr')
	const s = rec.scene
	assert.strictEqual(rec.name, 'Sample')
	assert.strictEqual(s.version, '1.6')
	assert.deepStrictEqual(s.report.missing_gdtf, ['Nobody@Ghost.gdtf'])
	const by = Object.fromEntries(s.objects.map((o) => [o.name, o]))
	assert.deepStrictEqual(by.Riser.parts.map((p) => p.mesh), ['mvr:cube.glb', 'mvr:person.3ds'])
	assert.deepStrictEqual(origin(by.Riser.parts[1].xform), [1, 0, -2], 'symbol offset composed onto its object')
	const spot = by['Spot 1']
	assert.deepStrictEqual(spot.fixture, { spec: 'Maker@Spot', mode: 'Std', id: '101', unit: '', addresses: [{ break: 0, address: 513 }] })
	assert.deepStrictEqual(spot.parts.map((p) => p.mesh), ['gdtf:Maker@Spot.gdtf:models/gltf/base.glb', 'prim:box'],
		'base mesh + file-less head as a box; beam and pigtail skipped')
	assert.deepStrictEqual(origin(spot.parts[0].xform), [0.5, 6, 0], 'group (z 6 m) + fixture offset')
	assert.deepStrictEqual(origin(spot.parts[1].xform), [0.5, 5.8, 0], 'head 0.2 m below the base')
	assert.deepStrictEqual(spot.parts[1].xform.slice(0, 9), [0.2, 0, 0, 0, 0.3, 0, 0, 0, 0.2], 'box sized L × H × W')
	assert.deepStrictEqual(by.Ghost.parts.map((p) => p.mesh), ['prim:box'])
	assert.deepStrictEqual(by.LED.sources, [{ type: 'NDI', linkedGeometry: 'Display', value: 'PGM' }])
	for (const key of s.meshes) assert.strictEqual((await store.mesh(rec.id, key))?.readUInt32LE(0), 0x46546c67, key)
	assert.strictEqual(await store.mesh(rec.id, 'mvr:nope.glb'), null)
	assert.ok(store.list().some((r) => r.id === rec.id && r.objects === s.objects.length))
	assert.ok(store.remove(rec.id))
	assert.strictEqual(store.get(rec.id), null)
})

test('routes: multipart upload → scene → mesh → delete', async () => {
	const routes = new RouteRegistry()
	register(routes)
	const call = (method, path, extra = {}) => routes.dispatch(method, path, '', {}, extra.req, extra.query || {})
	const boundary = 'xMVRx'
	const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="Show.mvr"\r\n` +
		'Content-Type: application/octet-stream\r\n\r\n'), sampleMvr(), Buffer.from(`\r\n--${boundary}--\r\n`)])
	const req = Readable.from([body])
	req.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` }
	const up = await call('POST', '/api/stage/mvr', { req })
	const r = JSON.parse(up.body)
	assert.strictEqual(up.status, 200, up.body)
	assert.strictEqual(r.name, 'Show')
	assert.strictEqual(r.objects, 4)
	const scene = JSON.parse((await call('GET', `/api/stage/mvr/${r.id}`)).body)
	assert.strictEqual(scene.scene.objects.length, 4)
	const mesh = await call('GET', `/api/stage/mvr/${r.id}/mesh`, { query: { key: 'mvr:person.3ds' } })
	assert.strictEqual(mesh.headers['Content-Type'], 'model/gltf-binary')
	assert.strictEqual((await call('DELETE', `/api/stage/mvr/${r.id}`)).status, 200)
	assert.strictEqual((await call('GET', `/api/stage/mvr/${r.id}`)).status, 404)
	const bad = Readable.from([Buffer.from('{}')])
	bad.headers = { 'content-type': 'application/json' }
	assert.strictEqual((await call('POST', '/api/stage/mvr', { req: bad })).status, 400)
})
