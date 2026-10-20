'use strict'

/**
 * WO-612 — MVR scene import for the Godot previs stage (core; works without the web previs module).
 *   GET    /api/stage/mvr                     → { scenes: [{ id, name, importedAt, bytes, objects }] }
 *   POST   /api/stage/mvr                     → multipart, one .mvr file → { id, name, version, layers, objects,
 *                                                meshes, report } (parsed + stored in projects/_mvr/)
 *   GET    /api/stage/mvr/<id>                → the stored record { id, name, importedAt, bytes, scene }
 *   GET    /api/stage/mvr/<id>/mesh?key=<k>   → model/gltf-binary for a scene mesh key (Godot instantiates per part)
 *   DELETE /api/stage/mvr/<id>
 */

const busboy = require('busboy')
const store = require('../stage/mvr-store')
const { JSON_HEADERS, jsonBody } = require('./response')

const MAX_BYTES = 300 * 1024 * 1024
const reply = (status, o) => ({ status, headers: JSON_HEADERS, body: jsonBody(o) })

function readUpload(req) {
	return new Promise((resolve) => {
		let file = null
		let error = null
		let bb
		try {
			bb = busboy({ headers: req.headers, defParamCharset: 'utf8', limits: { files: 1, fileSize: MAX_BYTES } })
		} catch (e) {
			resolve({ error: `multipart upload expected: ${e.message}` })
			return
		}
		bb.on('file', (_field, stream, info) => {
			const parts = []
			stream.on('data', (d) => parts.push(d))
			stream.on('limit', () => (error = `file over ${MAX_BYTES / 1048576} MB`))
			stream.on('end', () => (file = { name: info.filename || 'scene.mvr', buf: Buffer.concat(parts) }))
		})
		bb.on('error', (e) => resolve({ error: String(e?.message || e) }))
		bb.on('close', () => resolve(error ? { error } : file ? { file } : { error: 'no file in the upload' }))
		req.pipe(bb)
	})
}

async function handleUpload(req) {
	const up = await readUpload(req)
	if (up.error) return reply(400, { error: up.error })
	try {
		const rec = await store.importMvr(up.file.buf, up.file.name)
		const s = rec.scene
		return reply(200, { id: rec.id, name: rec.name, version: s.version, provider: s.provider, layers: s.layers.length,
			objects: s.objects.length, meshes: s.meshes.length, report: s.report })
	} catch (e) {
		return reply(400, { error: `MVR import failed: ${e.message}` })
	}
}

async function handleGet(path, query) {
	const m = /^\/api\/stage\/mvr\/([0-9a-f]{12})(\/mesh)?$/.exec(path)
	if (!m) return reply(404, { error: 'unknown MVR path' })
	if (m[2]) {
		const glb = await store.mesh(m[1], String(query?.key || ''))
		if (!glb) return reply(404, { error: 'no such mesh' })
		return { status: 200, headers: { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'max-age=86400' }, body: glb }
	}
	const rec = store.get(m[1])
	return rec ? reply(200, rec) : reply(404, { error: 'no such MVR scene' })
}

function register(routes) {
	const opt = { requireCaspar: false }
	routes.get('/api/stage/mvr', () => reply(200, { scenes: store.list() }), opt)
	routes.post('/api/stage/mvr', ({ req }) => handleUpload(req), opt)
	routes.get('/api/stage/mvr/*', ({ path, query }) => handleGet(path, query), opt)
	routes.delete('/api/stage/mvr/*', ({ path }) => {
		const id = String(path).split('/').pop()
		return store.remove(id) ? reply(200, { ok: true, id }) : reply(404, { error: 'no such MVR scene' })
	}, opt)
}

module.exports = { register }
