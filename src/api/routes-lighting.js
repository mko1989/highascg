'use strict'

/**
 * WO-837 — lighting consoles (Devices tab) for the timeline `light` flags. All offline-safe (no Caspar needed):
 *   GET    /api/lighting/consoles              { consoles: [{ id, name, kind, host, port, prefix?, templates? }], kinds: [{ kind, label, port }] }
 *   POST   /api/lighting/consoles              one console record → { console } (adds, or replaces the same id; no id = generated)
 *   DELETE /api/lighting/consoles/:id          { ok } (also DELETE /api/lighting/consoles with { id })
 *   GET    /api/lighting/consoles/:id          { console }
 *   POST   /api/lighting/consoles/:id/test     { ok, sent: [osc address], note } | { ok:false, error } (502 when the datagram could not be sent)
 * Malformed JSON → 400. Wire formats: src/lighting-console/drivers/*.
 */

const { JSON_HEADERS, jsonBody, parseBodyStrict } = require('./response')
const { getService } = require('../lighting-console/console-service')

const reply = (status, obj) => ({ status, headers: JSON_HEADERS, body: jsonBody(obj) })
const fail = (r) => reply(r.status || 400, { ok: false, error: r.error })

/** @param {any} routes */
function register(routes) {
	const opts = { requireCaspar: false }
	const svc = (ctx) => getService(ctx)
	const json = (body) => parseBodyStrict(body)

	routes.get('/api/lighting/consoles', ({ ctx }) => reply(200, { consoles: svc(ctx).list(), kinds: svc(ctx).kinds() }), opts)
	routes.post(
		'/api/lighting/consoles',
		({ body, ctx }) => {
			const p = json(body)
			if (!p.ok) return reply(400, { ok: false, error: `body must be JSON: ${p.error}` })
			const r = svc(ctx).upsert(p.value)
			return r.ok ? reply(200, { console: r.console }) : fail(r)
		},
		opts
	)
	routes.delete(
		'/api/lighting/consoles',
		({ body, ctx }) => {
			const p = json(body)
			if (!p.ok) return reply(400, { ok: false, error: `body must be JSON: ${p.error}` })
			const r = svc(ctx).remove(p.value?.id)
			return r.ok ? reply(200, { ok: true }) : fail(r)
		},
		opts
	)
	routes.get(
		'/api/lighting/consoles/:id',
		({ params, ctx }) => {
			const c = svc(ctx).get(params.id)
			return c ? reply(200, { console: c }) : reply(404, { ok: false, error: `no console ${JSON.stringify(params.id)}` })
		},
		opts
	)
	routes.delete(
		'/api/lighting/consoles/:id',
		({ params, ctx }) => {
			const r = svc(ctx).remove(params.id)
			return r.ok ? reply(200, { ok: true }) : fail(r)
		},
		opts
	)
	routes.post(
		'/api/lighting/consoles/:id/test',
		async ({ params, ctx }) => {
			const r = await svc(ctx).test(params.id)
			return r.ok ? reply(200, r) : fail(r)
		},
		opts
	)
}

module.exports = { register }
