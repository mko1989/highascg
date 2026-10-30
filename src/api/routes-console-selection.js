'use strict'

/**
 * WO-857 — the lighting console's head selection mirrored into the previs, and the way back.
 *   GET  /api/fixtures/console-selection        { selection: { source, heads, ids, unmatched, ts }, listener: { listening, port, packets, … } | null }
 *   POST /api/fixtures/console-selection        { source, heads: [FixtureID] } → { ok, changed, selection }   (an adapter or a test hands the feed a selection)
 *   POST /api/fixtures/console-selection/send   { console, action: 'select'|'at'|'attribute', ids?: [patch id], heads?: [FixtureID], level?, attribute?, value? }
 *                                               → { ok, console, sent: [command line] }   (grandMA3 `/cmd` OSC, src/lighting-console/gma3-return.js)
 * WS out: fixtures:console_selection (same object as `selection`), on change only. The grandMA3 plugin's UDP datagrams
 * land in src/fixtures/gma3-selection-listener.js. All offline-safe (no Caspar).
 */

const { JSON_HEADERS, jsonBody, parseBodyStrict } = require('./response')
const { getService } = require('../fixtures/console-selection')
const { getService: lightingService } = require('../lighting-console/console-service')
const { commandsFor, sendCommands } = require('../lighting-console/gma3-return')

const reply = (status, obj) => ({ status, headers: JSON_HEADERS, body: jsonBody(obj) })

/** @param {any} routes */
function register(routes) {
	const opts = { requireCaspar: false }

	routes.get('/api/fixtures/console-selection', ({ ctx }) =>
		reply(200, { selection: getService(ctx).snapshot(), listener: ctx?.gma3SelectionListener?.status() || null }), opts)

	routes.post('/api/fixtures/console-selection', ({ body, ctx }) => {
		const p = parseBodyStrict(body)
		if (!p.ok) return reply(400, { ok: false, error: `body must be JSON: ${p.error}` })
		const r = getService(ctx).set(p.value)
		return reply(r.ok ? 200 : 400, r)
	}, opts)

	routes.post('/api/fixtures/console-selection/send', async ({ body, ctx }) => {
		const p = parseBodyStrict(body)
		if (!p.ok) return reply(400, { ok: false, error: `body must be JSON: ${p.error}` })
		const b = p.value && typeof p.value === 'object' ? p.value : {}
		try {
			const sel = getService(ctx)
			let fids = Array.isArray(b.heads) ? b.heads : undefined
			let unmatched = []
			if (Array.isArray(b.ids)) {
				const r = sel.fidsOf(b.ids.map(String))
				fids = [...(fids || []), ...r.fids]
				unmatched = r.unmatched
			}
			const lines = commandsFor({ action: b.action, fids, level: b.level, attribute: b.attribute, value: b.value })
			const r = await sendCommands(lightingService(ctx), b.console, lines)
			return reply(200, unmatched.length ? { ...r, unmatched } : r)
		} catch (e) {
			return reply(/not configured/.test(e.message) ? 404 : /could not send/.test(e.message) ? 502 : 400, { ok: false, error: e.message })
		}
	}, opts)
}

module.exports = { register }
