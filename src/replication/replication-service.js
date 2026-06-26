'use strict'

const crypto = require('crypto')
const { RoleState } = require('./role-state')
const { startPeerClient } = require('./peer-client')
const { startPeerWsClient } = require('./peer-ws-client')
const { getReplicationConfig, replicationPairConfigured, normalizeReplicationConfig } = require('../config/replication-config')
const { markLiveStateDirty, broadcastLiveState } = require('./live-state-feed')
const { getMediaSyncStatus } = require('./syncthing-media-status')
const { pushProjectToPeer, reconcileProjectsToPeer } = require('./replicate-projects')
const { scheduleLiveIntentApply } = require('./mirror-apply')

/**
 * @typedef {object} ReplicationRuntime
 * @property {RoleState} roleState
 * @property {Set<import('ws')>} peerWsClients
 * @property {number} liveStateSeq
 * @property {object|null} lastLiveIntent
 * @property {number} lastAppliedSeq
 * @property {boolean} peerReachable
 * @property {number} lastPeerPingAt
 * @property {object|null} lastPeerPing
 * @property {number} peerLeaderEpoch
 * @property {number} projectsPushed
 * @property {number} promotedAt
 * @property {string} promoteReason
 * @property {number} demotedAt
 * @property {() => number} getOperatorWsCount
 * @property {object|null} peerClient
 * @property {string} configHash
 */

/** @type {ReplicationRuntime|null} */
let _runtime = null

function hashConfig(cfg) {
	try {
		return crypto.createHash('sha256').update(JSON.stringify(cfg?.replication || {})).digest('hex').slice(0, 16)
	} catch {
		return 'unknown'
	}
}

/**
 * @param {object} ctx
 * @param {{ clients?: Set, getOperatorWsCount?: () => number }} [wsInfo]
 */
function startReplicationService(ctx, wsInfo = {}) {
	const repl = getReplicationConfig(ctx.config)
	const roleState = new RoleState()
	roleState.configure({ enabled: repl.enabled, role: repl.role })

	/** @type {ReplicationRuntime} */
	const runtime = {
		roleState,
		peerWsClients: new Set(),
		liveStateSeq: 0,
		lastLiveIntent: null,
		lastAppliedSeq: 0,
		peerReachable: false,
		lastPeerPingAt: 0,
		lastPeerPing: null,
		peerLeaderEpoch: 0,
		projectsPushed: 0,
		promotedAt: 0,
		promoteReason: '',
		demotedAt: 0,
		getOperatorWsCount: wsInfo.getOperatorWsCount || (() => (wsInfo.clients ? wsInfo.clients.size : 0)),
		peerClient: null,
		configHash: hashConfig(ctx.config),
	}

	const updateWsCount = () => {
		runtime.roleState.setOperatorWsClientCount(runtime.getOperatorWsCount())
	}
	updateWsCount()

	roleState.on('roleChange', (next, prev) => {
		if (typeof ctx.log === 'function') {
			ctx.log('info', `[replication] role ${prev} → ${next}`)
		}
		if (next === 'leader' && replicationPairConfigured(getReplicationConfig(ctx.config))) {
			void reconcileProjectsToPeer(ctx, runtime)
			markLiveStateDirty(runtime, ctx)
		}
	})

	const peerClient = startPeerClient(ctx, runtime)
	runtime.peerClient = peerClient
	const peerWsClient = startPeerWsClient(ctx, runtime)
	runtime.peerWsClient = peerWsClient

	if (repl.enabled && repl.peer.host) {
		peerClient.start()
	}

	ctx._replication = runtime
	ctx.onProjectSavedForReplication = (project) => {
		void pushProjectToPeer(ctx, runtime, project)
	}
	ctx.markReplicationLiveStateDirty = () => markLiveStateDirty(runtime, ctx)

	_runtime = runtime
	return runtime
}

function stopReplicationService(ctx) {
	const rt = ctx?._replication || _runtime
	if (rt?.peerClient) rt.peerClient.stop()
	if (rt?.peerWsClient) rt.peerWsClient.stop()
	if (ctx) delete ctx._replication
	_runtime = null
}

/**
 * @param {object} ctx
 */
function getReplicationRuntime(ctx) {
	return ctx?._replication || _runtime
}

/**
 * Handle inbound peer WS message on follower.
 * @param {object} ctx
 * @param {object} msg
 */
async function handlePeerWsMessage(ctx, msg) {
	const runtime = getReplicationRuntime(ctx)
	if (!runtime || msg?.type !== 'live_state' || !msg.data) return

	const repl = getReplicationConfig(ctx.config)
	if (runtime.roleState.getRole() !== 'follower') return

	runtime.lastLiveIntent = msg.data
	if (msg.data.seq) runtime.lastPeerLiveSeq = msg.data.seq

	if (repl.followerMode === 'mirror') {
		await scheduleLiveIntentApply(ctx, msg.data, repl)
		runtime.lastAppliedSeq = msg.data.seq || runtime.lastAppliedSeq
	}
}

/**
 * @param {object} ctx
 */
async function buildReplicationStatus(ctx) {
	const runtime = getReplicationRuntime(ctx)
	const repl = getReplicationConfig(ctx.config)
	const media = await getMediaSyncStatus(repl.syncthingMediaFolderId)

	const role = runtime?.roleState?.getRole() || 'standalone'
	const liveLag =
		runtime?.lastLiveIntent?.seq && runtime.lastAppliedSeq
			? Math.max(0, runtime.lastLiveIntent.seq - runtime.lastAppliedSeq)
			: 0

	return {
		enabled: repl.enabled,
		configured: replicationPairConfigured(repl),
		role,
		configuredRole: repl.role,
		selfId: repl.selfId,
		pairId: repl.pairId,
		leaderEpoch: repl.leaderEpoch,
		peer: { host: repl.peer.host, port: repl.peer.port },
		peerReachable: !!runtime?.peerReachable,
		lastPeerPingAgeMs: runtime?.lastPeerPingAt ? Date.now() - runtime.lastPeerPingAt : null,
		peerLeaderEpoch: runtime?.peerLeaderEpoch ?? null,
		followerMode: repl.followerMode,
		autoPromote: repl.autoPromote,
		operatorWsClients: runtime?.roleState?.getOperatorWsClientCount() ?? 0,
		liveStateSeq: runtime?.liveStateSeq ?? 0,
		lastAppliedSeq: runtime?.lastAppliedSeq ?? 0,
		liveStateLag: liveLag,
		projectsPushed: runtime?.projectsPushed ?? 0,
		mediaSync: media,
		scheduledApply: repl.scheduledApply,
		promotedAt: runtime?.promotedAt || null,
		promoteReason: runtime?.promoteReason || null,
	}
}

/**
 * @param {object} ctx
 * @param {number} operatorCount
 */
function notifyOperatorWsCount(ctx, operatorCount) {
	const runtime = getReplicationRuntime(ctx)
	if (!runtime) return
	runtime.roleState.setOperatorWsClientCount(operatorCount)
}

/**
 * @param {import('ws')} ws
 */
function registerPeerWsClient(ws) {
	if (!_runtime) return
	_runtime.peerWsClients.add(ws)
	ws.on('close', () => _runtime?.peerWsClients.delete(ws))
	if (_runtime.lastLiveIntent) broadcastLiveState(_runtime, _runtime.peerWsClients)
}

module.exports = {
	startReplicationService,
	stopReplicationService,
	getReplicationRuntime,
	handlePeerWsMessage,
	buildReplicationStatus,
	notifyOperatorWsCount,
	registerPeerWsClient,
	hashConfig,
}
