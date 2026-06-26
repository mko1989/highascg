'use strict'

const crypto = require('crypto')
const { getReplicationConfig, normalizeReplicationConfig } = require('../config/replication-config')
const { markLiveStateDirty } = require('./live-state-feed')

/**
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 * @param {{ reason?: string }} [opts]
 */
async function promoteToLeader(ctx, runtime, opts = {}) {
	const repl = getReplicationConfig(ctx.config)
	if (!repl.enabled) return { ok: false, error: 'replication disabled' }

	const nextEpoch = (repl.leaderEpoch || 0) + 1
	const nextRepl = normalizeReplicationConfig({
		...repl,
		leaderEpoch: nextEpoch,
		role: repl.role === 'follower' ? 'auto' : repl.role,
	})

	if (ctx.configManager) {
		const cfg = { ...ctx.configManager.get(), replication: nextRepl }
		ctx.configManager.save(cfg)
		if (ctx.config) Object.assign(ctx.config, ctx.configManager.get())
	}

	runtime.roleState.forceRole('leader')
	runtime.promotedAt = Date.now()
	runtime.promoteReason = opts.reason || 'manual'

	if (runtime.lastLiveIntent && repl.followerMode === 'mirror') {
		const { applyLiveIntentOnFollower } = require('./mirror-apply')
		await applyLiveIntentOnFollower(ctx, runtime.lastLiveIntent, nextRepl)
	}

	markLiveStateDirty(runtime, ctx)

	if (typeof ctx.log === 'function') {
		ctx.log('info', `[replication] promoted to leader epoch=${nextEpoch} reason=${runtime.promoteReason}`)
	}

	return { ok: true, leaderEpoch: nextEpoch, reason: runtime.promoteReason }
}

/**
 * Demote when peer has higher epoch (split-brain guard).
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 * @param {number} peerEpoch
 */
async function demoteToFollower(ctx, runtime, peerEpoch) {
	runtime.roleState.forceRole('follower')
	if (typeof ctx.log === 'function') {
		ctx.log('warn', `[replication] demoted to follower (peer epoch ${peerEpoch})`)
	}
	const { reconcileProjectsToPeer } = require('./replicate-projects')
	// follower pulls reconcile from new leader via peer ping cycle — trigger inbound reconcile hook
	runtime.demotedAt = Date.now()
	return { ok: true }
}

/**
 * Generate pairing credentials for launcher setup.
 */
function generatePairingCredentials() {
	return {
		pairId: crypto.randomUUID(),
		token: crypto.randomBytes(24).toString('hex'),
	}
}

module.exports = { promoteToLeader, demoteToFollower, generatePairingCredentials }
