/**
 * WO-592 — media library (links) HTTP surface.
 *
 *   POST /api/media/rename            { renames: [{ from, to }] }  all-or-nothing; references follow
 *   GET  /api/media/library/entry     ?path=<media id>             → { entry, usage }
 *   POST /api/media/library/defaults  { path, trimInMs?, trimOutMs?, muted? }  per-file defaults
 *   GET  /api/media/library/defaults  → { defaults: { [path]: { trimInMs?, trimOutMs?, muted? } } }
 */
'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const registry = require('../media/media-library-registry')
const { renameMediaFiles, findMediaUsage } = require('../media/media-links')

const reply = (status, body) => ({ status, headers: JSON_HEADERS, body: jsonBody(body) })

async function handleRename(body, ctx) {
	const b = parseBody(body) || {}
	const r = await renameMediaFiles(ctx, Array.isArray(b.renames) ? b.renames : [])
	return reply(r.status, r.body)
}

/** The entry for a path, adopting it on first sight (a file the reconcile hasn't seen yet). */
function entryFor(ctx, p) {
	let e = registry.getEntryByPath(p)
	if (!e) {
		registry.reconcileWithDisk(ctx.config || {})
		e = registry.getEntryByPath(p)
	}
	return e
}

function handleEntryGet(query, ctx) {
	const p = String(query?.path || '').trim()
	if (!p || p.includes('..')) return reply(400, { error: 'path required' })
	const e = entryFor(ctx, p)
	if (!e) return reply(404, { error: 'not in media library' })
	return reply(200, {
		entry: { id: e.id, path: e.path, defaults: e.defaults || {}, versions: e.versions || [], currentV: e.currentV || 1, size: e.size, addedAt: e.addedAt },
		usage: findMediaUsage(ctx, e.path),
	})
}

function num(v) {
	if (v === null) return null
	const n = Number(v)
	return Number.isFinite(n) && n >= 0 ? n : undefined
}

function handleDefaultsPost(body, ctx) {
	const b = parseBody(body) || {}
	const p = String(b.path || '').trim()
	if (!p || p.includes('..')) return reply(400, { error: 'path required' })
	const e = entryFor(ctx, p)
	if (!e) return reply(404, { error: 'not in media library' })
	const patch = {}
	for (const k of ['trimInMs', 'trimOutMs']) {
		if (!(k in b)) continue
		const v = num(b[k])
		if (v === undefined) return reply(400, { error: `${k} must be ms ≥ 0 or null` })
		patch[k] = v
	}
	if ('muted' in b) patch.muted = b.muted === true
	if (patch.trimInMs != null && patch.trimOutMs != null && patch.trimOutMs <= patch.trimInMs) {
		return reply(400, { error: 'trimOut must be after trimIn' })
	}
	const next = registry.setDefaults(e.id, patch)
	return reply(200, { ok: true, defaults: next?.defaults || {} })
}

/** Every file that has defaults — the client applies them when a clip lands on a look layer. */
function handleDefaultsGet() {
	const out = {}
	for (const e of Object.values(registry.load().items)) {
		const d = e.defaults || {}
		if (d.trimInMs != null || d.trimOutMs != null || d.muted) out[e.path] = d
	}
	return reply(200, { defaults: out })
}

module.exports = { handleRename, handleEntryGet, handleDefaultsPost, handleDefaultsGet }
