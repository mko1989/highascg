'use strict'

/**
 * WO-1029 plan 07 C10 — the shared media library of the linked servers (cluster-media-service.js):
 *   GET  /api/cluster/media-needs[?refresh=1]         → { generatedAt, self_id, running, servers, files, looks, elsewhere,
 *                                                        elsewhere_truncated, summary } (what each destination's owners lack)
 *   GET  /api/cluster/media-library?offset=&limit=    → { generatedAt, total, offset, servers, items: [{ id, path, size, on }] }
 *   POST /api/cluster/media-spread { files?, to?, overwrite? } → 202 { run_id, run } | 409 { error, run } | 400 { error }
 *   GET  /api/cluster/media-spread/status             → { running, run }
 *   POST /api/cluster/media-spread/cancel             → { ok, run } | 409
 *   POST /api/cluster/media-call                      ← a linked server's signed media call (have / push / status / cancel)
 * Progress: WS `cluster:media` { event: 'start' | 'file' | 'done', … }.
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { mediaServiceOf } = require('../cluster/cluster-media-service')

const reply = (status, obj) => ({ status, headers: JSON_HEADERS, body: jsonBody(obj) })

function register(routes) {
	const opt = { requireCaspar: false }
	routes.get('/api/cluster/media-needs', async ({ ctx, query }) => {
		const refresh = ['1', 'true'].includes(String(query?.refresh || ''))
		return reply(200, await mediaServiceOf(ctx).needs({ refresh }))
	}, opt)
	routes.get('/api/cluster/media-library', async ({ ctx, query }) => reply(200, await mediaServiceOf(ctx).library({ offset: query?.offset, limit: query?.limit })), opt)
	routes.post('/api/cluster/media-spread', async ({ ctx, body }) => {
		const b = parseBody(body) || {}
		if ((b.files != null && !Array.isArray(b.files)) || (b.to != null && !Array.isArray(b.to))) return reply(400, { error: 'files and to must be lists' })
		const r = await mediaServiceOf(ctx).spread(b)
		return reply(r.status, r.body)
	}, opt)
	routes.get('/api/cluster/media-spread/status', ({ ctx }) => reply(200, mediaServiceOf(ctx).status()), opt)
	routes.post('/api/cluster/media-spread/cancel', ({ ctx }) => {
		const r = mediaServiceOf(ctx).cancel()
		return reply(r.status, r.body)
	}, opt)
	routes.post('/api/cluster/media-call', async ({ ctx, body }) => {
		const r = await mediaServiceOf(ctx).handleCall(parseBody(body))
		return reply(r.status, r.body)
	}, opt)
}

module.exports = { register }
