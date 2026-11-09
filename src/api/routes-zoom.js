'use strict'

/**
 * WO-1012 — the Zoom device (src/zoom/zoom-session.js): the Zoom desktop client's windows as live inputs.
 *   GET  /api/zoom                 → { ok, installed, running, windows: [{ id, title, width, height, below, role }],
 *                                      sources: { presenter|share|gallery: { ring, value, window, hidden, size, fps,
 *                                      grabbing, mapped, published } } }
 *   POST /api/zoom/launch  { url? } → start the client (url = a meeting link or number to join)
 *   POST /api/zoom/quit             → stop every grab, quit the client
 *   POST /api/zoom/source  { source, window?: id|null, hidden?, size?: "1920x1080", fps? } → assign / hide / stop
 * Each source is the shm ring zoom-<source>: a Live-tab source at once (shm://zoom-<source>, /api/shm/sources).
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getZoomSession } = require('../zoom/zoom-session')

const reply = (status, body) => ({ status, headers: JSON_HEADERS, body: jsonBody(body) })

function session(ctx) {
	return getZoomSession((level, msg) => ctx?.log?.(level, msg))
}

async function guarded(fn) {
	try {
		return reply(200, await fn())
	} catch (e) {
		return reply(400, { ok: false, error: String(e.message || e) })
	}
}

function register(routes) {
	const opt = { requireCaspar: false }
	routes.get('/api/zoom', ({ ctx }) => guarded(() => session(ctx).status()), opt)
	routes.post('/api/zoom/launch', ({ ctx, body }) => guarded(() => session(ctx).launch(parseBody(body) || {})), opt)
	routes.post('/api/zoom/quit', ({ ctx }) => guarded(() => session(ctx).quit()), opt)
	routes.post('/api/zoom/source', ({ ctx, body }) =>
		guarded(() => {
			const b = parseBody(body) || {}
			return session(ctx).assign(String(b.source || ''), b)
		}), opt)
}

module.exports = { register }
