'use strict'

/**
 * WO-597 — video-surface descriptors + leases for native clients (Godot, WO-593).
 *   GET  /api/video-surfaces                         → { ok, surfaces: [...] }
 *   POST /api/video-surfaces/lease { clientId, roles } → { ok, surfaces }  (renew every ~5 s; TTL 15 s)
 * See src/system/video-surfaces.js.
 * WO-1029 C9: a pgmN / prvN whose screen is output by another linked server that relays pictures carries
 * `transport: 'feed'` + `relay: { server: { id, name }, state }` — the client reads it from its own node's
 * /api/video-feed (src/cluster/feed-relay.js), never from shared memory. Absent = shared memory as before.
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getVideoSurfaceManager } = require('../system/video-surfaces')

/** WO-1029 C9: mark the roles this server relays from their owner. */
function withTransport(ctx, surfaces) {
	const relay = ctx?._videoFeed?.relay
	if (!relay) return surfaces
	return surfaces.map((s) => {
		if (s.channel != null) return s
		const st = relay.status(s.role)
		return st ? { ...s, transport: 'feed', relay: st } : s
	})
}

function handleGet(ctx) {
	const surfaces = withTransport(ctx, getVideoSurfaceManager(ctx).list())
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, surfaces }) }
}

async function handleLease(body, ctx) {
	const b = parseBody(body) // raw string/Buffer from the HTTP layer, like every other POST route
	if (!String(b.clientId || '').trim()) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: 'clientId required' }) }
	}
	const surfaces = withTransport(ctx, await getVideoSurfaceManager(ctx).lease(b.clientId, b.roles))
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, surfaces }) }
}

module.exports = { handleGet, handleLease }
