'use strict'

/**
 * WO-670 P2 — the linked servers (src/cluster/cluster-peers.js), shown in the Devices view:
 *   GET    /api/cluster                        → { self, peers: [{ id, host, port, name, online, version, role, epoch,
 *                                                  program_channels, media, media_parity, error }] }
 *   POST   /api/cluster/scan                   → { found: [{ host, port, hostname, version, role }] }  (this box's /24s)
 *   POST   /api/cluster/peers { address }      → 201 { peer }   (host or host:port; must answer as HighAsCG)
 *   DELETE /api/cluster/peers/:id              → { ok }
 *   GET    /api/cluster/peers/:id/device-view  → that server's own /api/device-view (cached 15 s)
 *   POST   /api/cluster/peers/:id/send-media   → 202; progress in the peer's `media_send` (P2b, cluster-media.js)
 *   GET    /api/cluster/identity               → { id, hostname, device_key, fingerprint }  (public: what a linker records)
 *   POST   /api/cluster/ssh-key                ← a linked server's signed SSH key, before it sends media (cluster-media.js)
 *   GET    /api/cluster/master                 → { claim, ...view }  (P3a, cluster-master.js: peers pull the signed claim)
 *   POST   /api/cluster/master                 ← a linked server's signed claim (accepted only if it beats the one held)
 *   POST   /api/cluster/master/set { master: 'self' | peer id, auto? } → the new view (operator: Make master / failover)
 * GET /api/cluster also carries `master` (the view). Changes broadcast WS `cluster:peers` (the GET body).
 * The service starts on the first call, or at boot when servers are linked (P3b `startIfLinked`: failover never waits
 * for a client), and polls only while the list is not empty.
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const defaultPersistence = require('../utils/persistence')
const { createCluster } = require('../cluster/cluster-peers')
const { handleGet } = require('./routes-replication-get')
const { acceptSshKey, sendMedia, fingerprint } = require('../cluster/cluster-media')
const { postJson, getJson } = require('../cluster/cluster-peers')
const { createMaster } = require('../cluster/cluster-master')
const identity = require('../system/device-identity')

const reply = (status, obj) => ({ status, headers: JSON_HEADERS, body: jsonBody(obj) })

function clusterOf(ctx) {
	if (ctx._cluster) return ctx._cluster
	ctx._cluster = createCluster({
		persistence: ctx.persistence || defaultPersistence,
		selfPing: async () => JSON.parse((await handleGet('/api/replication/ping', ctx, null)).body),
		selfKey: identity.getDevicePublicKeyPem(),
		onChange: () => broadcast(ctx),
	})
	ctx._cluster.afterPoll(() => masterOf(ctx).tick())
	ctx._cluster.start().catch(() => {})
	return ctx._cluster
}

function masterOf(ctx) {
	if (ctx._clusterMaster) return ctx._clusterMaster
	ctx._clusterMaster = createMaster({
		cluster: clusterOf(ctx),
		persistence: ctx.persistence || defaultPersistence,
		selfKey: identity.getDevicePublicKeyPem(),
		sign: identity.signMessage,
		verify: identity.verifyMessage,
		fetchJson: getJson,
		post: postJson,
		log: ctx.log,
		onChange: () => broadcast(ctx),
	})
	return ctx._clusterMaster
}

/** GET /api/cluster body = WS `cluster:peers`. */
const full = (ctx) => ({ ...clusterOf(ctx).snapshot(), master: masterOf(ctx).view() })

function broadcast(ctx) {
	if (typeof ctx._wsBroadcast === 'function') ctx._wsBroadcast('cluster:peers', full(ctx))
}

/** The real senders / installers (tests drive cluster-media.js with stubs). */
function mediaDeps(ctx) {
	const ssh = require('../replication/replication-ssh-setup')
	const rsync = require('../replication/sync-project-media-rsync')
	return {
		cluster: clusterOf(ctx),
		selfKey: identity.getDevicePublicKeyPem(),
		sign: identity.signMessage,
		verify: identity.verifyMessage,
		install: (key, opts) => ssh.installPeerAuthorizedKey(key, { ...opts, log: ctx.log }),
		sshKey: () => ssh.ensureReplicationSshKey(ctx.log).publicKeyLine,
		post: postJson,
		project: () => require('../engine/project-scenes').loadFullProject(),
		plan: (project) => rsync.buildProjectMediaRsyncPlan(ctx, project),
		rsync: rsync.runProjectMediaRsync,
		log: ctx.log,
	}
}

function register(routes) {
	const opt = { requireCaspar: false }
	routes.get('/api/cluster', async ({ ctx }) => {
		const c = clusterOf(ctx)
		await c.poll()
		return reply(200, full(ctx))
	}, opt)
	routes.post('/api/cluster/scan', async ({ ctx }) => reply(200, { found: await clusterOf(ctx).scan() }), opt)
	routes.post('/api/cluster/peers', async ({ body, ctx }) => {
		const r = await clusterOf(ctx).add(parseBody(body))
		return reply(r.status, r.body)
	}, opt)
	routes.delete('/api/cluster/peers/:id', ({ ctx, params }) => {
		const ok = clusterOf(ctx).remove(params.id)
		if (ok && clusterOf(ctx).size() === 0) masterOf(ctx).forget()
		return reply(ok ? 200 : 404, ok ? { ok } : { error: 'no such server' })
	}, opt)
	routes.post('/api/cluster/peers/:id/send-media', async ({ ctx, params }) => {
		const r = await sendMedia(params.id, mediaDeps(ctx))
		return reply(r.status, r.body)
	}, opt)
	routes.get('/api/cluster/identity', ({ ctx }) => {
		const me = clusterOf(ctx).snapshot().self
		const key = identity.getDevicePublicKeyPem()
		return reply(200, { id: me.id, hostname: me.hostname, device_key: key, fingerprint: fingerprint(key) })
	}, opt)
	routes.post('/api/cluster/ssh-key', ({ ctx, body, req }) => {
		const r = acceptSshKey(parseBody(body), req?.socket?.remoteAddress, mediaDeps(ctx))
		return reply(r.status, r.body)
	}, opt)
	routes.get('/api/cluster/master', ({ ctx }) => reply(200, { claim: masterOf(ctx).claim(), ...masterOf(ctx).view() }), opt)
	routes.post('/api/cluster/master', ({ ctx, body }) => {
		const r = masterOf(ctx).accept(parseBody(body))
		return reply(r.status, r.body)
	}, opt)
	routes.post('/api/cluster/master/set', async ({ ctx, body }) => {
		const r = await masterOf(ctx).set(parseBody(body))
		return reply(r.status, r.body)
	}, opt)
	routes.get('/api/cluster/peers/:id/device-view', async ({ ctx, params }) => {
		const r = await clusterOf(ctx).deviceView(params.id)
		return reply(r.status, r.body)
	}, opt)
}

/** At boot: start polling (and failover) when this server has linked servers. */
function startIfLinked(ctx) {
	const peers = (ctx.persistence || defaultPersistence).get('clusterPeers')
	if (Array.isArray(peers) && peers.length) clusterOf(ctx)
}

module.exports = { register, clusterOf, masterOf, startIfLinked }
