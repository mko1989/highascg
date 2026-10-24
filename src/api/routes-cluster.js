'use strict'

/**
 * WO-670 P2 — the linked servers (src/cluster/cluster-peers.js), shown in the Devices view:
 *   GET    /api/cluster                        → { self, peers: [{ id, host, port, name, online, version, role, epoch,
 *                                                  program_channels, media, media_parity, error }] }
 *   POST   /api/cluster/scan                   → { found: [{ host, port, hostname, version, role }] }  (this box's /24s)
 *   POST   /api/cluster/peers { address }      → 201 { peer, link_back: { ok, error } }  (host or host:port; must answer
 *                                                  as HighAsCG; WO-732: that server links this one back. `link_back:
 *                                                  false` = a server linking back: no call back, 409 when unlinked here)
 *   DELETE /api/cluster/peers/:id[?link_back=0] → { ok, link_back?: { ok, error } }  (WO-732: unlinked there too)
 *   GET    /api/cluster/peers/:id/device-view  → that server's own /api/device-view (cached 15 s)
 *   POST   /api/cluster/peers/:id/send-media   → 202; progress in the peer's `media_send` (P2b, cluster-media.js)
 *   GET    /api/cluster/identity               → { id, hostname, device_key, fingerprint }  (public: what a linker records)
 *   POST   /api/cluster/ssh-key                ← a linked server's signed SSH key, before it sends media (cluster-media.js)
 *   GET    /api/cluster/master                 → { claim, ...view }  (P3a, cluster-master.js: peers pull the signed claim)
 *   POST   /api/cluster/master                 ← a linked server's signed claim (accepted only if it beats the one held)
 *   POST   /api/cluster/master/set { master: 'self' | peer id, auto? } → the new view (operator: Make master / failover)
 *   POST   /api/cluster/call                   ← a linked server's signed action (WO-712 R2, cluster-call.js; open while
 *                                                  enforceAuth is on: the signature is the auth, auth.js)
 *   POST   /api/cluster/send { peer, action, args } → that server's answer (WO-712 R3: this server's operator presses
 *                                                  an action there, signed by this server; needs the normal auth)
 *   GET    /api/cluster/exchange              → { 'tracking.auto': snapshot+source | null, sources: [...] } (R3)
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
const { createClusterFanout } = require('../cluster/cluster-fanout')
const { createAirJournal } = require('../cluster/cluster-air-journal')
const { createClusterCall } = require('../cluster/cluster-call')
const { createCallActions } = require('../cluster/cluster-call-actions')
const { createExchange } = require('../cluster/cluster-exchange')
const identity = require('../system/device-identity')
const duties = require('../cluster/server-duties')
const { isSandbox } = require('../bootstrap/sandbox')
const { createSendersSync } = require('../cluster/server-senders')

const reply = (status, obj) => ({ status, headers: JSON_HEADERS, body: jsonBody(obj) })

function clusterOf(ctx) {
	if (ctx._cluster) return ctx._cluster
	ctx._cluster = createCluster({
		persistence: ctx.persistence || defaultPersistence,
		selfPing: async () => JSON.parse((await handleGet('/api/replication/ping', ctx, null)).body),
		selfKey: identity.getDevicePublicKeyPem(),
		selfPort: () => ctx.config?.server?.httpPort, // WO-732: the address a peer links back to
		log: ctx.log,
		onChange: () => broadcast(ctx),
	})
	ctx._cluster.afterPoll(async () => {
		await masterOf(ctx).tick()
		await fanoutOf(ctx).refresh()
		require('../cluster/air-state').airChanged(ctx) // WO-712 R3b: the `air` heartbeat
		duties.refresh() // WO-723: who does what follows the peers' pings
		await sendersSyncOf(ctx).tick()
		ctx._dutiesBroadcast?.() // a server that refused the choices shows it (deduped: nothing new, nothing sent)
	})
	require('./routes-server-duties').bindBroadcast(ctx)
	duties.provide({ cluster: () => dutiesView(ctx) })
	ctx._cluster.start().catch(() => {})
	return ctx._cluster
}

/** WO-723: what server-duties resolves against — this server, the linked ones (by fingerprint) and the master. */
function dutiesView(ctx) {
	const snap = ctx._cluster.snapshot()
	const refused = (id) => (ctx._sendersSync ? ctx._sendersSync.refused(id) : '') // it did not take the choices
	const peers = snap.peers.map((p) => ({ id: p.id, fp: p.fp, name: p.name, online: p.online === true, duties: p.duties, refused: refused(p.id) }))
	const self = { fp: fingerprint(identity.getDevicePublicKeyPem()), name: snap.self.hostname || 'this server' }
	const m = ctx._clusterMaster ? ctx._clusterMaster.view() : null
	const master = m?.is_master ? self.fp : peers.find((p) => p.id === m?.master_id)?.fp || ''
	return { self, peers, master }
}

