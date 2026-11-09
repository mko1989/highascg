'use strict'

/**
 * WO-1012 stage C — two-way Zoom audio (src/zoom/zoom-audio.js).
 *   GET  /api/zoom/audio → { ok, available, enabled, in: { sink, present, url }, out: { source, present, feed },
 *                            feeds: [{ id, label }], note, error, env }
 *   POST /api/zoom/audio { enabled?: bool, feed?: string } → the same shape. feed '' = no return.
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getZoomAudio } = require('../zoom/zoom-audio')

const reply = (status, body) => ({ status, headers: JSON_HEADERS, body: jsonBody(body) })

async function guarded(fn) {
	try {
		return reply(200, await fn())
	} catch (e) {
		return reply(400, { ok: false, error: String(e.message || e) })
	}
}

function register(routes) {
	const opt = { requireCaspar: false }
	routes.get('/api/zoom/audio', ({ ctx }) => guarded(async () => {
		const za = getZoomAudio(ctx)
		await za.restore()
		return za.status()
	}), opt)
	routes.post('/api/zoom/audio', ({ ctx, body }) => guarded(() => getZoomAudio(ctx).apply(parseBody(body) || {})), opt)
}

module.exports = { register }
