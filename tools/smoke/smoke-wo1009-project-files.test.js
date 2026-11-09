'use strict'
/**
 * WO-1009 — project documents (MVR / GLB / PDF / XLS / XLSX) in the open project's folder: upload (streamed, several
 * per request, other kinds refused), same bytes kept once, a different file of the same name → "name (2)", list,
 * download, delete, names cannot leave the folder; the previs MVR import keeps its file there.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Readable } = require('stream')

const gather = require('../../src/media/project-media-gather')
const pf = require('../../src/media/project-files')
const routes = require('../../src/api/routes-project-files')

function setup() {
	const media = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1009-'))
	gather._setActiveProjectForTests(() => ({ slug: 'narvil', project: { name: 'narvil' } }))
	const events = []
	const ctx = { config: { local_media_path: media }, _wsBroadcast: (t, d) => events.push([t, d]), log() {} }
	return { media, ctx, events, dir: pf.folder(ctx).dir }
}

function multipart(files) {
	const b = '----wo1009'
	const parts = []
	for (const [name, data] of files) {
		parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`))
		parts.push(Buffer.from(data))
		parts.push(Buffer.from('\r\n'))
	}
	parts.push(Buffer.from(`--${b}--\r\n`))
	const req = Readable.from([Buffer.concat(parts)])
	req.headers = { 'content-type': `multipart/form-data; boundary=${b}` }
	return req
}

test('upload: kinds, dedupe, (2) names, list, download, delete', async () => {
	const { media, ctx, events, dir } = setup()
	try {
		assert.strictEqual(dir, path.join(media, 'projects', 'narvil'), 'the project media folder (Sources narvil/)')
		let r = await routes.handleUpload(multipart([['rider.pdf', 'PDF-1'], ['patch.xlsx', 'XL'], ['clip.mp4', 'no']]), ctx)
		let j = JSON.parse(r.body)
		assert.strictEqual(r.status, 200)
		assert.deepStrictEqual(j.saved.map((s) => s.name).sort(), ['patch.xlsx', 'rider.pdf'], 'saved in write-finish order')
		assert.match(j.rejected[0].error, /not a project document: clip\.mp4/)
		assert.ok(!fs.existsSync(path.join(dir, 'clip.mp4')))
		assert.strictEqual(events.at(-1)[1].path, 'projectFiles', 'clients hear about it')
		r = await routes.handleUpload(multipart([['rider.pdf', 'PDF-1']]), ctx)
		assert.deepStrictEqual(JSON.parse(r.body).saved, [{ name: 'rider.pdf', existed: true }], 'same bytes: kept once')
		r = await routes.handleUpload(multipart([['rider.pdf', 'PDF-2 new']]), ctx)
		assert.deepStrictEqual(JSON.parse(r.body).saved, [{ name: 'rider (2).pdf', existed: false }], 'never overwrites')
		r = await routes.handleUpload(multipart([['../../evil.glb', 'GLB']]), ctx)
		assert.deepStrictEqual(JSON.parse(r.body).saved.map((s) => s.name), ['evil.glb'], 'a path is cut to its file name')
		assert.ok(fs.existsSync(path.join(dir, 'evil.glb')))
		fs.writeFileSync(path.join(dir, 'movie.mov'), 'x')
		const l = pf.list(ctx)
		assert.deepStrictEqual(l.files.map((f) => [f.name, f.kind]), [['evil.glb', 'model'], ['patch.xlsx', 'sheet'], ['rider (2).pdf', 'pdf'], ['rider.pdf', 'pdf']])
		assert.ok(!fs.readdirSync(dir).some((n) => n.endsWith('.part')), 'no temp files left')
		r = await routes.handleUpload(multipart([['a.txt', 'x']]), ctx)
		assert.strictEqual(r.status, 415)
		const got = []
		routes.register({ get: (p, f) => got.push(['GET', p, f]), post: (p, f) => got.push(['POST', p, f]), delete: (p, f) => got.push(['DELETE', p, f]) })
		const route = (m, p) => got.find((g) => g[0] === m && g[1] === p)[2]
		r = route('GET', '/api/project-files/*')({ ctx, path: '/api/project-files/rider%20(2).pdf' })
		assert.strictEqual(String(r.body), 'PDF-2 new')
		assert.strictEqual(r.headers['Content-Type'], 'application/pdf')
		assert.strictEqual(route('GET', '/api/project-files/*')({ ctx, path: '/api/project-files/..%2F..%2Fetc%2Fpasswd' }).status, 404)
		r = route('DELETE', '/api/project-files/*')({ ctx, path: '/api/project-files/rider.pdf' })
		assert.strictEqual(r.status, 200)
		assert.ok(!fs.existsSync(path.join(dir, 'rider.pdf')))
		assert.strictEqual(JSON.parse(route('GET', '/api/project-files')({ ctx }).body).files.length, 3)
	} finally {
		gather._setActiveProjectForTests(null)
		fs.rmSync(media, { recursive: true, force: true })
	}
})

test('no open project → 409; saveBuffer dedupes; MVR import keeps the file (source)', async () => {
	const { media, ctx } = setup()
	try {
		assert.deepStrictEqual(pf.saveBuffer(ctx, 'venue.mvr', Buffer.from('MVR')), { name: 'venue.mvr', existed: false })
		assert.deepStrictEqual(pf.saveBuffer(ctx, 'venue.mvr', Buffer.from('MVR')), { name: 'venue.mvr', existed: true })
		gather._setActiveProjectForTests(() => ({ slug: '', project: null }))
		const r = await routes.handleUpload(multipart([['x.pdf', 'x']]), ctx)
		assert.strictEqual(r.status, 409)
		const src = fs.readFileSync(path.join(__dirname, '../../src/api/routes-stage-mvr.js'), 'utf8')
		assert.match(src, /require\('\.\.\/media\/project-files'\)\.saveBuffer\(ctx, up\.file\.name, up\.file\.buf\)/)
		assert.match(fs.readFileSync(path.join(__dirname, '../../src/api/router.js'), 'utf8'), /require\('\.\/routes-project-files'\)\.register\(routes\)/)
	} finally {
		gather._setActiveProjectForTests(null)
		fs.rmSync(media, { recursive: true, force: true })
	}
})

test('media docs: every folder under the media root, by media-style id; never outside it', () => {
	const { media, ctx } = setup()
	try {
		fs.mkdirSync(path.join(media, 'projects', 'other'), { recursive: true })
		fs.mkdirSync(path.join(media, '.hidden'), { recursive: true })
		fs.writeFileSync(path.join(media, 'projects', 'other', 'plot.pdf'), 'P')
		fs.writeFileSync(path.join(media, 'show.xls'), 'X')
		fs.writeFileSync(path.join(media, 'clip.mp4'), 'M')
		fs.writeFileSync(path.join(media, '.hidden', 'x.pdf'), 'H')
		assert.deepStrictEqual(pf.listMediaDocs(ctx.config).map((d) => [d.id, d.kind]), [['projects/other/plot.pdf', 'pdf'], ['show.xls', 'sheet']])
		const got = []
		routes.register({ get: (p, f) => got.push(['GET', p, f]), post: () => {}, delete: (p, f) => got.push(['DELETE', p, f]) })
		const route = (m, p) => got.find((g) => g[0] === m && g[1] === p)[2]
		assert.strictEqual(JSON.parse(route('GET', '/api/media-docs')({ ctx }).body).length, 2)
		assert.strictEqual(String(route('GET', '/api/media-docs/file')({ ctx, query: { id: 'projects/other/plot.pdf' } }).body), 'P')
		for (const id of ['clip.mp4', '../../etc/passwd', '', 'nope.pdf']) {
			assert.strictEqual(route('GET', '/api/media-docs/file')({ ctx, query: { id } }).status, 404, id)
		}
		assert.strictEqual(route('DELETE', '/api/media-docs/file')({ ctx, query: { id: 'show.xls' } }).status, 200)
		assert.ok(!fs.existsSync(path.join(media, 'show.xls')))
		assert.ok(fs.existsSync(path.join(media, 'clip.mp4')), 'media is not a document: never deleted here')
	} finally {
		gather._setActiveProjectForTests(null)
		fs.rmSync(media, { recursive: true, force: true })
	}
})

test('spreadsheets open in the built-in reader (the lower-thirds exceljs reader), not a desktop program', async () => {
	const { media, ctx, dir } = setup()
	try {
		const ExcelJS = require('exceljs')
		const wb = new ExcelJS.Workbook()
		const ws = wb.addWorksheet('Crew')
		ws.addRow(['Name', 'Role'])
		ws.addRow(['Ana', 'Host'])
		ws.addRow(['Ben', 'Guest'])
		fs.mkdirSync(dir, { recursive: true })
		await wb.xlsx.writeFile(path.join(dir, 'crew.xlsx'))
		fs.writeFileSync(path.join(dir, 'old.xls'), 'legacy')
		fs.writeFileSync(path.join(dir, 'rider.pdf'), 'P')
		const got = []
		routes.register({ get: (p, f) => got.push([p, f]), post: () => {}, delete: () => {} })
		const get = (p) => got.find((g) => g[0] === p)[1]
		let j = JSON.parse((await get('/api/media-docs/sheet')({ ctx, query: { id: 'projects/narvil/crew.xlsx' } })).body)
		assert.deepStrictEqual([j.ok, j.fileName, j.headers, j.rows, j.total], [true, 'crew.xlsx', ['Name', 'Role'], [{ Name: 'Ana', Role: 'Host' }, { Name: 'Ben', Role: 'Guest' }], 2])
		j = JSON.parse((await get('/api/project-files/*')({ ctx, path: '/api/project-files/crew.xlsx/sheet' })).body)
		assert.strictEqual(j.total, 2, 'a project file by name')
		j = JSON.parse((await get('/api/media-docs/sheet')({ ctx, query: { id: 'projects/narvil/old.xls' } })).body)
		assert.deepStrictEqual([j.ok, /Legacy \.xls/.test(j.error)], [false, true], 'legacy .xls: the reader says why')
		assert.strictEqual((await get('/api/media-docs/sheet')({ ctx, query: { id: 'projects/narvil/rider.pdf' } })).status, 404, 'only spreadsheets')
	} finally {
		gather._setActiveProjectForTests(null)
		fs.rmSync(media, { recursive: true, force: true })
	}
})
