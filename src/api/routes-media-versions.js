/**
 * WO-592 B — media version control HTTP surface (media-file inspector "Versions").
 *
 *   POST /api/media/version/upload?path=<media id>   multipart, ONE file (same extension) → new current version
 *   POST /api/media/version/restore  { path, v }      go back to an old version (current becomes a version)
 *   POST /api/media/version/purge    { path, v }      delete one old version — final
 */
'use strict'

const fs = require('fs')
const path = require('path')
const busboy = require('busboy')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const registry = require('../media/media-library-registry')
const versions = require('../media/media-versions')

const reply = (status, body) => ({ status, headers: JSON_HEADERS, body: jsonBody(body) })

function publicEntry(e) {
	return { id: e.id, path: e.path, currentV: e.currentV || 1, versions: e.versions || [], defaults: e.defaults || {} }
}

function afterChange(ctx) {
	if (typeof ctx.runMediaLibraryQueryCycle === 'function') ctx.runMediaLibraryQueryCycle()
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {object} ctx
 * @param {Record<string, string>} query
 */
function handleVersionUpload(req, ctx, query) {
	const mediaPath = String(query?.path || '').trim()
	if (!mediaPath || mediaPath.includes('..')) return Promise.resolve(reply(400, { error: 'path required' }))
	const e = registry.getEntryByPath(mediaPath)
	if (!e) return Promise.resolve(reply(404, { error: 'not in media library' }))
	const ext = path.extname(mediaPath).toLowerCase()
	return new Promise((resolve) => {
		let staged = null
		let error = null
		let writing = null
		const bb = busboy({ headers: req.headers, defParamCharset: 'utf8', limits: { files: 1 } })
		bb.on('file', (_name, file, info) => {
			const incomingExt = path.extname(String(info.filename || '')).toLowerCase()
			if (incomingExt !== ext) {
				error = `the new version must be a ${ext} file (got ${incomingExt || 'no extension'})`
				file.resume()
				return
			}
			staged = versions.stagingPathFor(e.id, ext)
			fs.mkdirSync(path.dirname(staged), { recursive: true })
			const ws = fs.createWriteStream(staged)
			writing = new Promise((done) => {
				ws.on('finish', done)
				ws.on('error', (err) => {
					error = `upload failed: ${err?.message || err}`
					file.resume()
					done()
				})
			})
			file.on('error', (err) => {
				error = `upload failed: ${err?.message || err}`
				ws.destroy()
			})
			file.pipe(ws)
		})
		bb.on('close', async () => {
			if (writing) await writing
			if (!error && !staged) error = 'no file in upload'
			if (error) {
				if (staged) fs.rmSync(staged, { force: true })
				return resolve(reply(400, { error }))
			}
			const r = versions.installNewVersion(ctx.config || {}, mediaPath, staged)
			if (!r.ok) {
				fs.rmSync(staged, { force: true })
				return resolve(reply(r.status, { error: r.error }))
			}
			ctx.log?.('info', `[media-versions] ${mediaPath}: new version v${r.entry.currentV}`)
			afterChange(ctx)
			resolve(reply(200, { ok: true, entry: publicEntry(r.entry) }))
		})
		bb.on('error', (err) => resolve(reply(400, { error: `upload failed: ${err?.message || err}` })))
		req.pipe(bb)
	})
}

function handleVersionRestore(body, ctx) {
	const b = parseBody(body) || {}
	const p = String(b.path || '').trim()
	if (!p || p.includes('..')) return reply(400, { error: 'path required' })
	const r = versions.restoreVersion(ctx.config || {}, p, b.v)
	if (!r.ok) return reply(r.status, { error: r.error })
	ctx.log?.('info', `[media-versions] ${p}: restored v${r.entry.currentV}`)
	afterChange(ctx)
	return reply(200, { ok: true, entry: publicEntry(r.entry) })
}

function handleVersionPurge(body) {
	const b = parseBody(body) || {}
	const p = String(b.path || '').trim()
	if (!p || p.includes('..')) return reply(400, { error: 'path required' })
	const r = versions.purgeVersion(p, b.v)
	if (!r.ok) return reply(r.status, { error: r.error })
	return reply(200, { ok: true, entry: publicEntry(r.entry) })
}

module.exports = { handleVersionUpload, handleVersionRestore, handleVersionPurge, publicEntry }
