'use strict'

const { getReplicationConfig, normalizeReplicationConfig } = require('../config/replication-config')
const { markLiveStateDirty } = require('./live-state-feed')
const { isAmcpFanoutMirrorConfigured } = require('./amcp-fanout')
const { syncPeerCasparConnection } = require('./replication-reload')
const { stopPlayheadSync } = require('./playhead-sync')
const { peerHttpRequest } = require('./peer-client')

/**
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 * @param {{ reason?: string }} [opts]
 */
async function promoteToLeader(ctx, runtime, opts = {}) {
	const repl = getReplicationConfig(ctx.config)
	if (!repl.enabled) return { ok: false, error: 'replication disabled' }

	const wasFanout = isAmcpFanoutMirrorConfigured(ctx.config)
	stopPlayheadSync()

	const nextEpoch = (repl.leaderEpoch || 0) + 1
	const nextRepl = normalizeReplicationConfig({
		...repl,
		leaderEpoch: nextEpoch,
		role: 'leader',
		leaderAvailable: true,
	})

	if (ctx.configManager) {
		const cfg = { ...ctx.configManager.get(), replication: nextRepl }
		ctx.configManager.save(cfg)
		if (ctx.config) Object.assign(ctx.config, ctx.configManager.get())
	}

	runtime.roleState.forceRole('leader')
	runtime.promotedAt = Date.now()
	runtime.promoteReason = opts.reason || 'manual'

	if (repl.peer.host && repl.peer.token && !opts.skipYieldNotify) {
		void peerHttpRequest(repl.peer, '/api/replication/leader-yield', {
			method: 'POST',
			body: { leaderEpoch: nextEpoch, reason: runtime.promoteReason },
			timeoutMs: 4000,
		}).catch(() => {})
	}

	syncPeerCasparConnection(ctx, runtime)

	if (!wasFanout && runtime.lastLiveIntent) {
		const { applyLiveIntentOnFollower } = require('./mirror-apply')
		await applyLiveIntentOnFollower(ctx, runtime.lastLiveIntent, nextRepl)
	}

	if (!wasFanout) {
		markLiveStateDirty(runtime, ctx)
	}

	if (typeof ctx.log === 'function') {
		ctx.log(
			'info',
			`[replication] promoted to leader epoch=${nextEpoch} reason=${runtime.promoteReason}${wasFanout ? ' (caspar already on air via fan-out)' : ''}`,
		)
	}

	return {
		ok: true,
		leaderEpoch: nextEpoch,
		reason: runtime.promoteReason,
		casparAlreadyOnAir: wasFanout,
	}
}

/**
 * Old leader stops fan-out when backup promotes.
 * @param {object} ctx
 * @param {{ leaderEpoch?: number, reason?: string }} body
 */
async function leaderYield(ctx, body) {
	const repl = getReplicationConfig(ctx.config)
	const runtime = ctx._replication
	const incomingEpoch = parseInt(String(body?.leaderEpoch ?? 0), 10) || 0
	if (incomingEpoch <= (repl.leaderEpoch || 0)) {
		return { ok: false, error: 'epoch not ahead of local leaderEpoch' }
	}

	stopPlayheadSync()
	if (runtime) syncPeerCasparConnection(ctx, runtime)

	const nextRepl = normalizeReplicationConfig({
		...repl,
		leaderEpoch: incomingEpoch,
		leaderAvailable: false,
	})
	if (ctx.configManager) {
		const cfg = { ...ctx.configManager.get(), replication: nextRepl }
		ctx.configManager.save(cfg)
		if (ctx.config) Object.assign(ctx.config, ctx.configManager.get())
	}
	if (runtime) {
		runtime.roleState.forceRole('follower')
		runtime.demotedAt = Date.now()
		syncPeerCasparConnection(ctx, runtime)
	}

	if (typeof ctx.log === 'function') {
		ctx.log('info', `[replication] leader yield epoch=${incomingEpoch} reason=${body?.reason || 'peer_promote'}`)
	}

	return { ok: true, leaderEpoch: incomingEpoch }
}

/**
 * Demote when peer has higher epoch (split-brain guard).
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 * @param {number} peerEpoch
 */
async function demoteToFollower(ctx, runtime, peerEpoch) {
	stopPlayheadSync()
	syncPeerCasparConnection(ctx, runtime)
	runtime.roleState.forceRole('follower')
	runtime.demotedAt = Date.now()
	runtime.peerLeaderEpoch = peerEpoch
	if (typeof ctx.log === 'function') {
		ctx.log('warn', `[replication] demoted to follower (peer epoch ${peerEpoch})`)
	}
	const { reconcileFromLeader } = require('./replication-reconcile')
	await reconcileFromLeader(ctx, runtime)
	return { ok: true }
}

/**
 * Generate pairing credentials for launcher setup.
 */
function generatePairingCredentials() {
	const crypto = require('crypto')
	return {
		pairId: crypto.randomUUID(),
		token: crypto.randomBytes(24).toString('hex'),
	}
}

module.exports = { promoteToLeader, demoteToFollower, leaderYield, generatePairingCredentials }
