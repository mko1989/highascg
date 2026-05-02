/**
 * Previs model storage routes (WO-17 T2.2).
 *
 * Stores user-supplied `.glb` / `.gltf` / `.obj` / `.fbx` files on disk under
 * `<repo>/.highascg-previs/models/<id>.<ext>` and tracks metadata in the shared
 * persistence store under key `previs.models`.
 *
 * Endpoints (all mount prefix `/api/previs`):
 *
 *   GET    /api/previs/models             → list { id, name, filename, ext, sizeBytes, uploadedAt }
 *   POST   /api/previs/models             → multipart upload; busboy streams one file per request.
 *   GET    /api/previs/models/:id         → download the binary (model/gltf-binary for .glb).
 *   DELETE /api/previs/models/:id         → remove record + file.
 *
 * Side-car only (no imports from outside `src/previs/`), so the whole module remains
 * deletable in one command. Busboy is already a dependency of the core app
 * (`src/api/routes-ingest.js`) so no new package is needed.
 *
 * Limits:
 *   - Per-file cap: 100 MB (hard-coded; matches WO-17 T2.2).
 *   - Allowed extensions: `.glb`, `.gltf`, `.obj`, `.fbx`.
 *   - Any other file in the multipart is dropped without recording.
 */

'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const busboy = require('busboy')

const persistence = require('../utils/persistence')

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' }
const STATE_KEY = 'previs.models'
const MAX_BYTES = 100 * 1024 * 1024
const ALLOWED_EXT = new Set(['.glb', '.gltf', '.obj', '.fbx'])

const EXT_MIME = {
	'.glb': 'model/gltf-binary',
	'.gltf': 'model/gltf+json',
	'.obj': 'text/plain; charset=utf-8',
	'.fbx': 'application/octet-stream',
}

function getStorageRoot() {
	return path.join(__dirname, '..', '..', '.highascg-previs', 'models')
}

function ensureStorageRoot() {
	const dir = getStorageRoot()
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
	return dir
}

/**
 * @typedef {Object} ModelRecord
 * @property {string} id                 Short hex id used in URLs and on-disk filename.
 * @property {string} name               Human-friendly display name (defaults to the original filename).
 * @property {string} filename           Original uploaded filename, as reported by the browser.
 * @property {string} ext                Canonical extension (`.glb`, etc.) — matches the on-disk file.
 * @property {number} sizeBytes
 * @property {string} uploadedAt         ISO 8601.
 */

/** @returns {ModelRecord[]} */
function listRecords() {
	const v = persistence.get(STATE_KEY)
	return Array.isArray(v) ? v.slice() : []
}

/** @param {ModelRecord[]} records */
function saveRecords(records) {
	persistence.set(STATE_KEY, records)
}

function jsonResp(status, payload) {
	return { status, headers: JSON_HEADERS, body: JSON.stringify(payload) }
}

function notFound() {
	return jsonResp(404, { error: 'not found' })
}

/**
 * Route dispatcher for every `/api/previs/models*` request. Returns `null` if no route
 * matched so the caller can fall through to other routes.
 *
 * @param {{ method: string, path: string, body: string, req: import('http').IncomingMessage | undefined, ctx: any }} reqInfo
 * @returns {Promise<any | null>}
 */
async function handle(reqInfo) {
	const { method, path: reqPath, req } = reqInfo
	if (!reqPath.startsWith('/api/previs/models')) return null

	const rest = reqPath.slice('/api/previs/models'.length).replace(/^\/+/, '')

	if (!rest) {
		if (method === 'GET') return handleList()
		if (method === 'POST') return handleUpload(req, reqInfo.ctx)
		return jsonResp(405, { error: `method ${method} not allowed on /api/previs/models` })
	}

	const [id, sub] = rest.split('/')
	if (!id) return notFound()
	if (sub) return notFound()

	if (method === 'GET') return handleDownload(id)
	if (method === 'DELETE') return handleDelete(id, reqInfo.ctx)
	return jsonResp(405, { error: `method ${method} not allowed on /api/previs/models/${id}` })
}

function handleList() {
	return jsonResp(200, { models: listRecords() })
}

/**
 * @param {import('http').IncomingMessage | undefined} req
 * @param {any} ctx
 */
