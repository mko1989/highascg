'use strict'

/**
 * WO-615 T2 — GDTF fixture types (src/fixtures/gdtf-store.js):
 *   GET    /api/fixtures/types                       → { types: [summary] }  (name, maker, modes: name / footprint)
 *   POST   /api/fixtures/types                       → multipart, one .gdtf → summary (parsed, stored in projects/_gdtf/)
 *   GET    /api/fixtures/types/<id>                  → summary + geometry tree, models, wheels, attributes
 *   GET    /api/fixtures/types/<id>/mode?name=<m>    → { name, geometry, breaks, footprint, channels[], warnings }
 *   GET    /api/fixtures/types/<id>/file?path=<p>    → an archive member (wheel image, model)
 *   DELETE /api/fixtures/types/<id>
 */

const path = require('path')
const store = require('../fixtures/gdtf-store')
const { readUpload } = require('./routes-stage-mvr')
const { JSON_HEADERS, jsonBody } = require('./response')

const reply = (status, o) => ({ status, headers: JSON_HEADERS, body: jsonBody(o) })
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
	'.glb': 'model/gltf-binary', '.3ds': 'application/octet-stream', '.xml': 'application/xml' }

async function handleUpload(req, deps = {}) {
	const up = await (deps.readUpload || readUpload)(req)
	if (up.error) return reply(400, { error: up.error })
	try {
		return reply(200, await store.importGdtf(up.file.buf, up.file.name))
	} catch (e) {
		return reply(400, { error: `GDTF import failed: ${e.message}` })
	}
}

async function handleGet(p, query) {
	const m = /^\/api\/fixtures\/types\/([0-9a-f]{12})(?:\/(mode|file))?$/.exec(p)
	if (!m) return reply(404, { error: 'unknown fixture-type path' })
	if (m[2] === 'mode') {
		const mode = store.mode(m[1], String(query?.name ?? ''))
		return mode ? reply(200, mode) : reply(404, { error: 'no such fixture type or mode' })
	}
	if (m[2] === 'file') {
		const file = String(query?.path || '')
		const buf = await store.member(m[1], file)
		if (!buf) return reply(404, { error: 'no such file in the fixture type' })
		const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream'
		return { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'max-age=86400' }, body: buf }
	}
	const d = store.describe(m[1])
	return d ? reply(200, d) : reply(404, { error: 'no such fixture type' })
}

function register(routes) {
	const opt = { requireCaspar: false }
	routes.get('/api/fixtures/types', () => reply(200, { types: store.list() }), opt)
	routes.post('/api/fixtures/types', ({ req }) => handleUpload(req), opt)
	routes.get('/api/fixtures/types/*', ({ path: p, query }) => handleGet(p, query), opt)
	routes.delete('/api/fixtures/types/*', ({ path: p }) => {
		const m = /^\/api\/fixtures\/types\/([0-9a-f]{12})$/.exec(p)
		return m && store.remove(m[1]) ? reply(200, { ok: true }) : reply(404, { error: 'no such fixture type' })
	}, opt)
}

module.exports = { register, handleUpload, handleGet }
