'use strict'
/**
 * WO-1098 — the venue import end to end: convertVenue on a synthetic room (OBJ + MTL + PNG, loose and zipped, a
 * SketchUp-like .skp holding the picture) → a GLB the WO-1003 reader takes (HIGHASCG_venue layers, textured REPEAT
 * material, report); a .skp alone is refused with the "export OBJ" text; the job (one at a time, progress over WS,
 * cancel = worker terminated, nothing written) with a fake worker; the real worker thread and the HTTP routes with
 * a zip upload → "<stem>.glb" in the project folder.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')
const { Readable } = require('stream')
const JSZip = require('jszip')
const { PNG } = require('pngjs')

const { convertVenue, EXT } = require('../../src/stage/venue-convert')
const { gather, memoryFiles } = require('../../src/stage/venue-sources')
const { readGlb } = require('../../src/stage/glb-write')
const gatherProject = require('../../src/media/project-media-gather')
const job = require('../../src/media/venue-import-job')
const routes = require('../../src/api/routes-venue-import')

function png(w, h, a = 255) {
	const p = new PNG({ width: w, height: h })
	for (let i = 0; i < w * h; i++) p.data.set([200, 100, 50, a], 4 * i)
	return PNG.sync.write(p)
}

// a 12 × 5 × 20 m hall, SketchUp-style: inches, Z up, faces pointing out, a textured wall, a hanging lamp ×2
function hallObj() {
	const k = 1 / 0.0254
	const v = []
	const V = (x, y, z) => v.push(`v ${(x * k).toFixed(3)} ${(-z * k).toFixed(3)} ${(y * k).toFixed(3)}`) // y-up m → z-up in
	const box = [[0, 0, 0], [12, 0, 0], [12, 0, 20], [0, 0, 20], [0, 5, 0], [12, 5, 0], [12, 5, 20], [0, 5, 20]]
	box.forEach((p) => V(...p))
	const f = ['g Floor', 'usemtl Carpet', 'f 1 4 3 2', 'g Ceiling', 'usemtl White', 'f 5 6 7 8', 'g Walls', 'usemtl Photo',
		'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1', 'f 1/1 2/2 6/3 5/4', 'usemtl White', 'f 2 3 7 6', 'f 3 4 8 7', 'f 4 1 5 8']
	let n = 8
	for (const [i, cx] of [[1, 4], [2, 8]]) {
		f.push(`g Shade_${i} Lamp_${i}`, 'usemtl Gold')
		for (let s = 0; s < 120; s++) { // a fan of 120 slivers → 240 triangles per lamp, hanging 4…4.6 m
			const a = (s / 120) * 2 * Math.PI, b = ((s + 1) / 120) * 2 * Math.PI
			V(cx, 4.6, 10); V(cx + Math.cos(a), 4, 10 + Math.sin(a)); V(cx + Math.cos(b), 4, 10 + Math.sin(b))
			f.push(`f ${n + 1} ${n + 2} ${n + 3}`, `f ${n + 1} ${n + 3} ${n + 2}`)
			n += 3
		}
	}
	return ['# Exported from SketchUp, v8', '# File units = inches', 'mtllib hall.mtl', ...v, ...f].join('\n')
}
const MTL = ['newmtl Carpet', 'Kd 0.5 0.3 0.2', 'newmtl White', 'Kd 1 1 1', 'newmtl Gold', 'Kd 1 0.6 0',
	'newmtl Photo', 'Kd 1 1 1', 'map_Kd hall\\Photo_2_.png'].join('\n')
const encode = async (data, mime) => ({ data, mime })

test('convertVenue: synthetic hall → layered, textured, placed GLB with its report', async () => {
	const files = memoryFiles({ 'hall.obj': hallObj(), 'hall.mtl': MTL, 'tex/photo.png': png(4, 4) })
	const r = await convertVenue({ files, skpMaterials: [] }, { encode, place: { x: 1, y: 0.5, z: -2, yaw: 0 }, budget: 300 })
	const { json } = readGlb(r.glb)
	const rep = r.report
	assert.deepStrictEqual([rep.units.unit, rep.units.source, rep.up], ['in', 'file', 'z'])
	assert.deepStrictEqual(rep.bounds.size.map((x) => Math.round(x * 10) / 10), [12, 5, 20], 'inches → metres, Z up → Y up')
	assert.strictEqual(rep.floorY, 0)
	assert.strictEqual(rep.ceilingY, 5)
	assert.deepStrictEqual(Object.keys(rep.layers).sort(), ['Ceiling', 'Chandeliers', 'Floor', 'Walls'])
	assert.ok(rep.triangles.out <= 300, `budget kept (${rep.triangles.out})`)
	assert.strictEqual(rep.decimated[0].key, 'Chandeliers|Gold', 'only the heavy repeated part is simplified')
	assert.deepStrictEqual(rep.textures.map((t) => [t.material, t.how]), [['Photo', 'variant']], '"Photo_2_" → the base picture by name')
	assert.deepStrictEqual(json.extensionsUsed, [EXT])
	const layers = json.asset.extensions[EXT].layers.map((l) => l.name)
	assert.deepStrictEqual(layers.sort(), ['Ceiling', 'Chandeliers', 'Floor', 'Walls'])
	const root = json.nodes.find((n) => n.name === 'venue')
	assert.deepStrictEqual(root.matrix.slice(12, 15), [1, 0.5, -2])
	const names = root.children.map((i) => json.nodes[i].name)
	assert.ok(names.includes('Chandelier 1') && names.includes('Chandelier 2'), 'each lamp its own node')
	assert.ok(root.children.every((i) => json.nodes[i].extensions[EXT].layer_identifier.startsWith('venue-layer-')))
	const photo = json.materials.find((m) => m.name === 'Photo')
	assert.ok(photo.pbrMetallicRoughness.baseColorTexture, 'textured')
	assert.strictEqual(photo.alphaMode, undefined, 'an opaque PNG stays opaque')
	assert.strictEqual(json.materials.find((m) => /^Gold/.test(m.name)).doubleSided, true, 'loose objects: both faces')
	assert.strictEqual(json.materials.find((m) => m.name === 'White').doubleSided, false, 'the room shell: one face, inward')
	assert.strictEqual(json.asset.extras.highascg_import.triangles.in, rep.triangles.in)
	// overrides, planes, markers
	const r2 = await convertVenue({ files, skpMaterials: [] }, { encode, textures: { 'layer:Floor': { image: 'photo.png', tile: [2, 1] } },
		planes: [{ name: 'Haki', image: 'photo.png', rect: [0, 0, 12, 20], y: 4.9, opacity: 0.5 }], markers: [{ name: 'Haki', points: [[1, 1], [2, 2]], y: 4.95 }] })
	assert.deepStrictEqual(r2.report.textures.map((t) => t.how).sort(), ['override', 'plane', 'variant'])
	assert.ok(r2.report.layers.Haki === 2 + 48, 'plane 2 + two discs × 24 triangles')
})

test('sources: a zip of the folder, a .skp read for its pictures only; .skp alone → "export OBJ"', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1098-src-'))
	try {
		const skp = new JSZip()
		skp.file('model.dat', 'closed format')
		skp.file('materials/Photo/material.xml', '<mat:material name="Photo"><mat:image path="./pic.png" xScale="39.37" yScale="39.37"/></mat:material>')
		skp.file('materials/Photo/pic.png', png(2, 2))
		const skpBuf = Buffer.concat([Buffer.alloc(69, 7), await skp.generateAsync({ type: 'nodebuffer' })]) // SketchUp's header before the ZIP
		fs.writeFileSync(path.join(dir, 'Hall.skp'), skpBuf)
		let src = await gather(dir)
		assert.deepStrictEqual(src.files.map((f) => f.rel), ['Hall.skp/materials/Photo/pic.png'], 'model.dat never read')
		assert.deepStrictEqual(src.skpMaterials[0].tileM.map((x) => +x.toFixed(2)), [1, 1])
		await assert.rejects(convertVenue(src, { encode }), /SketchUp files are used for their textures only; export OBJ/)
		const z = new JSZip()
		z.file('Hall/hall.obj', hallObj())
		z.file('Hall/hall.mtl', MTL.replace('hall\\Photo_2_.png', 'gone/Photo.png'))
		fs.writeFileSync(path.join(dir, 'hall.zip'), await z.generateAsync({ type: 'nodebuffer' }))
		src = await gather(dir)
		const r = await convertVenue(src, { encode, budget: 0 })
		assert.deepStrictEqual(r.report.source.zip, ['hall.zip'])
		assert.deepStrictEqual(r.report.textures.map((t) => [t.material, t.how, t.file]), [['Photo', 'material', 'Hall.skp/materials/Photo/pic.png']])
		assert.strictEqual(r.report.missingTextures.length, 0)
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

function multipart(files, b = '----wo1098') {
	const parts = []
	for (const [name, data, rel] of files) {
		if (rel) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="path"\r\n\r\n${rel}\r\n`))
		parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), Buffer.from(data), Buffer.from('\r\n'))
	}
	parts.push(Buffer.from(`--${b}--\r\n`))
	const req = Readable.from([Buffer.concat(parts)])
	req.headers = { 'content-type': `multipart/form-data; boundary=${b}` }
	return req
}

function setup() {
	const media = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1098-media-'))
	gatherProject._setActiveProjectForTests(() => ({ slug: 'hall', project: { name: 'hall' } }))
	const events = []
	const ctx = { config: { local_media_path: media }, _wsBroadcast: (t, d) => events.push([t, d]), log() {} }
	const got = []
	routes.register({ get: (p, f) => got.push(['GET', p, f]), post: (p, f) => got.push(['POST', p, f]) })
	const route = (m, p) => got.find((g) => g[0] === m && g[1] === p)[2]
	return { media, ctx, events, route }
}

test('job: staging paths, one at a time, progress, cancel terminates, done saves "<stem>.glb"', async () => {
	const { media, ctx, events } = setup()
	try {
		assert.strictEqual(job.cleanRel('../a/./b.obj'), 'a/b.obj')
		assert.strictEqual(job.cleanRel('/etc/x/../passwd.png'), 'etc/x/passwd.png', 'never leaves the staging folder')
		const s = job.session()
		assert.match(job.target(s, 'notes.txt').error, /not part of a venue import/)
		assert.strictEqual(job.start(ctx, s.id).status, 400, 'nothing uploaded')
		s.files.add('Hall.skp')
		assert.match(job.start(ctx, s.id).body.error, /textures only; export OBJ/)
		s.files.add('Hall Room.obj')
		const workers = []
		const makeWorker = (data) => {
			const w = new EventEmitter()
			w.data = data
			w.terminated = false
			w.terminate = async () => (w.terminated = true)
			workers.push(w)
			return w
		}
		let r = job.start(ctx, s.id, { up: 'z' }, { makeWorker })
		assert.strictEqual(r.status, 200)
		assert.deepStrictEqual(workers[0].data, { dir: s.dir, opts: { up: 'z' } })
		assert.strictEqual(job.start(ctx, s.id, {}, { makeWorker }).status, 409, 'one at a time')
		workers[0].emit('message', { type: 'progress', phase: 'reading', done: 5, total: 10, text: 'Reading 50%' })
		assert.deepStrictEqual([job.snapshot().phase, job.snapshot().done], ['reading', 5])
		assert.strictEqual(events.at(-1)[1].path, 'venueImport')
		r = job.cancel(ctx)
		assert.strictEqual(r.body.state, 'cancelled')
		assert.ok(workers[0].terminated)
		assert.ok(!fs.existsSync(s.dir), 'staging removed')
		workers[0].emit('message', { type: 'done', glb: new ArrayBuffer(8), report: {} })
		assert.strictEqual(job.snapshot().state, 'cancelled', 'a late result is ignored')
		const s2 = job.session()
		s2.files.add('Hall Room.obj')
		job.start(ctx, s2.id, {}, { makeWorker })
		workers[1].emit('message', { type: 'done', glb: new Uint8Array([1, 2, 3, 4]).buffer, report: { triangles: { in: 1, out: 1 } } })
		assert.strictEqual(job.snapshot().state, 'done')
		assert.strictEqual(job.snapshot().name, 'Hall Room.glb')
		assert.ok(fs.existsSync(path.join(media, 'projects', 'hall', 'Hall Room.glb')))
		assert.strictEqual(events.at(-1)[1].path, 'projectFiles')
	} finally {
		job._reset()
		fs.rmSync(media, { recursive: true, force: true })
	}
})

test('API + real worker: zip upload, a loose file with its folder path, start, poll to done', async () => {
	const { media, ctx, route } = setup()
	try {
		const z = new JSZip()
		z.file('hall.obj', hallObj())
		z.file('hall.mtl', MTL)
		let r = await route('POST', '/api/venue-import/files')({ req: multipart([['hall.zip', await z.generateAsync({ type: 'nodebuffer' })]]), ctx, query: {} })
		let j = JSON.parse(r.body)
		assert.strictEqual(r.status, 200)
		const session = j.session
		r = await route('POST', '/api/venue-import/files')({ req: multipart([['Photo.png', png(4, 4), 'hall/Photo.png'], ['x.exe', 'no']]), ctx, query: { session } })
		j = JSON.parse(r.body)
		assert.deepStrictEqual(j.files, ['hall.zip', 'hall/Photo.png'], 'the folder path is kept')
		assert.match(j.rejected[0].error, /not part of a venue import/)
		r = route('POST', '/api/venue-import/start')({ ctx, body: JSON.stringify({ session, options: { units: 'in', budget: 100000, up: 'sideways' } }) })
		assert.strictEqual(r.status, 200, r.body)
		for (let i = 0; i < 200 && job.snapshot().state === 'running'; i++) await new Promise((res) => setTimeout(res, 50))
		const snap = JSON.parse(route('GET', '/api/venue-import')({ ctx }).body)
		assert.strictEqual(snap.state, 'done', snap.error)
		assert.strictEqual(snap.name, 'hall.glb')
		assert.strictEqual(snap.report.units.source, 'option')
		assert.deepStrictEqual(snap.report.textures.map((t) => [t.material, t.file]), [['Photo', 'hall/Photo.png']])
		const glb = fs.readFileSync(path.join(media, 'projects', 'hall', 'hall.glb'))
		assert.ok(readGlb(glb).json.asset.extensions[EXT].layers.length >= 4)
		assert.strictEqual(route('POST', '/api/venue-import/cancel')({ ctx }).status, 409, 'nothing to cancel')
	} finally {
		job._reset()
		fs.rmSync(media, { recursive: true, force: true })
	}
})

test('WO-1106 B20: cancel asks a worker that takes messages to stop its ffmpeg children; terminate is the fallback', () => {
	const { media, ctx } = setup()
	try {
		const s = job.session()
		s.files.add('Hall Room.obj')
		const asked = []
		const w = new EventEmitter()
		w.terminated = false
		w.terminate = async () => (w.terminated = true)
		w.postMessage = (m) => asked.push(m)
		assert.strictEqual(job.start(ctx, s.id, {}, { makeWorker: () => w }).status, 200)
		assert.strictEqual(job.cancel(ctx).body.state, 'cancelled')
		assert.deepStrictEqual(asked, [{ type: 'cancel' }])
		assert.ok(!w.terminated, 'not terminated first: its children would be orphaned')
	} finally {
		job._reset()
		fs.rmSync(media, { recursive: true, force: true })
	}
})