function handleUpload(req, ctx) {
	return new Promise((resolve) => {
		if (!req || !req.headers) {
			resolve(jsonResp(400, { error: 'upload requires a request stream' }))
			return
		}
		const contentType = String(req.headers['content-type'] || '').toLowerCase()
		if (!contentType.startsWith('multipart/')) {
			resolve(jsonResp(400, { error: 'expected multipart/form-data' }))
			return
		}

		let storage
		try {
			storage = ensureStorageRoot()
		} catch (err) {
			resolve(jsonResp(500, { error: `cannot create storage dir: ${err.message}` }))
			return
		}

		let bb
		try {
			bb = busboy({ headers: req.headers, limits: { fileSize: MAX_BYTES, files: 1 } })
		} catch (err) {
			resolve(jsonResp(400, { error: `bad multipart body: ${err.message}` }))
			return
		}

		let displayName = ''
		let resolved = false
		let fileSeen = false
		const settle = (result) => {
			if (resolved) return
			resolved = true
			resolve(result)
		}

		bb.on('field', (name, value) => {
			if (name === 'name' && typeof value === 'string') displayName = value.slice(0, 200)
		})

		bb.on('file', (_name, file, info) => {
			fileSeen = true
			const filename = (info && info.filename) || 'model'
			const ext = path.extname(filename).toLowerCase()
			if (!ALLOWED_EXT.has(ext)) {
				file.resume()
				settle(jsonResp(415, { error: `unsupported model format: ${ext || '(none)'}`, allowed: [...ALLOWED_EXT] }))
				return
			}

			const id = crypto.randomBytes(8).toString('hex')
			const savePath = path.join(storage, id + ext)
			const writeStream = fs.createWriteStream(savePath)

			let bytes = 0
			let truncated = false
			file.on('data', (chunk) => { bytes += chunk.length })
			file.on('limit', () => { truncated = true })

			file.pipe(writeStream)

			const cleanupAndFail = (err) => {
				try { writeStream.destroy() } catch {}
				fs.promises.unlink(savePath).catch(() => {})
				settle(jsonResp(500, { error: err.message || String(err) }))
			}
			writeStream.on('error', cleanupAndFail)
			file.on('error', cleanupAndFail)

			writeStream.on('finish', () => {
				if (truncated) {
					fs.promises.unlink(savePath).catch(() => {})
					settle(jsonResp(413, { error: `file exceeds ${MAX_BYTES} bytes` }))
					return
				}
				/** @type {ModelRecord} */
				const record = {
					id,
					name: displayName || filename,
					filename,
					ext,
					sizeBytes: bytes,
					uploadedAt: new Date().toISOString(),
				}
				const records = listRecords()
				records.push(record)
				saveRecords(records)
				if (ctx && typeof ctx.log === 'function') {
					ctx.log('info', `[previs] stored model ${record.id} (${record.name}, ${bytes} bytes)`)
				}
				settle(jsonResp(201, { model: record }))
			})
		})

		bb.on('error', (err) => settle(jsonResp(500, { error: err.message })))
		// `bb` finishes parsing before the writeStream drains; only fall through with a 400
		// when no file field was seen at all. The `file` handler owns the success/failure
		// path for real uploads.
		bb.on('close', () => { if (!fileSeen) settle(jsonResp(400, { error: 'no file field present' })) })

		req.pipe(bb)
	})
}

/**
 * @param {string} id
 */
async function handleDownload(id) {
	const rec = listRecords().find((r) => r.id === id)
	if (!rec) return notFound()
	const diskPath = path.join(getStorageRoot(), id + rec.ext)
	try {
		await fs.promises.access(diskPath, fs.constants.R_OK)
	} catch {
		return jsonResp(410, { error: 'file missing from disk — record will be cleaned up', id })
	}
	const stream = fs.createReadStream(diskPath)
	const mime = EXT_MIME[rec.ext] || 'application/octet-stream'
	return {
		status: 200,
		headers: {
			'Content-Type': mime,
			'Content-Disposition': `attachment; filename="${encodeURIComponent(rec.filename)}"`,
			'Cache-Control': 'no-store',
		},
		stream,
	}
}

/**
 * @param {string} id
 * @param {any} ctx
 */
async function handleDelete(id, ctx) {
	const records = listRecords()
	const idx = records.findIndex((r) => r.id === id)
	if (idx < 0) return notFound()
	const [removed] = records.splice(idx, 1)
	saveRecords(records)
	const diskPath = path.join(getStorageRoot(), removed.id + removed.ext)
	try { await fs.promises.unlink(diskPath) } catch {}
	if (ctx && typeof ctx.log === 'function') {
		ctx.log('info', `[previs] removed model ${removed.id} (${removed.name})`)
	}
	return jsonResp(200, { ok: true, id: removed.id })
}

module.exports = { handle, listRecords, getStorageRoot }
