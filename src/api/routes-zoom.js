'use strict'

/**
 * WO-1012 — the Zoom device (src/zoom/zoom-session.js): the Zoom desktop client's windows as live inputs.
 *   GET  /api/zoom                 → { ok, installed, running, windows: [{ id, title, width, height, below, role }],
 *                                      sources: { presenter|share|gallery: { ring, value, window, hidden, size, fps,
 *                                      grabbing, mapped, published } } }
 *   POST /api/zoom/launch  { url? } → start the client (url = a meeting link or number to join)
 *   POST /api/zoom/quit             → stop every grab, quit the client
 *   POST /api/zoom/source  { source, window?: id|null, hidden?, fit?, size?: "1920x1080", fps? } → assign / hide / stop
 *                                   (fit, on by default: only the picture inside the window, filling the frame — no Zoom bars)
 * Each source is the shm ring zoom-<source>: a Live-tab source at once (shm://zoom-<source>, /api/shm/sources).
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getZoomSession } = require('../zoom/zoom-session')
const { getZoomAudio } = require('../zoom/zoom-audio')
const { getZoomUi } = require('../zoom/zoom-ui')

const reply = (status, body) => ({ status, headers: JSON_HEADERS, body: jsonBody(body) })

const ui = (ctx) => getZoomUi((level, msg) => ctx?.log?.(level, msg))

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
	// WO-1012 C: Zoom joins the private audio daemon when Zoom audio is on (env from zoom-audio, never from the body)
	routes.post('/api/zoom/launch', ({ ctx, body }) =>
		guarded(async () => {
			const r = await session(ctx).launch({ url: (parseBody(body) || {}).url, env: getZoomAudio(ctx).zoomEnv() })
			// with a meeting link: go in by itself (the join preview's "Join", camera on) — zoom-ui.js, in the background
			if (r.joining) ui(ctx).autoJoin().catch((e) => ctx?.log?.('warn', `[zoom-ui] join: ${e.message}`))
			return r
		}), opt)
	routes.post('/api/zoom/quit', ({ ctx }) => guarded(() => session(ctx).quit()), opt)
	routes.post('/api/zoom/source', ({ ctx, body }) =>
		guarded(() => {
			const b = parseBody(body) || {}
			return session(ctx)
				.assign(String(b.source || ''), b)
				.then((st) => {
					// the camera source shows the speaker: the main window goes to its Meeting tab (best effort)
					if (b.source === 'presenter' && b.window) ui(ctx).selectTab('meeting').catch(() => {})
					return st
				})
		}), opt)
}

module.exports = { register }
