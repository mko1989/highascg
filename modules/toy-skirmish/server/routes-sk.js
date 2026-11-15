'use strict'

/**
 * WO-1081 — Stage Skirmish (work/notes/skirmish-game-contract.md §2). The game never puts anything on a screen: these
 * routes read the project / MVR store (through the RC scene baker) and drive the in-memory room, nothing else.
 *   GET  /api/game/sk/state       → { enabled: false } | the room state (+ joinUrls, sceneRev, lights, wall)   (public)
 *   POST /api/game/sk/host        { action: enable | disable | arena | mode | limits | bots | start | stop | kick | team |
 *                                   lights | wall, … }                                                    (normal auth)
 *   GET  /api/game/sk/scene       → the RC bake without `tracks` + `arenas` + live `lights` / `screens` (403 while disabled)
 *   GET  /api/game/sk/scene.glb   → the merged scene GLB (gzip when accepted; immutable when ?rev= is current)
 * Public while enabled: state, scene, scene.glb (sk-public.js); the socket lives in sk-ws.js.
 */

const { kit } = require('./sk-kit')
const { getSkGame } = require('./sk-game')

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
		const headers = { 'Content-Type': 'model/gltf-binary', 'X-SK-Rev': out.rev, Vary: 'Accept-Encoding',
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
	const g = (ctx) => opts.game || getSkGame(ctx)
	routes.get('/api/game/sk/state', ({ ctx }) => reply(200, g(ctx).state()), o)
	routes.get('/api/game/sk/scene', ({ ctx }) => sceneJson(g(ctx)), o)
	routes.get('/api/game/sk/scene.glb', ({ ctx, req, query }) => sceneGlb(g(ctx), req, query), o)
	routes.post('/api/game/sk/host', ({ ctx, body }) => hostAction(g(ctx), body), o)
}

module.exports = { register }