/** WO-723: the sender choices reach every online linked server (server-senders.js). */
function sendersSyncOf(ctx) {
	if (ctx._sendersSync) return ctx._sendersSync
	ctx._sendersSync = createSendersSync({
		peers: () => clusterOf(ctx).snapshot().peers,
		get: () => duties.senders().get(),
		call: (id, action, args, o) => callOf(ctx).call(id, action, args, o),
		log: ctx.log,
	})
	return ctx._sendersSync
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

/**
 * P4b: what this server has on air, recorded from boot (a server linked later is caught up on it). Every AMCP send
 * reaches it through the amcp-fanout sink; once the cluster runs, the fan-out records and forwards.
 */
function airJournalOf(ctx) {
	if (ctx._airJournal) return ctx._airJournal
	const fan = require('../replication/amcp-fanout')
	const { payloadLines } = require('../cluster/cluster-fanout')
	ctx._airJournal = createAirJournal()
	fan.setClusterFanoutSink((payload) => {
		if (ctx._clusterFanout) return ctx._clusterFanout.send(payload)
		for (const l of payloadLines(payload)) if (fan.shouldFanOutCommand(l)) ctx._airJournal.record(l)
	})
	return ctx._airJournal
}

/** P4a: while this server is master, its takes go to every linked server where the destination is cabled. */
function fanoutOf(ctx) {
	if (ctx._clusterFanout) return ctx._clusterFanout
	const { PeerCasparConnection } = require('../replication/peer-caspar-connection')
	const { getReplicationConfig } = require('../config/replication-config')
	const { normalizeScreenDestinations } = require('../config/screen-destinations')
	const { buildChannelMap } = require('../config/channel-map-from-ctx')
	ctx._clusterFanout = createClusterFanout({
		// WO-725: a sandbox never forwards — its peers' Caspar is this box's live one (127.0.0.1:5250)
		isMaster: () => !isSandbox() && masterOf(ctx).view().is_master === true,
		pairEnabled: () => !!getReplicationConfig(ctx.config).enabled,
		members: () => clusterOf(ctx).snapshot().peers.filter((p) => p.online),
		peerView: async (id) => {
			const r = await clusterOf(ctx).deviceView(id)
			return r.status === 200 ? r.body : null
		},
		ownView: async () => ({
			screenDestinations: normalizeScreenDestinations(ctx.config?.screenDestinations),
			live: { caspar: { channelMap: buildChannelMap(ctx) } },
		}),
		connect: (host, port, onConnected) => {
			const c = new PeerCasparConnection({ log: ctx.log, onConnected })
			c.connect(host, port)
			return c
		},
		journal: airJournalOf(ctx),
		log: ctx.log,
		onChange: () => broadcast(ctx),
	})
	require('../replication/amcp-fanout').setClusterFollowerCheck(() => followsMaster(ctx))
	return ctx._clusterFanout
}

/** P4b: another server is master and online, so its fan-out drives this server's PGM: local PGM takes are skipped. */
function followsMaster(ctx) {
	const v = masterOf(ctx).view()
	if (v.is_master || !v.master_id || !(v.epoch > 0)) return false
	if (require('../config/replication-config').getReplicationConfig(ctx.config).enabled) return false
	return clusterOf(ctx).snapshot().peers.some((p) => p.id === v.master_id && p.online)
}

/** WO-712 R2: follower check that never starts the cluster service (a box that never ran it follows no one). */
const isClusterFollower = (ctx) => !!ctx?._clusterMaster && followsMaster(ctx)

/** WO-712 R2: signed calls to / from linked servers; the receiver runs the allow-list (cluster-call-actions.js). */
function callOf(ctx) {
	if (ctx._clusterCall) return ctx._clusterCall
	ctx._clusterCall = createClusterCall({
		cluster: clusterOf(ctx),
		selfKey: identity.getDevicePublicKeyPem(),
		sign: identity.signMessage,
		verify: identity.verifyMessage,
		post: postJson,
		masterId: () => (masterOf(ctx).view().is_master ? '' : masterOf(ctx).view().master_id),
		acceptsRemote: () => require('../cluster/server-duties').has('accept_remote'),
		info: { ...exchangeOf(ctx).info, 'cluster.senders': (args) => sendersReceived(ctx, args) },
		actions: createCallActions(ctx, { callMaster: (a, args) => callOf(ctx).callMaster(a, args), isFollower: () => isClusterFollower(ctx) }),
		log: ctx.log,
	})
	return ctx._clusterCall
}

/** WO-723: a linked server's sender choices (info action `cluster.senders`): per kind, the newer one wins. */
function sendersReceived(ctx, args) {
	if (!args.senders || typeof args.senders !== 'object') return { status: 400, body: { error: 'senders must be an object' } }
	const changed = duties.senders().merge(args.senders)
	if (changed) sendersSyncOf(ctx).tick().catch(() => {}) // a third linked server hears it too
	return { status: 200, body: { ok: true, changed, senders: duties.senders().get() } }
}

/** WO-712 R3: what this server knows goes to the linked servers that do not do it (cluster-exchange.js). */
function exchangeOf(ctx) {
	if (ctx._clusterExchange) return ctx._clusterExchange
	ctx._clusterExchange = createExchange({
		peers: () => clusterOf(ctx).snapshot().peers,
		has: (d) => duties.has(d),
		call: (id, action, args, o) => callOf(ctx).call(id, action, args, o),
		broadcast: (type, data) => typeof ctx._wsBroadcast === 'function' && ctx._wsBroadcast(type, data),
		onData: (topic, data, source) => topic === 'air' && ctx.zoneService?.onAir(`peer:${source.id}`, data.program),
		log: ctx.log,
	})
	return ctx._clusterExchange
}

/** GET /api/cluster body = WS `cluster:peers` (+ `fanout`: P4a forwarding status per server). */
const full = (ctx) => ({ ...clusterOf(ctx).snapshot(), master: masterOf(ctx).view(),
	fanout: ctx._clusterFanout ? ctx._clusterFanout.status() : { active: false, peers: {} },
	follows_master: ctx._clusterMaster ? followsMaster(ctx) : false })

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
	routes.delete('/api/cluster/peers/:id', async ({ ctx, params, query }) => {
		// WO-732: unlinks there too; `?link_back=0` = that server is the one unlinking
		const r = await clusterOf(ctx).unlink(params.id, { linkBack: String(query?.link_back ?? '') !== '0' })
		if (r.ok && clusterOf(ctx).size() === 0) masterOf(ctx).forget()
		return reply(r.ok ? 200 : 404, r.ok ? r : { error: 'no such server' })
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
	routes.post('/api/cluster/call', async ({ ctx, body }) => {
		const r = await callOf(ctx).handle(parseBody(body))
		return reply(r.status, r.body)
	}, opt)
	routes.post('/api/cluster/send', async ({ ctx, body }) => {
		const b = parseBody(body) || {}
		const r = await callOf(ctx).call(String(b.peer || ''), String(b.action || ''), b.args)
		return reply(r.status || 502, r.json && typeof r.json === 'object' ? r.json : { error: r.error || 'no answer' })
	}, opt)
	routes.get('/api/cluster/exchange', ({ ctx }) => reply(200, exchangeOf(ctx).view()), opt)
	routes.get('/api/cluster/peers/:id/device-view', async ({ ctx, params }) => {
		const r = await clusterOf(ctx).deviceView(params.id)
		return reply(r.status, r.body)
	}, opt)
}

/** At boot: record what goes on air (P4b); start polling (and failover) when this server has linked servers. */
function startIfLinked(ctx) {
	airJournalOf(ctx)
	const peers = (ctx.persistence || defaultPersistence).get('clusterPeers')
	if (Array.isArray(peers) && peers.length) clusterOf(ctx)
}

module.exports = { register, clusterOf, masterOf, fanoutOf, followsMaster, isClusterFollower, callOf, exchangeOf, sendersSyncOf, sendersReceived, startIfLinked }
