'use strict'

/**
 * WO-612 — MVR scene import for the Godot previs stage (core; works without the web previs module).
 *   GET    /api/stage/mvr                     → { scenes: [{ id, name, importedAt, bytes, objects }] }
 *   POST   /api/stage/mvr                     → multipart, one .mvr file → { id, name, version, layers, objects,
 *                                                meshes, report } (parsed + stored in projects/_mvr/)
 *   GET    /api/stage/mvr/<id>                → the stored record { id, name, importedAt, bytes, scene }
 *   GET    /api/stage/mvr/<id>/mesh?key=<k>   → model/gltf-binary for a scene mesh key (Godot instantiates per part)
 *   POST   /api/stage/mvr/<id>/patch {protocol} → WO-615 T10: the scene's fixtures as patch entries { fixtures, skipped,
 *                                                notes, types } — every embedded GDTF it uses is imported into the
 *                                                fixture-type store; the client merges `fixtures` into project.fixtures
 *   DELETE /api/stage/mvr/<id>
 */

const busboy = require('busboy')
const store = require('../stage/mvr-store')
const { buildStageMvr } = require('../stage/mvr-export')
const { buildMvrPatch } = require('../stage/mvr-patch')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')

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

/**
 * WO-615 T10 — POST /api/stage/mvr/<id>/patch {protocol: "artnet" | "sacn"}. Imports each GDTFSpec's embedded file once
 * (gdtf-store ensureGdtf: content-addressed, an already-known type is not re-parsed), then builds the entries.
 * @param {{ fixtureScene?: Function, ensureGdtf?: Function }} [deps]
 */
async function handlePatch(ctx, id, body, deps = {}) {
	const fixtureScene = deps.fixtureScene || store.fixtureScene
	const ensureGdtf = deps.ensureGdtf || require('../fixtures/gdtf-store').ensureGdtf
	const b = parseBody(body) || {}
	const protocol = b.protocol === 'sacn' ? 'sacn' : 'artnet'
	const sc = await fixtureScene(id)
	if (!sc) return reply(404, { error: 'no such MVR scene' })
	const types = new Map()
	for (const spec of new Set(sc.objects.map((o) => o.fixture.spec).filter(Boolean))) {
		const g = await sc.gdtf(spec)
		if (!g) {
			types.set(spec, null)
			continue
		}
		try {
			types.set(spec, await ensureGdtf(g.buf, g.name))
		} catch (e) {
			types.set(spec, { error: `GDTF "${spec}" could not be read: ${e.message}` })
		}
	}
	const out = buildMvrPatch(sc.objects, { protocol, typeFor: (spec) => types.get(spec) ?? null })
	if (types.size) ctx?.fixtureService?.reload?.()
	const byId = new Map() // two GDTFSpec spellings of one file ("X" / "X.gdtf") are one type
	for (const [spec, t] of types) if (t && !t.error && !byId.has(t.id)) byId.set(t.id, { spec, t })
	const used = [...byId.values()].map(({ spec, t }) => ({ spec, id: t.id, name: t.name,
		manufacturer: t.manufacturer, fixtures: out.fixtures.filter((f) => f.typeId === t.id).length }))
	return reply(200, { protocol, ...out, types: used })
}

/**
 * WO-612 T7 — GET /api/stage/mvr-export → the project's WO-614 stage as an .mvr download. Crops are described against
 * each role's live raster (pgmN / prvN → that channel's resolution); other roles use the crops' bounding box.
 * @param {object} ctx  @param {{ loadProject?: () => object }} [deps]
 */
function handleExport(ctx, deps = {}) {
	const loadProject = deps.loadProject || (() => require('../engine/project-scenes').loadFullProject())
	const project = loadProject() || {}
	const objects = project?.previs?.stage?.objects
	if (!Array.isArray(objects) || !objects.length) return reply(404, { error: 'The stage is empty — add LED walls, TVs or projection screens first.' })
	const rasterFor = (role) => {
		const m = /^(pgm|prv)(\d+)$/.exec(role)
		if (!m) return null
		try {
			const { getChannelMap } = require('../config/routing-map')
			const { getChannelResolutionForChannel } = require('../engine/scene-native-fill')
			const map = getChannelMap(ctx?.config || {})
			const ch = m[1] === 'pgm' ? map.programCh(Number(m[2])) : map.previewCh(Number(m[2]))
			return ch ? getChannelResolutionForChannel(ctx.config, ch, ctx) : null
		} catch {
			return null
		}
	}
	const name = String(project.name || 'HighAsCG stage')
	const { buffer, report } = buildStageMvr(objects, { name, rasterFor })
	const file = `${name.replace(/[^\w.-]+/g, '_') || 'stage'}.mvr`
	return { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${file}"`,
		'X-MVR-Screens': String(report.screens) }, body: buffer }
}

function register(routes) {
	const opt = { requireCaspar: false }
	routes.get('/api/stage/mvr', () => reply(200, { scenes: store.list() }), opt)
	routes.get('/api/stage/mvr-export', ({ ctx }) => handleExport(ctx), opt)
	routes.post('/api/stage/mvr', ({ req }) => handleUpload(req), opt)
	routes.get('/api/stage/mvr/*', ({ path, query }) => handleGet(path, query), opt)
	routes.post('/api/stage/mvr/*', ({ ctx, path, body }) => {
		const m = /^\/api\/stage\/mvr\/([0-9a-f]{12})\/patch$/.exec(path)
		return m ? handlePatch(ctx, m[1], body) : reply(404, { error: 'unknown MVR path' })
	}, opt)
	routes.delete('/api/stage/mvr/*', ({ path }) => {
		const id = String(path).split('/').pop()
		return store.remove(id) ? reply(200, { ok: true, id }) : reply(404, { error: 'no such MVR scene' })
	}, opt)
}

module.exports = { register, handleExport, handlePatch, readUpload }
