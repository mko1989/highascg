'use strict'

const { getReplicationConfig } = require('../config/replication-config')
const { getReplicationRuntime, buildReplicationStatus } = require('./replication-service')
const { reloadReplicationFromConfig } = require('./replication-reload')
const { updateClockOffsetFromPing } = require('./sync-clock')

/**
 * Force peer HTTP ping and update runtime reachability (same logic as peer-client tick success path).
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 */
async function forcePeerPing(ctx, runtime) {
	const repl = getReplicationConfig(ctx.config)
	if (!repl.enabled || !repl.peer?.host) {
		return { ok: false, error: 'replication not paired' }
	}
	const { peerPing } = require('./peer-client')
	const res = await peerPing(repl.peer)
	const now = Date.now()
	if (res.ok && res.json) {
		if (repl.pairId && res.json.pairId && res.json.pairId !== repl.pairId) {
			runtime.peerReachable = false
			runtime.lastPeerPingError = 'pair id mismatch'
			return { ok: false, error: 'pair id mismatch' }
		}
		runtime.lastPeerPingAt = now
		runtime.lastPeerPing = res.json
		runtime.peerReachable = true
		runtime.lastPeerPingError = null
		if (res.json.instanceId) runtime.peerInstanceId = res.json.instanceId
		updateClockOffsetFromPing(runtime, now, res.json)
		runtime.peerLeaderEpoch = res.json.leaderEpoch ?? runtime.peerLeaderEpoch
		if (typeof res.json.lastAppliedSeq === 'number') {
			runtime.peerLastAppliedSeq = res.json.lastAppliedSeq
		}
		runtime.peerLiveStateSeq = res.json.liveStateSeq ?? 0
		return { ok: true, ping: res.json }
	}
	runtime.peerReachable = false
	runtime.lastPeerPingError = res.error || (res.status ? `HTTP ${res.status}` : 'peer ping failed')
	return { ok: false, error: res.error || `HTTP ${res.status}` }
}

/**
 * Reconnect replication transports after restart or stale GUI state.
 * @param {object} ctx
 */
async function refreshReplicationConnection(ctx) {
	const runtime = getReplicationRuntime(ctx)
	if (!runtime) return { ok: false, error: 'replication service not started' }

	const repl = getReplicationConfig(ctx.config)
	if (!repl.enabled || !repl.peer?.host) {
		return { ok: false, error: 'not paired' }
	}

	reloadReplicationFromConfig(ctx)

	const pingOut = await forcePeerPing(ctx, runtime)

	const role = runtime.roleState.getRole()
	if (role === 'follower' && pingOut.ok) {
		try {
			const { reconcileFromLeader } = require('./replication-reconcile')
			await reconcileFromLeader(ctx, runtime)
		} catch (e) {
			if (typeof ctx.log === 'function') {
				ctx.log('warn', '[replication] refresh reconcile: ' + (e?.message || e))
			}
		}
	}

	const { validateCasparParityForPair } = require('./caspar-parity')
	try {
		const rt = getReplicationRuntime(ctx)
		if (rt) {
			const parity = await validateCasparParityForPair(ctx)
			rt.lastCasparParity = parity
		}
	} catch {
		/* optional */
	}

	const status = await buildReplicationStatus(ctx)
	const { notifyReplicationStatusChanged } = require('./replication-ui-notify')
	notifyReplicationStatusChanged(ctx, 'refresh-connection')

	if (role === 'leader' && pingOut.ok) {
		try {
			const { peerPost } = require('./peer-client')
			const peerRefresh = await peerPost(repl.peer, '/api/replication/refresh-connection', {}, {
				timeoutMs: 120_000,
			})
			if (!peerRefresh.ok && typeof ctx.log === 'function') {
				ctx.log(
					'warn',
					'[replication] peer refresh-connection: ' + (peerRefresh.error || `HTTP ${peerRefresh.status}`),
				)
			}
		} catch (e) {
			if (typeof ctx.log === 'function') {
				ctx.log('warn', '[replication] peer refresh-connection: ' + (e?.message || e))
			}
		}
	}

	return {
		ok: true,
		pingOk: pingOut.ok,
		pingError: pingOut.error || null,
		status,
	}
}

module.exports = { refreshReplicationConnection, forcePeerPing }
