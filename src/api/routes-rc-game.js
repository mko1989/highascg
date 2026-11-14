'use strict'

/**
 * WO-1074 — RC car game (work/notes/rc-game-contract.md). The game never puts anything on a screen: these routes read
 * the project / MVR store and drive the in-memory room, nothing else.
 *   GET  /api/game/rc/state       → { enabled: false } | the room state (+ joinUrls, sceneRev)   (public)
 *   POST /api/game/rc/host        { action: enable | disable | track | start | stop | laps | kick, … } (normal auth)
 *   GET  /api/game/rc/scene       → the baked scene JSON (403 while disabled; waits for a running bake)
 *   GET  /api/game/rc/scene.glb   → the merged scene GLB (gzip when accepted; immutable when ?rev= is current)
 * Public while enabled: state, scene, scene.glb (src/game/rc-public.js); the socket lives in src/game/rc-ws.js.
 */

const { JSON_HEADERS, jsonBody, parseBodyStrict } = require('./response')
const { getRcGame } = require('../game/rc-game')

const reply = (status, o) => ({ status, headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' }, body: jsonBody(o) })
const off = () => reply(403, { ok: false, error: 'The game is not running', enabled: false })

async function sceneJson(game) {
	if (!game.isEnabled()) return off()
	const out = await game.scene()
	return { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' }, body: out.text }
}

async function sceneGlb(game, req, query) {
	if (!game.isEnabled()) return off()
	const out = await game.scene()
	const gz = out.gz && /\bgzip\b/i.test(String(req?.headers?.['accept-encoding'] || ''))
	const headers = { 'Content-Type': 'model/gltf-binary', 'X-RC-Rev': out.rev, Vary: 'Accept-Encoding',
		'Cache-Control': query?.rev === out.rev ? 'public, max-age=86400, immutable' : 'no-cache' }
	if (gz) headers['Content-Encoding'] = 'gzip'
	return { status: 200, headers, body: gz ? out.gz : out.glb }
}

function hostAction(game, body) {
	const b = parseBodyStrict(body)
	if (!b.ok || !b.value || typeof b.value !== 'object') return reply(400, { ok: false, error: 'JSON body expected' })
	const r = game.host(b.value)
	return reply(r.status, r.body)
}

/** @param {import('./route-registry').RouteRegistry} routes @param {{ game?: object }} [opts] (smokes inject a game) */
function register(routes, opts = {}) {
	const o = { requireCaspar: false }
	const g = (ctx) => opts.game || getRcGame(ctx)
	routes.get('/api/game/rc/state', ({ ctx }) => reply(200, g(ctx).state()), o)
	routes.get('/api/game/rc/scene', ({ ctx }) => sceneJson(g(ctx)), o)
	routes.get('/api/game/rc/scene.glb', ({ ctx, req, query }) => sceneGlb(g(ctx), req, query), o)
	routes.post('/api/game/rc/host', ({ ctx, body }) => hostAction(g(ctx), body), o)
}

module.exports = { register }
