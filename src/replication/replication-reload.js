'use strict'

const { getReplicationConfig, replicationPairConfigured } = require('../config/replication-config')
const { getReplicationRuntime } = require('./replication-service')
const { PeerCasparConnection } = require('./peer-caspar-connection')
const { bindAmcpFanout, unbindAmcpFanout, isAmcpFanoutMirrorActive } = require('./amcp-fanout')
const { startPlayheadSync, stopPlayheadSync } = require('./playhead-sync')

/**
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 */
function syncPeerCasparConnection(ctx, runtime) {
	const repl = getReplicationConfig(ctx.config)
	const role = runtime.roleState?.getRole()

	if (runtime.peerCasparConnection) {
		runtime.peerCasparConnection.stop()
		runtime.peerCasparConnection = null
	}
	unbindAmcpFanout()
	stopPlayheadSync()

	const useFanout =
		repl.enabled &&
		role === 'leader' &&
		replicationPairConfigured(repl) &&
		String(repl.mirrorTransport || 'live-state') === 'amcp-fanout' &&
		repl.amcpFanout?.enabled !== false &&
		repl.peerCaspar?.host

	if (!useFanout) {
		stopPlayheadSync()
		return { ok: true, active: false }
	}

	const peer = new PeerCasparConnection({ log: ctx.log })
	runtime.peerCasparConnection = peer
	bindAmcpFanout(ctx, runtime)
	peer.connect(repl.peerCaspar.host, repl.peerCaspar.port)
	startPlayheadSync(ctx, runtime)

	if (typeof ctx.log === 'function') {
		ctx.log(
			'info',
			`[replication] AMCP fan-out → ${repl.peerCaspar.host}:${repl.peerCaspar.port}`,
		)
	}
	return { ok: true, active: true, endpoint: peer.endpoint }
}

/**
 * Apply saved replication config to the in-memory runtime (after become-leader / connect / disconnect).
 * @param {object} ctx
 */
function reloadReplicationFromConfig(ctx) {
	const runtime = getReplicationRuntime(ctx)
	if (!runtime) return { ok: false, error: 'replication runtime not started' }

	const repl = getReplicationConfig(ctx.config)
	runtime.roleState.configure({ enabled: repl.enabled, role: repl.role })
	if (repl.enabled && repl.role === 'leader') {
		runtime.roleState.forceRole('leader')
	} else if (repl.enabled && repl.role === 'follower') {
		runtime.roleState.forceRole('follower')
	} else if (!repl.enabled) {
		runtime.roleState.clearForcedRole()
	}
	runtime.configHash = require('./replication-service').hashConfig(ctx.config)

	if (repl.enabled && repl.peer.host) {
		runtime.peerClient?.start?.()
		if (repl.role === 'follower') {
			runtime.peerWsClient?.connect?.() || runtime.peerWsClient?.start?.()
		} else {
			runtime.peerWsClient?.stop?.()
		}
	} else {
		runtime.peerClient?.stop?.()
		runtime.peerWsClient?.stop?.()
	}

	syncPeerCasparConnection(ctx, runtime)

	return {
		ok: true,
		enabled: repl.enabled,
		leaderAvailable: repl.leaderAvailable,
		configured: replicationPairConfigured(repl),
		amcpFanout: isAmcpFanoutMirrorActive(ctx.config),
	}
}

module.exports = { reloadReplicationFromConfig, syncPeerCasparConnection, isAmcpFanoutMirrorActive }
