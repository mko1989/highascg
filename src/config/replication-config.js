'use strict'

const { replicationDefaults } = require('./defaults-replication')

/**
 * @typedef {object} ReplicationPeer
 * @property {string} host
 * @property {number} port
 * @property {string} token
 */

/**
 * @typedef {object} ReplicationConfig
 * @property {boolean} enabled
 * @property {'auto'|'leader'|'follower'} role
 * @property {string} pairId
 * @property {string} selfId
 * @property {number} leaderEpoch
 * @property {ReplicationPeer} peer
 * @property {'mirror'|'armed'} followerMode
 * @property {boolean} autoPromote
 * @property {boolean} scheduledApply
 * @property {number} scheduledApplyLeadMs
 * @property {string} syncthingMediaFolderId
 */

/**
 * @param {unknown} raw
 * @returns {ReplicationConfig}
 */
function normalizeReplicationConfig(raw) {
	const d = replicationDefaults()
	if (!raw || typeof raw !== 'object') return { ...d }
	const o = /** @type {Record<string, unknown>} */ (raw)
	const peerRaw = o.peer && typeof o.peer === 'object' ? /** @type {Record<string, unknown>} */ (o.peer) : {}
	const role = String(o.role || d.role)
	const normalizedRole = role === 'leader' || role === 'follower' ? role : 'auto'
	const followerMode = String(o.followerMode || d.followerMode)
	return {
		enabled: !!o.enabled,
		role: normalizedRole,
		pairId: String(o.pairId || '').trim(),
		selfId: String(o.selfId || '').trim(),
		leaderEpoch: Math.max(0, parseInt(String(o.leaderEpoch ?? d.leaderEpoch), 10) || 0),
		peer: {
			host: String(peerRaw.host || '').trim(),
			port: Math.max(1, Math.min(65535, parseInt(String(peerRaw.port ?? d.peer.port), 10) || d.peer.port)),
			token: String(peerRaw.token || '').trim(),
		},
		followerMode: followerMode === 'armed' ? 'armed' : 'mirror',
		autoPromote: o.autoPromote !== false,
		scheduledApply: !!o.scheduledApply,
		scheduledApplyLeadMs: Math.max(
			100,
			Math.min(10000, parseInt(String(o.scheduledApplyLeadMs ?? d.scheduledApplyLeadMs), 10) || d.scheduledApplyLeadMs),
		),
		syncthingMediaFolderId: String(o.syncthingMediaFolderId || d.syncthingMediaFolderId).trim() || d.syncthingMediaFolderId,
	}
}

/**
 * @param {object} cfg
 * @returns {ReplicationConfig}
 */
function getReplicationConfig(cfg) {
	return normalizeReplicationConfig(cfg?.replication)
}

/**
 * @param {ReplicationConfig} repl
 * @returns {boolean}
 */
function replicationPairConfigured(repl) {
	return !!(repl.enabled && repl.pairId && repl.selfId && repl.peer.host && repl.peer.token)
}

module.exports = {
	normalizeReplicationConfig,
	getReplicationConfig,
	replicationPairConfigured,
}
