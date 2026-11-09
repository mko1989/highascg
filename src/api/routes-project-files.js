'use strict'

/**
 * WO-1009 — the open project's documents (src/media/project-files.js):
 *   GET    /api/project-files                 → { slug, files: [{ name, kind: mvr|model|pdf|sheet, size, mtime }] }
 *   POST   /api/project-files                 → multipart, one or more files (.mvr .glb .pdf .xls .xlsx), streamed to
 *                                               disk → { saved: [{ name, existed }], rejected: [{ name, error }] }
 *   GET    /api/project-files/<name>          → the file
 *   DELETE /api/project-files/<name>
 *   POST   /api/project-files/<name>/mvr      → an .mvr from the folder into the previs (as POST /api/stage/mvr)
 *   GET    /api/media-docs                    → [{ id, kind, size, mtime }] every document under the media root (Sources
 *                                               "media only" off; ids like media ids: "projects/narvil/rider.pdf")
 *   GET    /api/media-docs/file?id=<id>       → that file;  DELETE the same → removed
 *   GET    /api/media-docs/sheet?id=<id>      → a spreadsheet read by the lower-thirds reader (WO-601 exceljs, client/lib/
 *   GET    /api/project-files/<name>/sheet      lower-third-roster-import.js): { ok, fileName, headers, rows, total }
 *                                               — the Godot client shows it in its own table (no desktop program needed)
 * Changes are broadcast as WS `change` { path: 'projectFiles' }.
 * Not under /api/project/: its GET / DELETE / POST wildcards (router.js) would take these paths.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { pathToFileURL } = require('url')
const busboy = require('busboy')
const pf = require('../media/project-files')
const { JSON_HEADERS, jsonBody } = require('./response')
const { REPO_ROOT } = require('../repo-paths')

const MAX_BYTES = 2 * 1024 * 1024 * 1024
const SHEET_ROWS = 5000 // rows sent to the viewer (`total` says how many the sheet has)
const reply = (status, o) => ({ status, headers: JSON_HEADERS, body: jsonBody(o) })

function changed(ctx) {
	if (typeof ctx?._wsBroadcast === 'function') ctx._wsBroadcast('change', { path: 'projectFiles', value: pf.list(ctx) })
}

/** Stream every file of the multipart request into the project folder. */
function handleUpload(req, ctx) {
	return new Promise((resolve) => {
		const saved = []
		const rejected = []
		const writes = []
		let bb
		try {
			bb = busboy({ headers: req.headers, defParamCharset: 'utf8', limits: { fileSize: MAX_BYTES } })
		} catch (e) {
			resolve(reply(400, { error: `multipart upload expected: ${e.message}` }))
			return
		}
		bb.on('file', (_field, stream, info) => {
			const b = pf.begin(ctx, info.filename)
			if (b.error) {
				rejected.push({ name: String(info.filename || ''), error: b.error, status: b.status })
				stream.resume()
				return
			}
			const h = crypto.createHash('sha1')
			const out = fs.createWriteStream(b.tmp)
			let over = false
			stream.on('data', (d) => h.update(d))
			stream.on('limit', () => (over = true))
			stream.pipe(out)
			writes.push(new Promise((done) => {
				const fail = (error) => {
					fs.rmSync(b.tmp, { force: true })
					rejected.push({ name: b.name, error })
					done()
				}
				out.on('error', (e) => fail(String(e?.message || e)))
				out.on('finish', () => {
					if (over) return fail(`file over ${MAX_BYTES / 1073741824} GB`)
					try {
						saved.push(pf.place(b.dir, b.tmp, b.name, h.digest('hex')))
					} catch (e) {
						return fail(String(e?.message || e))
					}
					done()
				})
			}))
		})
		bb.on('error', (e) => resolve(reply(400, { error: String(e?.message || e) })))
		bb.on('close', async () => {
			await Promise.all(writes)
			if (saved.length) {
				ctx?.log?.('info', `[project-files] saved ${saved.map((s) => s.name).join(', ')}`)
				changed(ctx)
			}
			if (!saved.length && rejected.length) return resolve(reply(rejected[0].status || 400, { error: rejected[0].error, saved, rejected }))
			resolve(reply(saved.length ? 200 : 400, saved.length ? { saved, rejected } : { error: 'no file in the upload', saved, rejected }))
		})
		req.pipe(bb)
	})
}

