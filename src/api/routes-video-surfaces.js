'use strict'

/**
 * WO-597 — video-surface descriptors + leases for native clients (Godot, WO-593).
 *   GET  /api/video-surfaces                         → { ok, surfaces: [...] }
 *   POST /api/video-surfaces/lease { clientId, roles } → { ok, surfaces }  (renew every ~5 s; TTL 15 s)
 * See src/system/video-surfaces.js.
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getVideoSurfaceManager } = require('../system/video-surfaces')

function handleGet(ctx) {
	const surfaces = getVideoSurfaceManager(ctx).list()
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, surfaces }) }
}

async function handleLease(body, ctx) {
	const b = parseBody(body) // raw string/Buffer from the HTTP layer, like every other POST route
	if (!String(b.clientId || '').trim()) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: 'clientId required' }) }
	}
	const surfaces = await getVideoSurfaceManager(ctx).lease(b.clientId, b.roles)
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, surfaces }) }
}

module.exports = { handleGet, handleLease }
