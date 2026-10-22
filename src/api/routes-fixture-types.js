'use strict'

/**
 * WO-615 T2 — GDTF fixture types (src/fixtures/gdtf-store.js):
 *   GET    /api/fixtures/types                       → { types: [summary] }  (name, maker, modes: name / footprint)
 *   POST   /api/fixtures/types                       → multipart, one .gdtf → summary (parsed, stored in projects/_gdtf/)
 *   GET    /api/fixtures/types/<id>                  → summary + geometry tree, models, wheels, attributes
 *   GET    /api/fixtures/types/<id>/mode?name=<m>    → { name, geometry, breaks, footprint, channels[], warnings }
 *   GET    /api/fixtures/types/<id>/file?path=<p>    → an archive member (wheel image, model)
 *   GET    /api/fixtures/types/<id>/rig?mode=<m>     → WO-615 T5 previs rig: { mode, footprint, nodes[], meshes[] }
 *   GET    /api/fixtures/types/<id>/model?path=<p>   → a rig mesh as GLB (models/3ds/* converted, as WO-612)
 *   DELETE /api/fixtures/types/<id>
 *   POST   /api/fixtures/types/<id>/replace {to, modes{from: to}} → WO-633: use type <to> for <id> from now on (box-level
 *          alias, gdtf-aliases.js; the MVR patch resolves it) → the summary with `replacedBy`
 *   DELETE /api/fixtures/types/<id>/replace       → drop the alias
 * An import or delete re-resolves the fixture patch (ctx.fixtureService.reload(): typed fixtures waiting for it).
 */

const path = require('path')
const store = require('../fixtures/gdtf-store')
const aliases = require('../fixtures/gdtf-aliases')
const { threeDsToGlb } = require('../stage/mvr-3ds')
const { readUpload } = require('./routes-stage-mvr')
const { JSON_HEADERS, jsonBody } = require('./response')

const reply = (status, o) => ({ status, headers: JSON_HEADERS, body: jsonBody(o) })
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
	'.glb': 'model/gltf-binary', '.3ds': 'application/octet-stream', '.xml': 'application/xml' }

async function handleUpload(req, deps = {}) {
	const up = await (deps.readUpload || readUpload)(req)
	if (up.error) return reply(400, { error: up.error })
	try {
		const summary = await store.importGdtf(up.file.buf, up.file.name)
		deps.ctx?.fixtureService?.reload?.()
		return reply(200, summary)
	} catch (e) {
		return reply(400, { error: `GDTF import failed: ${e.message}` })
	}
}

async function handleGet(p, query) {
	const m = /^\/api\/fixtures\/types\/([0-9a-f]{12})(?:\/(mode|file|rig|model))?$/.exec(p)
	if (!m) return reply(404, { error: 'unknown fixture-type path' })
	if (m[2] === 'mode') {
		const mode = store.mode(m[1], String(query?.name ?? ''))
		return mode ? reply(200, mode) : reply(404, { error: 'no such fixture type or mode' })
	}
	if (m[2] === 'rig') {
		const v = store.visual(m[1], String(query?.mode ?? ''))
		return v ? reply(200, v.rig) : reply(404, { error: 'no such fixture type or mode' })
	}
	if (m[2] === 'model') {
		const file = String(query?.path || '')
		if (!/^models\/(gltf\/[^/]+\.glb|3ds\/[^/]+\.3ds)$/i.test(file)) return reply(400, { error: 'not a rig mesh path' })
		const buf = await store.member(m[1], file)
		if (!buf) return reply(404, { error: 'no such model in the fixture type' })
		let glb = buf
		try {
			if (!/\.glb$/i.test(file)) glb = threeDsToGlb(buf, { fixtureBody: true }) // WO-678: unspecified body → black
		} catch (e) {
			return reply(422, { error: `model conversion failed: ${e.message}` })
		}
		return { status: 200, headers: { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'max-age=86400' }, body: glb }
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

/** WO-633: both types stored, every mode named exists on its side; an empty mode map is allowed (nothing paired). */
function handleReplace(id, body, ctx) {
	const from = store.record(id)
	if (!from) return reply(404, { error: 'no such fixture type' })
	let b = body
	try {
		if (typeof b === 'string' || Buffer.isBuffer(b)) b = JSON.parse(String(b || '{}'))
	} catch {
		return reply(400, { error: 'body must be JSON' })
	}
	const to = String(b?.to || '')
	const target = to !== id ? store.record(to) : null
	if (!target) return reply(400, { error: 'replacement type not found (import the real GDTF first)' })
	const modes = {}
	for (const [f, t] of Object.entries(b?.modes && typeof b.modes === 'object' ? b.modes : {})) {
		if (!t) continue
		if (!from.type.modes.some((m) => m.name === f)) return reply(400, { error: `mode "${f}" is not in ${from.type.name}` })
		if (!target.type.modes.some((m) => m.name === t)) return reply(400, { error: `mode "${t}" is not in ${target.type.name}` })
		modes[f] = String(t)
	}
	aliases.setAlias(store.info(id), to, modes)
	ctx?.fixtureService?.reload?.()
	return reply(200, store.info(id))
}

function register(routes) {
	const opt = { requireCaspar: false }
	routes.get('/api/fixtures/types', () => reply(200, { types: store.list() }), opt)
	routes.post('/api/fixtures/types', ({ req, ctx }) => handleUpload(req, { ctx }), opt)
	routes.get('/api/fixtures/types/*', ({ path: p, query }) => handleGet(p, query), opt)
	routes.post('/api/fixtures/types/*', ({ path: p, body, ctx }) => {
		const m = /^\/api\/fixtures\/types\/([0-9a-f]{12})\/replace$/.exec(p)
		return m ? handleReplace(m[1], body, ctx) : reply(404, { error: 'unknown fixture-type path' })
	}, opt)
	routes.delete('/api/fixtures/types/*', ({ path: p, ctx }) => {
		const r = /^\/api\/fixtures\/types\/([0-9a-f]{12})\/replace$/.exec(p)
		if (r) {
			if (!aliases.clearAlias(r[1])) return reply(404, { error: 'no replacement set for this type' })
			ctx?.fixtureService?.reload?.()
			return reply(200, { ok: true })
		}
		const m = /^\/api\/fixtures\/types\/([0-9a-f]{12})$/.exec(p)
		if (!m || !store.remove(m[1])) return reply(404, { error: 'no such fixture type' })
		ctx?.fixtureService?.reload?.()
		return reply(200, { ok: true })
	}, opt)
}

module.exports = { register, handleUpload, handleGet, handleReplace }
