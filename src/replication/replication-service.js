'use strict'

const crypto = require('crypto')
const { RoleState } = require('./role-state')
const { startPeerClient } = require('./peer-client')
const { startPeerWsClient } = require('./peer-ws-client')
const { getReplicationConfig, replicationPairConfigured, normalizeReplicationConfig } = require('../config/replication-config')
const { markLiveStateDirty, broadcastLiveState } = require('./live-state-feed')
const { pushProjectToPeer, reconcileProjectsToPeer } = require('./replicate-projects')
const { reconcileAllToPeer } = require('./replication-reconcile')
const { scheduleLiveIntentApply } = require('./mirror-apply')
const {
	hashConfig,
	getReplicationRuntime,
	getReplicationCtx,
	setReplicationRuntime,
	clearReplicationRuntime,
} = require('./replication-service-runtime')
const { buildReplicationStatus } = require('./replication-service-status')

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

/**
 * @param {object} ctx
 * @param {{ clients?: Set, getOperatorWsCount?: () => number }} [wsInfo]
 */
function startReplicationService(ctx, wsInfo = {}) {
	try {
		const { ensureLocalReplicationSelfId } = require('./replication-local-identity')
		ensureLocalReplicationSelfId(ctx)
	} catch {
		/* optional */
	}
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
		peerInstanceId: null,
		instanceId: crypto.randomBytes(8).toString('hex'),
		peerLeaderEpoch: 0,
		projectsPushed: 0,
		timelinesPushed: 0,
		peerLastAppliedSeq: 0,
		initialSync: { inProgress: false, phase: 'idle', percent: 100, startedAt: 0 },
		promotedAt: 0,
		promoteReason: '',
		demotedAt: 0,
		clockOffsetMs: 0,
		lastClockSyncAt: 0,
		getOperatorWsCount: wsInfo.getOperatorWsCount || (() => (wsInfo.clients ? wsInfo.clients.size : 0)),
		peerClient: null,
		peerWsConnected: false,
		lastMediaSync: null,
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
			void reconcileAllToPeer(ctx, runtime)
			markLiveStateDirty(runtime, ctx)
		}
	})

	const peerClient = startPeerClient(ctx, runtime)
	runtime.peerClient = peerClient
	const peerWsClient = startPeerWsClient(ctx, runtime)
	runtime.peerWsClient = peerWsClient

	const liveSceneState = require('../state/live-scene-state')
	const { getChannelMap } = require('../config/routing')
	liveSceneState.onProgramChange((channel, entry) => {
		const map = getChannelMap(ctx.config || {})
		const programChannels = []
		for (let i = 0; i < map.screenCount; i++) programChannels.push(map.programCh(i + 1))
		if (!programChannels.includes(channel)) return
		if (runtime.roleState.getRole() !== 'leader') return
		for (let screenIdx = 1; screenIdx <= map.screenCount; screenIdx++) {
			if (map.programCh(screenIdx) !== channel) continue
			if (runtime._replAnnouncedTake?.[String(screenIdx)] === entry?.updatedAt) return
			break
		}
		markLiveStateDirty(runtime, ctx)
	})

	if (repl.enabled && repl.peer.host) {
		const { reloadReplicationFromConfig } = require('./replication-reload')
		reloadReplicationFromConfig(ctx)
		try {
			const { ensureReplicationSshKey, ensurePeerAuthorizedKeyFromConfig } = require('./replication-ssh-setup')
			ensureReplicationSshKey(ctx.log)
			ensurePeerAuthorizedKeyFromConfig(ctx)
		} catch (e) {
			if (typeof ctx.log === 'function') {
				ctx.log('warn', `[replication] SSH key boot prepare: ${e?.message || e}`)
			}
		}
		void (async () => {
			try {
				const { forcePeerPing } = require('./replication-refresh')
				const ping = await forcePeerPing(ctx, runtime)
				if (ping.ok && runtime.roleState.getRole() === 'follower') {
					const { reconcileFromLeader } = require('./replication-reconcile')
					await reconcileFromLeader(ctx, runtime)
				}
			} catch (e) {
				if (typeof ctx.log === 'function') {
					ctx.log('warn', '[replication] boot connection refresh: ' + (e?.message || e))
				}
			}
		})()
	}

	ctx._replication = runtime
	ctx.onProjectSavedForReplication = (project) => {
		void pushProjectToPeer(ctx, runtime, project, { reason: 'save' })
	}
	ctx.markReplicationLiveStateDirty = () => markLiveStateDirty(runtime, ctx)

	setReplicationRuntime(runtime, ctx)
	return runtime
}

function stopReplicationService(ctx) {
	try {
		require('./project-push-debounce').cancelScheduledProjectPushToPeer()
	} catch {
		/* optional */
	}
	const rt = ctx?._replication || _runtime
	if (rt?.peerClient) rt.peerClient.stop()
	if (rt?.peerWsClient) rt.peerWsClient.stop()
	if (rt?.peerCasparConnection) {
		rt.peerCasparConnection.stop()
		rt.peerCasparConnection = null
	}
	try {
		require('./amcp-fanout').unbindAmcpFanout()
	} catch {
		/* ignore */
	}
	try {
		require('./playhead-sync').stopPlayheadSync()
	} catch {
		/* ignore */
	}
	if (ctx) delete ctx._replication
	clearReplicationRuntime()
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

	const { shouldSkipSemanticLiveMirror } = require('./amcp-fanout')
	if (shouldSkipSemanticLiveMirror(ctx.config)) return

	if (repl.followerMode === 'mirror') {
		const result = await scheduleLiveIntentApply(ctx, msg.data, repl, runtime)
		if (result?.channelsApplied > 0 || result?.alreadyMirrored) {
			runtime.lastAppliedSeq = msg.data.seq || runtime.lastAppliedSeq
		}
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
	const runtime = getReplicationRuntime()
	if (!runtime) return
	runtime.peerWsClients.add(ws)
	ws.on('close', () => {
		const rt = getReplicationRuntime()
		rt?.peerWsClients.delete(ws)
		const ctx = getReplicationCtx()
		if (ctx) {
			const { notifyReplicationStatusChanged } = require('./replication-ui-notify')
			notifyReplicationStatusChanged(ctx, 'peer-ws-inbound-closed')
		}
	})
	if (runtime.lastLiveIntent) broadcastLiveState(runtime, runtime.peerWsClients)
	const ctx = getReplicationCtx()
	if (ctx) {
		const { notifyReplicationStatusChanged } = require('./replication-ui-notify')
		notifyReplicationStatusChanged(ctx, 'peer-ws-inbound')
	}
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
