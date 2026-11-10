'use strict'

/**
 * WO-1029 plan 06 S3 — one Devices view for every linked server (cluster-device-view.js):
 *   GET /api/cluster/device-view[?fresh=1]  → { generatedAt, self, master, destinations: { list, sharing }, servers }
 *       ETag + If-None-Match → 304 (a client polls every few seconds); `fresh=1` re-reads every online server now.
 *       WS `cluster:devices { id }` when a server's view changed; `cluster:destinations` (the shared list's state).
 *   GET /api/cluster/destinations           → the shared destination list's state (shared-show-dests.js view):
 *       { active, writer, hash, held, pending, error, conflicts: [{ conflict, destId }], peers, removals }
 * Writes stay where they were: this server's /api/device-view, a linked one's through
 * /api/cluster/peers/:id/relay/api/device-view (cluster-relay.js; a 2xx write refreshes that server's view at once).
 */

const { JSON_HEADERS, jsonBody } = require('./response')

function register(routes) {
	const opt = { requireCaspar: false }
	routes.get('/api/cluster/device-view', async ({ ctx, query, req }) => {
		require('./routes-cluster').clusterOf(ctx) // a box with nothing linked serves its own view alone
		const v = require('../cluster/cluster-device-view').deviceViewOf(ctx)
		const r = await v.get({ fresh: String(query?.fresh || '') === '1', ifNoneMatch: req?.headers?.['if-none-match'] || '' })
		const headers = { ETag: r.etag, 'Cache-Control': 'private, max-age=2' }
		if (r.status === 304) return { status: 304, headers }
		return { status: 200, headers: { ...JSON_HEADERS, ...headers }, body: jsonBody(r.body) }
	}, opt)
	routes.get('/api/cluster/destinations', ({ ctx }) => {
		require('./routes-cluster').clusterOf(ctx)
		const d = require('../cluster/shared-show-dests-ctx').destsOf(ctx)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(d ? d.view() : { active: false }) }
	}, opt)
}

module.exports = { register }
