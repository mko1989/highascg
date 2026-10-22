'use strict'

/**
 * WO-670 P2 — the linked servers (src/cluster/cluster-peers.js), shown in the Devices view:
 *   GET    /api/cluster                        → { self, peers: [{ id, host, port, name, online, version, role, epoch,
 *                                                  program_channels, media, media_parity, error }] }
 *   POST   /api/cluster/scan                   → { found: [{ host, port, hostname, version, role }] }  (this box's /24s)
 *   POST   /api/cluster/peers { address }      → 201 { peer }   (host or host:port; must answer as HighAsCG)
 *   DELETE /api/cluster/peers/:id              → { ok }
 *   GET    /api/cluster/peers/:id/device-view  → that server's own /api/device-view (cached 15 s)
 * Changes broadcast WS `cluster:peers` (the GET body). The service starts on the first call and polls only while
 * the list is not empty.
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const defaultPersistence = require('../utils/persistence')
const { createCluster } = require('../cluster/cluster-peers')
const { handleGet } = require('./routes-replication-get')

const reply = (status, obj) => ({ status, headers: JSON_HEADERS, body: jsonBody(obj) })

function clusterOf(ctx) {
	if (ctx._cluster) return ctx._cluster
	ctx._cluster = createCluster({
		persistence: ctx.persistence || defaultPersistence,
		selfPing: async () => JSON.parse((await handleGet('/api/replication/ping', ctx, null)).body),
		onChange: (snap) => {
			if (typeof ctx._wsBroadcast === 'function') ctx._wsBroadcast('cluster:peers', snap)
		},
	})
	ctx._cluster.start().catch(() => {})
	return ctx._cluster
}

function register(routes) {
	const opt = { requireCaspar: false }
	routes.get('/api/cluster', async ({ ctx }) => {
		const c = clusterOf(ctx)
		await c.poll()
		return reply(200, c.snapshot())
	}, opt)
	routes.post('/api/cluster/scan', async ({ ctx }) => reply(200, { found: await clusterOf(ctx).scan() }), opt)
	routes.post('/api/cluster/peers', async ({ body, ctx }) => {
		const r = await clusterOf(ctx).add(parseBody(body))
		return reply(r.status, r.body)
	}, opt)
	routes.delete('/api/cluster/peers/:id', ({ ctx, params }) => {
		const ok = clusterOf(ctx).remove(params.id)
		return reply(ok ? 200 : 404, ok ? { ok } : { error: 'no such server' })
	}, opt)
	routes.get('/api/cluster/peers/:id/device-view', async ({ ctx, params }) => {
		const r = await clusterOf(ctx).deviceView(params.id)
		return reply(r.status, r.body)
	}, opt)
}

module.exports = { register, clusterOf }
