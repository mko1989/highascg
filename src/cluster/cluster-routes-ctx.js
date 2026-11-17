'use strict'

/**
 * Helpers of routes-cluster.js that need no route state (moved out for the 500-line limit, WO-1106 C19/C29): the
 * sandbox guard for peer Caspar connections, the master's `dest.pressed` handler and the cluster Apply.
 */

const { isSandbox } = require('../bootstrap/sandbox')

/**
 * WO-1029: a sandbox opens a socket only to a loopback throwaway Caspar, never to :5250 (WO-990: the live Caspar's AMCP
 * acceptor dies on connect + reset) and never onto the LAN (WO-719). Outside a sandbox every address is allowed.
 */
function sandboxCaspar(host, port) {
	if (!isSandbox()) return true
	return Number(port) !== 5250 && /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/.test(String(host || ''))
}

/** A connection that never connects: the fan-out shows that server as not connected and sends nothing. */
function refusedPeerCaspar(ctx, host, port) {
	ctx.log?.('warn', `[cluster] sandbox: refusing to forward to ${host}:${port} (only a loopback throwaway Caspar, never :5250)`)
	return { isConnected: false, stop() {}, enqueueSend() {}, enqueueBatchLines() {} }
}

/** WO-1029 2a: an owner pressed on its own screen locally → the master stops catching that screen up there. */
function destPressed(ctx, args, peer) {
	const destId = String(args?.destId || '')
	if (!destId || !Number.isFinite(Number(args?.seq))) return { status: 400, body: { error: 'destId and seq required' } }
	if (!ctx._clusterFanout) return { status: 409, body: { error: 'not forwarding (not the master)' } }
	return ctx._clusterFanout.ownerPressed(peer?.id, destId, Number(args.seq))
}

/** WO-1029: one Apply for every linked server that needs it, only those (cluster-apply.js); each runs on its own server. */
function applyOf(ctx) {
	if (ctx._clusterApply) return ctx._clusterApply
	const { clusterOf, masterOf, relayOf, safeDestinations } = require('../api/routes-cluster') // lazy: it requires this file
	const selfId = () => clusterOf(ctx).snapshot().self?.id || 'self'
	ctx._clusterApply = require('../cluster/cluster-apply').createClusterApply({
		selfId,
		selfName: () => clusterOf(ctx).snapshot().self?.hostname || '',
		peers: () => clusterOf(ctx).snapshot().peers,
		peerCaps: (id) => clusterOf(ctx).peerCaps(id), // WO-1029 C0
		masterId: () => (masterOf(ctx).view().is_master ? selfId() : masterOf(ctx).view().master_id || ''),
		localDirty: () => require('../config/caspar-config-dirty').casparConfigDirty(ctx),
		localApply: (b) => require('../api/routes-caspar-config').handlePost('/api/caspar-config/apply', JSON.stringify(b), ctx),
		relay: (method, id, p, b) => relayOf(ctx)({ method, id, tail: p.replace(/^\/+/, ''), query: {}, body: b == null ? undefined : JSON.stringify(b) }),
		screens: () => {
			const by = {}
			for (const d of safeDestinations(ctx)) for (const o of d.owners || []) (by[o] = by[o] || []).push(d.label || d.id)
			return by
		},
		broadcast: (data) => typeof ctx._wsBroadcast === 'function' && ctx._wsBroadcast('cluster:apply', data),
		log: ctx.log,
	})
	return ctx._clusterApply
}

module.exports = { sandboxCaspar, refusedPeerCaspar, destPressed, applyOf }
