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
 * @property {boolean} leaderAvailable
 * @property {'mirror'|'armed'} followerMode
 * @property {boolean} autoPromote
 * @property {'standalone'|'promote'} disconnectPolicy
 * @property {boolean} scheduledApply
 * @property {number} scheduledApplyLeadMs
 * @property {'ct-ss'|'immediate'} syncClock
 * @property {string} syncthingMediaFolderId
 * @property {'rsync'|'syncthing'} mediaTransport
 * @property {'live-state'|'amcp-fanout'} mirrorTransport
 * @property {{ host: string, port: number, connectTimeoutMs?: number }} peerCaspar
 * @property {{ enabled?: boolean, confirmLooks?: boolean, maxUnconfirmed?: number }} amcpFanout
 * @property {{ enabled?: boolean, softThresholdMs?: number, hardThresholdMs?: number, sampleIntervalMs?: number, minCorrectionIntervalMs?: number, maxCorrectionsPerMinute?: number }} playheadSync
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
		leaderAvailable: !!o.leaderAvailable,
		peer: {
			host: String(peerRaw.host || '').trim(),
			port: Math.max(1, Math.min(65535, parseInt(String(peerRaw.port ?? d.peer.port), 10) || d.peer.port)),
			token: String(peerRaw.token || '').trim(),
		},
		followerMode: followerMode === 'armed' ? 'armed' : 'mirror',
		autoPromote: o.autoPromote === true,
		disconnectPolicy: String(o.disconnectPolicy || d.disconnectPolicy) === 'promote' ? 'promote' : 'standalone',
		scheduledApply: o.scheduledApply !== false,
		scheduledApplyLeadMs: Math.max(
			100,
			Math.min(10000, parseInt(String(o.scheduledApplyLeadMs ?? d.scheduledApplyLeadMs), 10) || d.scheduledApplyLeadMs),
		),
		syncClock: String(o.syncClock || d.syncClock) === 'immediate' ? 'immediate' : 'ct-ss',
		syncthingMediaFolderId: String(o.syncthingMediaFolderId || d.syncthingMediaFolderId).trim() || d.syncthingMediaFolderId,
		mediaTransport: String(o.mediaTransport || d.mediaTransport) === 'syncthing' ? 'syncthing' : 'rsync',
		mirrorTransport: String(o.mirrorTransport || d.mirrorTransport) === 'amcp-fanout' ? 'amcp-fanout' : 'live-state',
		peerCaspar: (() => {
			const pc = o.peerCaspar && typeof o.peerCaspar === 'object' ? /** @type {Record<string, unknown>} */ (o.peerCaspar) : {}
			const dpc = d.peerCaspar || { host: '', port: 5250, connectTimeoutMs: 5000 }
			return {
				host: String(pc.host ?? dpc.host ?? '').trim(),
				port: Math.max(1, Math.min(65535, parseInt(String(pc.port ?? dpc.port ?? 5250), 10) || 5250)),
				connectTimeoutMs: Math.max(
					500,
					Math.min(60000, parseInt(String(pc.connectTimeoutMs ?? dpc.connectTimeoutMs ?? 5000), 10) || 5000),
				),
			}
		})(),
		amcpFanout: (() => {
			const af = o.amcpFanout && typeof o.amcpFanout === 'object' ? /** @type {Record<string, unknown>} */ (o.amcpFanout) : {}
			const daf = d.amcpFanout || {}
			return {
				enabled: af.enabled !== false,
				confirmLooks: af.confirmLooks === true,
				maxUnconfirmed: Math.max(1, parseInt(String(af.maxUnconfirmed ?? daf.maxUnconfirmed ?? 3), 10) || 3),
			}
		})(),
		playheadSync: (() => {
			const ps = o.playheadSync && typeof o.playheadSync === 'object' ? /** @type {Record<string, unknown>} */ (o.playheadSync) : {}
			const dps = d.playheadSync || {}
			return {
				enabled: ps.enabled === true,
				softThresholdMs: Math.max(20, parseInt(String(ps.softThresholdMs ?? dps.softThresholdMs ?? 150), 10) || 150),
				hardThresholdMs: Math.max(500, parseInt(String(ps.hardThresholdMs ?? dps.hardThresholdMs ?? 2000), 10) || 2000),
				sampleIntervalMs: Math.max(1000, parseInt(String(ps.sampleIntervalMs ?? dps.sampleIntervalMs ?? 2000), 10) || 2000),
				minCorrectionIntervalMs: Math.max(
					1000,
					parseInt(String(ps.minCorrectionIntervalMs ?? dps.minCorrectionIntervalMs ?? 2000), 10) || 2000,
				),
				maxCorrectionsPerMinute: Math.max(
					1,
					parseInt(String(ps.maxCorrectionsPerMinute ?? dps.maxCorrectionsPerMinute ?? 6), 10) || 6,
				),
			}
		})(),
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
