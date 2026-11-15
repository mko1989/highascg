'use strict'

/**
 * WO-1089 — Stage Salad (work/notes/stage-salad-contract.md §2). The game never puts anything on a screen: these
 * routes read the project (through the RC scene baker) and drive the in-memory room, nothing else.
 *   GET  /api/game/salad/state       → { enabled: false } | the room state                          (public)
 *   POST /api/game/salad/host        { action: enable | disable | start | stop | round | bots | botlevel | teams |
 *                                      target | safe | kick | lights | wall, … }                     (normal auth)
 *   GET  /api/game/salad/scene       → the RC bake without tracks / occ / heights + `salad` (venue) + live lights /
 *                                      screens (403 while disabled)
 *   GET  /api/game/salad/scene.glb   → the shared scene GLB (gzip when accepted; immutable when ?rev= is current)
 */

const { kit } = require('./salad-kit')
const { getSaladGame } = require('./salad-game')

function register(routes, opts = {}) {
	const { JSON_HEADERS, jsonBody, parseBodyStrict } = kit().core('src/api/response')
	const reply = (status, o) => ({ status, headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' }, body: jsonBody(o) })
	const off = () => reply(403, { ok: false, error: 'The game is not running', enabled: false })

	async function sceneJson(game) {
		if (!game.isEnabled()) return off()
		const out = await game.sceneWithLive()
		return { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' }, body: out.text }
	}

	async function sceneGlb(game, req, query) {
		if (!game.isEnabled()) return off()
		const out = await game.scene()
		const gz = out.gz && /\bgzip\b/i.test(String(req?.headers?.['accept-encoding'] || ''))
		const headers = { 'Content-Type': 'model/gltf-binary', 'X-Salad-Rev': out.rev, Vary: 'Accept-Encoding',
			'Cache-Control': query?.rev === out.rev ? 'public, max-age=86400, immutable' : 'no-cache' }
		if (gz) headers['Content-Encoding'] = 'gzip'
		return { status: 200, headers, body: gz ? out.gz : out.glb }
	}

	function hostAction(game, body) {
		const b = parseBodyStrict(body)
		if (!b.ok || !b.value || typeof b.value !== 'object' || Array.isArray(b.value)) return reply(400, { ok: false, error: 'JSON body expected' })
		const r = game.host(b.value)
		return reply(r.status, r.body)
	}

	const o = { requireCaspar: false }
	const g = (ctx) => opts.game || getSaladGame(ctx)
	routes.get('/api/game/salad/state', ({ ctx }) => reply(200, g(ctx).state()), o)
	routes.get('/api/game/salad/scene', ({ ctx }) => sceneJson(g(ctx)), o)
	routes.get('/api/game/salad/scene.glb', ({ ctx, req, query }) => sceneGlb(g(ctx), req, query), o)
	routes.post('/api/game/salad/host', ({ ctx, body }) => hostAction(g(ctx), body), o)
}

module.exports = { register }
