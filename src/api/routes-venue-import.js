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

/**
 * Stream one uploaded file into session `s` → { error } | { done: Promise<{ rel, error? }> }. WO-1106 B4: bytes are
 * charged while they arrive (per-session + total caps); an over-cap file is cut off and removed.
 */
function receive(s, name, stream) {
	const t = job.target(s, name)
	if (t.error) return t
	const out = fs.createWriteStream(t.abs)
	let over = false, why = '', bytes = 0
	stream.on('limit', () => (over = true))
	stream.on('data', (c) => {
		if (why) return
		why = job.charge(s, c.length)
		if (why) {
			stream.unpipe(out)
			out.destroy()
			stream.resume()
		} else bytes += c.length
	})
	stream.pipe(out)
	const done = new Promise((resolve) => {
		let err = ''
		out.on('error', (e) => (err = String(e?.message || e)))
		out.on('close', () => {
			const error = err || why || (over ? 'file over 2 GB' : '')
			if (error) {
				try {
					fs.rmSync(t.abs, { force: true })
				} catch {
					/* not a file (B2): nothing of ours to remove */
				}
			}
			job.settle(s, t.rel, bytes, !error)
			resolve({ rel: t.rel, error })
		})
	})
	return { done }
}

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
			const name = relPath || info.filename
			relPath = ''
			try {
				const w = receive(s, name, stream)
				if (w.error) {
					rejected.push({ name: String(info.filename || ''), error: w.error })
					stream.resume()
				} else writes.push(w.done.then((r) => (r.error ? rejected.push({ name: r.rel, error: r.error }) : saved.push(r.rel))))
			} catch (e) {
				// WO-1106 B2: nothing thrown in a busboy listener may reach uncaughtException (= node exit)
				rejected.push({ name: String(info.filename || ''), error: String(e?.message || e) })
				stream.resume()
			}
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
