'use strict'

/**
 * WO-1098 — venue import: an OBJ (+ MTL + texture folder, or one zip of them; a SketchUp .skp for its pictures only)
 * → a venue .glb in the project folder (src/media/venue-import-job.js, src/stage/venue-convert.js):
 *   POST /api/venue-import/files?session=<id>  → multipart, one or more files; a file's folder path is kept (busboy
 *                                                preservePath; a `path` field before the file sets it too) →
 *                                                { session, files: [rel…], saved: [rel…], rejected: [{ name, error }] }
 *   POST /api/venue-import/start                 { session, options?: { name, units, up, budget } } → the job
 *   GET  /api/venue-import                       → the job { state: idle|running|done|error|cancelled, phase, text,
 *                                                  done, total, name, report?, error? }
 *   POST /api/venue-import/cancel                → the job (cancelled)
 * Progress is broadcast as WS `change` { path: 'venueImport' }; the finished .glb as `projectFiles`.
 */

const fs = require('fs')
const busboy = require('busboy')
const job = require('../media/venue-import-job')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')

const MAX_BYTES = 2 * 1024 * 1024 * 1024
const reply = (status, o) => ({ status, headers: JSON_HEADERS, body: jsonBody(o) })

function handleFiles(req, ctx, query) {
	return new Promise((resolve) => {
		const s = job.session(query?.session)
		const saved = [], rejected = [], writes = []
		let relPath = ''
		let bb
		try {
			bb = busboy({ headers: req.headers, defParamCharset: 'utf8', preservePath: true, limits: { fileSize: MAX_BYTES } })
		} catch (e) {
			resolve(reply(400, { error: `multipart upload expected: ${e.message}` }))
			return
		}
		bb.on('field', (name, val) => {
			if (name === 'path') relPath = String(val || '')
		})
		bb.on('file', (_field, stream, info) => {
			const t = job.target(s, relPath || info.filename)
			relPath = ''
			if (t.error) {
				rejected.push({ name: String(info.filename || ''), error: t.error })
				stream.resume()
				return
			}
			const out = fs.createWriteStream(t.abs)
			let over = false
			stream.on('limit', () => (over = true))
			stream.pipe(out)
			writes.push(new Promise((done) => {
				out.on('error', (e) => {
					rejected.push({ name: t.rel, error: String(e?.message || e) })
					done()
				})
				out.on('finish', () => {
					if (over) {
						fs.rmSync(t.abs, { force: true })
						rejected.push({ name: t.rel, error: 'file over 2 GB' })
					} else {
						s.files.add(t.rel)
						saved.push(t.rel)
					}
					done()
				})
			}))
		})
		bb.on('error', (e) => resolve(reply(400, { error: String(e?.message || e) })))
		bb.on('close', async () => {
			await Promise.all(writes)
			const body = { session: s.id, files: [...s.files].sort(), saved, rejected }
			if (!saved.length && rejected.length) return resolve(reply(415, { error: rejected[0].error, ...body }))
			resolve(reply(saved.length ? 200 : 400, saved.length ? body : { error: 'no file in the upload', ...body }))
		})
		req.pipe(bb)
	})
}

function register(routes) {
	const opt = { requireCaspar: false }
	routes.get('/api/venue-import', () => reply(200, job.snapshot()), opt)
	routes.post('/api/venue-import/files', ({ req, ctx, query }) => handleFiles(req, ctx, query), opt)
	routes.post('/api/venue-import/start', ({ ctx, body }) => {
		let b
		try {
			b = parseBody(body) || {}
		} catch {
			return reply(400, { error: 'JSON body expected' })
		}
		const o = b.options && typeof b.options === 'object' ? b.options : {}
		const opts = {}
		if (o.name) opts.name = String(o.name)
		if (['m', 'cm', 'mm', 'in', 'ft'].includes(o.units)) opts.units = o.units
		if (o.up === 'y' || o.up === 'z') opts.up = o.up
		if (Number.isFinite(Number(o.budget)) && Number(o.budget) >= 0) opts.budget = Math.min(2e6, Math.round(Number(o.budget)))
		const r = job.start(ctx, b.session, opts)
		return reply(r.status, r.body)
	}, opt)
	routes.post('/api/venue-import/cancel', ({ ctx }) => {
		const r = job.cancel(ctx)
		return reply(r.status, r.body)
	}, opt)
}

module.exports = { register }