/** WO-1009 (owner 09.11: "we have a built in reader"): `file` read by the lower-thirds spreadsheet reader. */
async function sheetReply(file) {
	if (!file || pf.kindOf(file) !== 'sheet') return reply(404, { ok: false, error: 'no such spreadsheet' })
	const fileName = path.basename(file)
	try {
		const lib = await import(pathToFileURL(path.join(REPO_ROOT, 'client', 'lib', 'lower-third-roster-import.js')).href)
		const { headers, rows } = await lib.parseSpreadsheetFile(new File([fs.readFileSync(file)], fileName))
		return reply(200, { ok: true, fileName, headers, rows: rows.slice(0, SHEET_ROWS), total: rows.length })
	} catch (e) {
		return reply(200, { ok: false, fileName, error: String(e?.message || e) })
	}
}

function nameOf(path, suffix = '') {
	const rest = String(path).slice('/api/project-files/'.length)
	const raw = suffix && rest.endsWith(suffix) ? rest.slice(0, -suffix.length) : rest
	try {
		return decodeURIComponent(raw)
	} catch {
		return ''
	}
}

function handleGet(ctx, path) {
	if (String(path).endsWith('/sheet')) return sheetReply(pf.resolve(ctx, nameOf(path, '/sheet')))
	const name = nameOf(path)
	const p = pf.resolve(ctx, name)
	if (!p) return reply(404, { error: `no such project file: ${name}` })
	return { status: 200, headers: { 'Content-Type': pf.mimeOf(p), 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(pf.cleanName(name))}` }, body: fs.readFileSync(p) }
}

/** An .mvr already in the folder → the previs (same store and reply as POST /api/stage/mvr). */
async function handleMvr(ctx, path) {
	const name = nameOf(path, '/mvr')
	const p = pf.resolve(ctx, name)
	if (!p || pf.kindOf(p) !== 'mvr') return reply(404, { error: `no such MVR in the project folder: ${name}` })
	try {
		return reply(200, await require('./routes-stage-mvr').importReply(fs.readFileSync(p), pf.cleanName(name)))
	} catch (e) {
		return reply(400, { error: `MVR import failed: ${e.message}` })
	}
}

function register(routes) {
	const opt = { requireCaspar: false }
	routes.get('/api/project-files', ({ ctx }) => reply(200, pf.list(ctx)), opt)
	routes.post('/api/project-files', ({ req, ctx }) => handleUpload(req, ctx), opt)
	routes.get('/api/project-files/*', ({ ctx, path }) => handleGet(ctx, path), opt)
	routes.post('/api/project-files/*', ({ ctx, path }) => (String(path).endsWith('/mvr') ? handleMvr(ctx, path) : reply(404, { error: 'unknown project-files path' })), opt)
	routes.get('/api/media-docs', ({ ctx }) => reply(200, pf.listMediaDocs(ctx.config)), opt)
	routes.get('/api/media-docs/file', ({ ctx, query }) => {
		const p = pf.resolveMediaDoc(ctx.config, query?.id)
		if (!p) return reply(404, { error: `no such document: ${query?.id || ''}` })
		return { status: 200, headers: { 'Content-Type': pf.mimeOf(p) }, body: fs.readFileSync(p) }
	}, opt)
	routes.get('/api/media-docs/sheet', ({ ctx, query }) => sheetReply(pf.resolveMediaDoc(ctx.config, query?.id)), opt)
	routes.delete('/api/media-docs/file', ({ ctx, query }) => {
		const p = pf.resolveMediaDoc(ctx.config, query?.id)
		if (!p) return reply(404, { error: `no such document: ${query?.id || ''}` })
		fs.rmSync(p)
		ctx?.log?.('info', `[project-files] removed ${query.id}`)
		changed(ctx)
		return reply(200, { ok: true, id: query.id })
	}, opt)
	routes.delete('/api/project-files/*', ({ ctx, path }) => {
		const name = nameOf(path)
		if (!pf.remove(ctx, name)) return reply(404, { error: `no such project file: ${name}` })
		ctx?.log?.('info', `[project-files] removed ${name}`)
		changed(ctx)
		return reply(200, { ok: true, name })
	}, opt)
}

module.exports = { register, handleUpload }
