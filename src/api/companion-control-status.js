'use strict'

const os = require('os')
const { getReplicationConfig, replicationPairConfigured } = require('../config/replication-config')
const { localPrimaryIp } = require('../replication/caspar-endpoint')

/**
 * @typedef {'standalone'|'leader_air'|'follower_standby'|'follower_promoted_backup'|'degraded_no_caspar'|'not_paired'} ControlPlaneReason
 * @typedef {'self'|'peer'|'none'} SuggestedCompanionTarget
 */

/**
 * @typedef {object} CompanionControlSnapshot
 * @property {boolean} replicationEnabled
 * @property {boolean} paired
 * @property {'standalone'|'leader'|'follower'} role
 * @property {'auto'|'leader'|'follower'} configuredRole
 * @property {boolean} peerReachable
 * @property {string} peerHost
 * @property {boolean} casparLocalConnected
 * @property {boolean} channelParityOk
 * @property {boolean} amcpFanoutActive
 * @property {boolean} peerCasparConnected
 * @property {number|null} promotedAt
 * @property {string|null} promoteReason
 * @property {string} mirrorTransport
 * @property {string} hostname
 * @property {string} boxHost
 */

/**
 * Pure control-plane rules (unit-testable).
 * @param {CompanionControlSnapshot} snap
 */
function computeCompanionControlStatus(snap) {
	/** @type {string[]} */
	const warnings = []
	if (!snap.channelParityOk) warnings.push('channel_parity_mismatch')

	const base = (overrides) => {
		const out = {
			ok: true,
			hostname: snap.hostname,
			boxHost: snap.boxHost,
			role: snap.role,
			configuredRole: snap.configuredRole,
			replicationEnabled: snap.replicationEnabled,
			paired: snap.paired,
			peerHost: snap.peerHost || '',
			peerReachable: snap.peerReachable,
			acceptsCompanionControl: false,
			controlPlaneReason: /** @type {ControlPlaneReason} */ ('standalone'),
			airLeader: snap.role === 'leader',
			promotedAt: snap.promotedAt || null,
			promoteReason: snap.promoteReason || null,
			mirrorTransport: snap.mirrorTransport,
			amcpFanoutActive: snap.amcpFanoutActive,
			peerCasparConnected: snap.peerCasparConnected,
			casparLocalConnected: snap.casparLocalConnected,
			channelParityOk: snap.channelParityOk,
			suggestedCompanionTarget: /** @type {SuggestedCompanionTarget} */ ('none'),
			...overrides,
		}
		if (warnings.length) out.warnings = warnings
		return out
	}

	if (!snap.casparLocalConnected) {
		return base({
			acceptsCompanionControl: false,
			controlPlaneReason: 'degraded_no_caspar',
			airLeader: false,
			suggestedCompanionTarget: 'none',
		})
	}

	if (!snap.replicationEnabled) {
		return base({
			acceptsCompanionControl: true,
			controlPlaneReason: 'standalone',
			suggestedCompanionTarget: 'self',
		})
	}

	if (!snap.paired) {
		return base({
			acceptsCompanionControl: true,
			controlPlaneReason: 'not_paired',
			suggestedCompanionTarget: 'self',
		})
	}

	if (snap.role === 'leader') {
		const promoted =
			snap.configuredRole === 'follower' || !!(snap.promotedAt && snap.promotedAt > 0)
		return base({
			acceptsCompanionControl: true,
			controlPlaneReason: promoted ? 'follower_promoted_backup' : 'leader_air',
			airLeader: true,
			suggestedCompanionTarget: 'self',
		})
	}

	// Follower on standby — defer control to peer leader when reachable.
	return base({
		acceptsCompanionControl: false,
		controlPlaneReason: 'follower_standby',
		airLeader: false,
		suggestedCompanionTarget: snap.peerReachable ? 'peer' : 'none',
	})
}

/**
 * @param {object} ctx
 */
function isCasparLocalConnected(ctx) {
	if (ctx?.config?.offline_mode) return true
	if (ctx?._casparStatus && typeof ctx._casparStatus.connected === 'boolean') {
		return ctx._casparStatus.connected
	}
	if (ctx?.amcp && typeof ctx.amcp.isConnected === 'boolean') {
		return ctx.amcp.isConnected
	}
	return false
}

/**
 * Lightweight Companion control-plane snapshot (no Caspar INFO round-trip).
 * @param {object} ctx
 */
function buildCompanionControlStatus(ctx) {
	const repl = getReplicationConfig(ctx?.config)
	const { getReplicationRuntime } = require('../replication/replication-service')
	const runtime = getReplicationRuntime(ctx)
	const role = runtime?.roleState?.getRole() || 'standalone'
	const paired = replicationPairConfigured(repl)

	let channelParityOk = true
	try {
		const { buildChannelMapSummary, compareChannelParity } = require('../replication/channel-parity')
		const localMap = buildChannelMapSummary(ctx.config)
		const peerMap = runtime?.lastPeerPing?.channelMap || null
		if (paired && peerMap) {
			channelParityOk = compareChannelParity(localMap, peerMap).ok
		}
	} catch {
		channelParityOk = true
	}

	let amcpFanoutActive = false
	try {
		amcpFanoutActive = require('../replication/amcp-fanout').isAmcpFanoutMirrorActive(ctx.config)
	} catch {
		amcpFanoutActive = false
	}

	const promotedAt = runtime?.promotedAt > 0 ? runtime.promotedAt : null

	return computeCompanionControlStatus({
		replicationEnabled: repl.enabled,
		paired,
		role,
		configuredRole: repl.role,
		peerReachable: !!runtime?.peerReachable,
		peerHost: repl.peer?.host || '',
		casparLocalConnected: isCasparLocalConnected(ctx),
		channelParityOk,
		amcpFanoutActive,
		peerCasparConnected: !!runtime?.peerCasparConnection?.isConnected,
		promotedAt,
		promoteReason: runtime?.promoteReason || null,
		mirrorTransport: repl.mirrorTransport,
		hostname: os.hostname(),
		boxHost: localPrimaryIp(),
	})
}

module.exports = {
	buildCompanionControlStatus,
	computeCompanionControlStatus,
	isCasparLocalConnected,
}
