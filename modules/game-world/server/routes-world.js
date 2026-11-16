'use strict'

/**
 * WO-1101 — Game World API routes (work/notes/game-world-contract.md §3). The world never puts anything on a screen:
 * these routes only read the registered games' state and call their own host functions through world-service.js.
 *   GET  /api/game/world/state  → the world state (public while a game session runs, world-public.js)
 *   POST /api/game/world/host   { action: enable | disable | start | stop | bots | safe | lights | wall | house | affect | event, … }
 *                               (normal auth, always)
 */

const { core } = require('./host')

const reply = (status, o) => {
	const { JSON_HEADERS, jsonBody } = core('src/api/response')
	return { status, headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' }, body: jsonBody(o) }
}

function hostAction(svc, body) {
	const { parseBodyStrict } = core('src/api/response')
	const b = parseBodyStrict(body)
	if (!b.ok || !b.value || typeof b.value !== 'object' || Array.isArray(b.value)) return reply(400, { ok: false, error: 'JSON body expected' })
	const r = svc.host(b.value)
	return reply(r.status, r.body)
}

/** @param {object} routes a RouteRegistry @param {{ service: object }} opts */
function register(routes, opts) {
	const svc = opts.service
	const o = { requireCaspar: false }
	routes.get('/api/game/world/state', () => reply(200, svc.state()), o)
	routes.post('/api/game/world/host', ({ body }) => hostAction(svc, body), o)
}

module.exports = { register }
