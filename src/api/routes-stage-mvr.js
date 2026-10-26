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
 *   POST   /api/stage/mvr/<id>/types         → WO-636: only the import — the scene's GDTFs into the type store, no
 *                                                patch → { types: [{ spec, id, name, manufacturer, placeholder,
 *                                                replacedBy? }], missing }
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
 * Each GDTFSpec the scene's fixtures use → its stored type (imported once: gdtf-store ensureGdtf is content-addressed,
 * an already-known type is not re-parsed); null = not in the file, { error } = unreadable.
 */
async function sceneTypes(sc, deps = {}) {
	const ensureGdtf = deps.ensureGdtf || require('../fixtures/gdtf-store').ensureGdtf
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
	return types
}

/**
 * WO-636 — POST /api/stage/mvr/<id>/types: the scene's fixture types into the store when the scene is shown, so the
 * Fixtures section and Replace… (WO-633) list them before anything is patched.
 * @param {{ fixtureScene?: Function, ensureGdtf?: Function }} [deps]
 */
async function handleTypes(ctx, id, deps = {}) {
	const sc = await (deps.fixtureScene || store.fixtureScene)(id)
	if (!sc) return reply(404, { error: 'no such MVR scene' })
	const types = await sceneTypes(sc, deps)
	if (types.size) ctx?.fixtureService?.reload?.()
	const seen = new Set()
	const out = []
	for (const [spec, t] of types) {
		if (!t || t.error || seen.has(t.id)) continue
		seen.add(t.id)
		// WO-785: the modes this scene's fixtures use (GDTF Share matching weighs them first)
		const used = [...new Set(sc.objects.filter((o) => o.fixture?.spec === spec).map((o) => String(o.fixture.mode || '')).filter(Boolean))]
		out.push({ spec, id: t.id, name: t.name, manufacturer: t.manufacturer, placeholder: !!t.placeholder, used,
			...(t.replacedBy ? { replacedBy: t.replacedBy.to } : {}) })
	}
	return reply(200, { types: out, missing: [...types].filter(([, t]) => !t || t.error).map(([spec]) => spec) })
}

/**
 * WO-615 T10 — POST /api/stage/mvr/<id>/patch {protocol: "artnet" | "sacn"}. Imports each GDTFSpec's embedded file once
 * (gdtf-store ensureGdtf: content-addressed, an already-known type is not re-parsed), then builds the entries.
 * @param {{ fixtureScene?: Function, ensureGdtf?: Function, typeInfo?: Function }} [deps]
 */
async function handlePatch(ctx, id, body, deps = {}) {
	const fixtureScene = deps.fixtureScene || store.fixtureScene
	const b = parseBody(body) || {}
	const protocol = b.protocol === 'sacn' ? 'sacn' : 'artnet'
	const sc = await fixtureScene(id)
	if (!sc) return reply(404, { error: 'no such MVR scene' })
	const types = await sceneTypes(sc, deps)
	for (const [spec, t] of types) {
		// WO-633: a placeholder the operator replaced → the real type, modes translated (unpaired ones keep the stub)
		const real = t?.replacedBy ? (deps.typeInfo || require('../fixtures/gdtf-store').info)(t.replacedBy.to) : null
		if (real) types.set(spec, { ...real, modeMap: t.replacedBy.modes, stub: t })
	}
	const out = buildMvrPatch(sc.objects, { protocol, typeFor: (spec) => types.get(spec) ?? null })
	if (types.size) ctx?.fixtureService?.reload?.()
	const byId = new Map() // two GDTFSpec spellings of one file ("X" / "X.gdtf") are one type
	for (const [spec, t] of types) if (t && !t.error && !byId.has(t.id)) byId.set(t.id, { spec, t })
	for (const t of types.values()) if (t?.stub && !byId.has(t.stub.id)) byId.set(t.stub.id, { spec: '', t: t.stub })
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
		const m = /^\/api\/stage\/mvr\/([0-9a-f]{12})\/(patch|types)$/.exec(path)
		if (!m) return reply(404, { error: 'unknown MVR path' })
		return m[2] === 'types' ? handleTypes(ctx, m[1]) : handlePatch(ctx, m[1], body)
	}, opt)
	routes.delete('/api/stage/mvr/*', ({ path }) => {
		const id = String(path).split('/').pop()
		return store.remove(id) ? reply(200, { ok: true, id }) : reply(404, { error: 'no such MVR scene' })
	}, opt)
}

module.exports = { register, handleExport, handlePatch, handleTypes, readUpload }
