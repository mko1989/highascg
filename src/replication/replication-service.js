'use strict'

const crypto = require('crypto')
const os = require('os')
const { RoleState } = require('./role-state')
const { startPeerClient } = require('./peer-client')
const { startPeerWsClient } = require('./peer-ws-client')
const { getReplicationConfig, replicationPairConfigured, normalizeReplicationConfig } = require('../config/replication-config')
const { markLiveStateDirty, broadcastLiveState } = require('./live-state-feed')
const { pushProjectToPeer, reconcileProjectsToPeer } = require('./replicate-projects')
const { reconcileAllToPeer } = require('./replication-reconcile')
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
/** @type {object|null} */
let _ctx = null

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
	_ctx = ctx
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
 * @param {import('./replication-service').ReplicationRuntime} runtime
 * @param {object|null} peerPing
 * @param {ReturnType<import('../config/replication-config').getReplicationConfig>} repl
 */
function buildPeerBox(runtime, peerPing, repl) {
	if (!repl.enabled || !repl.peer?.host) return null
	const ping = peerPing || {}
	return {
		host: repl.peer.host,
		port: repl.peer.port || 4200,
		selfId: ping.selfId || null,
		hostname: ping.hostname || null,
		reachable: !!runtime?.peerReachable,
		pingAgeMs: runtime?.lastPeerPingAt ? Date.now() - runtime.lastPeerPingAt : null,
		role: ping.role || null,
		appVersion: ping.appVersion || null,
		configHash: ping.configHash || null,
		lastAppliedSeq: runtime?.peerLastAppliedSeq ?? ping.lastAppliedSeq ?? null,
		liveStateSeq: ping.liveStateSeq ?? null,
		casparHost: ping.casparHost || null,
		casparPort: ping.casparPort ?? null,
		mirrorTransport: ping.mirrorTransport || null,
		programFramerates: ping.programFramerates || {},
		channelMap: ping.channelMap || null,
	}
}

/**
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 * @param {ReturnType<import('../config/replication-config').getReplicationConfig>} repl
 */
function buildLocalBox(ctx, runtime, repl) {
	const { buildChannelMapSummary } = require('./channel-parity')
	let channelMap = null
	try {
		channelMap = buildChannelMapSummary(ctx.config)
	} catch {
		channelMap = null
	}
	return {
		selfId: repl.selfId,
		hostname: os.hostname(),
		role: runtime?.roleState?.getRole() || 'standalone',
		configHash: hashConfig(ctx.config),
		channelMap,
		liveStateSeq: runtime?.liveStateSeq ?? 0,
		lastAppliedSeq: runtime?.lastAppliedSeq ?? 0,
	}
}

/**
 * @param {object} ctx
 */
async function buildReplicationStatus(ctx) {
	const runtime = getReplicationRuntime(ctx)
	const repl = getReplicationConfig(ctx.config)
	const { getReplicationMediaSyncStatus } = require('./media-sync-status')
	const media = await getReplicationMediaSyncStatus(ctx)

	const role = runtime?.roleState?.getRole() || 'standalone'
	const leaderLag =
		runtime?.roleState?.getRole() === 'leader' &&
		runtime.liveStateSeq &&
		runtime.peerLastAppliedSeq
			? Math.max(0, runtime.liveStateSeq - runtime.peerLastAppliedSeq)
			: 0
	const liveLag =
		runtime?.roleState?.getRole() === 'follower' && runtime?.lastLiveIntent?.seq && runtime.lastAppliedSeq
			? Math.max(0, runtime.lastLiveIntent.seq - runtime.lastAppliedSeq)
			: leaderLag

	const peerPing = runtime?.lastPeerPing
	let casparOutput = { ok: true, warnings: [] }
	if (role === 'follower') {
		try {
			const { assessFollowerCasparOutputReadiness } = require('./follower-caspar-output')
			casparOutput = assessFollowerCasparOutputReadiness(ctx)
		} catch {
			casparOutput = { ok: true, warnings: [] }
		}
	}

	const amcpFanout = (() => {
		try {
			const fan = require('./amcp-fanout')
			return {
				active: fan.isAmcpFanoutMirrorActive(ctx.config),
				receiveBox: fan.isAmcpFanoutReceiveBox(ctx),
			}
		} catch {
			return { active: false, receiveBox: false }
		}
	})()

	const playheadSync = (() => {
		try {
			const { getPlayheadSyncStatus } = require('./playhead-sync')
			return {
				enabled: amcpFanout.active,
				measureOnly: true,
				...getPlayheadSyncStatus(runtime),
			}
		} catch {
			return { enabled: false, driftMs: 0, measureOnly: true }
		}
	})()

	const follower =
		role === 'leader' && repl.enabled && repl.peer?.host
			? {
					...buildPeerBox(runtime, peerPing, repl),
					mirrorLag: leaderLag,
				}
			: null

	const local = buildLocalBox(ctx, runtime, repl)
	const peerBox = repl.enabled && repl.peer?.host ? buildPeerBox(runtime, peerPing, repl) : null

	let channelParity = { ok: true, mismatches: [], peerAvailable: false, configHashMatch: null }
	try {
		const { compareChannelParity } = require('./channel-parity')
		channelParity = {
			...compareChannelParity(local.channelMap, peerBox?.channelMap || null),
			configHashMatch:
				peerBox?.configHash && local.configHash
					? peerBox.configHash === local.configHash
					: null,
		}
	} catch {
		/* ignore */
	}

	const { PING_MS } = require('./peer-client')
	const pingAgeMs = runtime?.lastPeerPingAt ? Date.now() - runtime.lastPeerPingAt : null
	const pingFresh = pingAgeMs != null && pingAgeMs <= Math.ceil(PING_MS * 2.5)
	const pairIdOk = !peerPing?.pairId || !repl.pairId || peerPing.pairId === repl.pairId
	const peerRoleOk =
		!peerPing?.role ||
		(role === 'leader' && peerPing.role === 'follower') ||
		(role === 'follower' && peerPing.role === 'leader')
	const wsConnected =
		role === 'follower'
			? !!runtime?.peerWsConnected
			: role === 'leader'
				? (runtime?.peerWsClients?.size ?? 0) > 0
				: true
	const peerHttpReachable = !!runtime?.peerReachable && pingFresh && pairIdOk && peerRoleOk
	const peerLinkReady = peerHttpReachable && wsConnected

	const connection = repl.enabled && repl.peer?.host
		? {
				peerHttp: {
					reachable: peerHttpReachable,
					rawReachable: !!runtime?.peerReachable,
					pingAgeMs,
					pingFresh,
					pairIdOk,
					peerRoleOk,
				},
				peerLiveWs:
					role === 'follower'
						? { connected: !!runtime?.peerWsConnected, direction: 'outbound' }
						: {
								connected: (runtime?.peerWsClients?.size ?? 0) > 0,
								clientCount: runtime?.peerWsClients?.size ?? 0,
								direction: 'inbound',
							},
				peerCaspar: {
					active: amcpFanout.active && role === 'leader',
					connected: !!runtime?.peerCasparConnection?.isConnected,
					endpoint: runtime?.peerCasparConnection?.endpoint || repl.peerCaspar || null,
				},
			}
		: null

	let companion = null
	try {
		const { buildCompanionControlStatus } = require('../api/companion-control-status')
		companion = buildCompanionControlStatus(ctx)
	} catch {
		companion = null
	}

	return {
		enabled: repl.enabled,
		configured: replicationPairConfigured(repl),
		role,
		configuredRole: repl.role,
		selfId: repl.selfId,
		pairId: repl.pairId,
		leaderEpoch: repl.leaderEpoch,
		leaderAvailable: !!repl.leaderAvailable,
		disconnectPolicy: repl.disconnectPolicy,
		syncClock: repl.syncClock,
		clockOffsetMs: runtime?.clockOffsetMs ?? 0,
		peer: repl.enabled && repl.peer?.host ? { host: repl.peer.host, port: repl.peer.port } : { host: '', port: repl.peer.port || 4200 },
		peerSelfId: repl.enabled ? peerPing?.selfId || peerPing?.hostname || null : null,
		peerHostname: repl.enabled ? peerPing?.hostname || null : null,
		peerReachable: peerHttpReachable,
		peerLinkReady,
		peerHttpReachable,
		lastPeerPingAgeMs: pingAgeMs,
		peerInstanceId: runtime?.peerInstanceId ?? null,
		peerPingError: peerHttpReachable ? null : runtime?.lastPeerPingError || null,
		peerLeaderEpoch: runtime?.peerLeaderEpoch ?? null,
		followerMode: repl.followerMode,
		autoPromote: repl.autoPromote,
		operatorWsClients: runtime?.roleState?.getOperatorWsClientCount() ?? 0,
		liveStateSeq: runtime?.liveStateSeq ?? 0,
		lastAppliedSeq: runtime?.lastAppliedSeq ?? 0,
		peerLiveStateSeq: runtime?.peerLiveStateSeq ?? 0,
		liveStateLag: liveLag,
		peerLastAppliedSeq: runtime?.peerLastAppliedSeq ?? null,
		projectsPushed: runtime?.projectsPushed ?? 0,
		timelinesPushed: runtime?.timelinesPushed ?? 0,
		initialSync: runtime?.initialSync ?? { inProgress: false, phase: 'idle', percent: 100 },
		mediaSync: media,
		casparOutput,
		scheduledApply: repl.scheduledApply,
		scheduledApplyLeadMs: repl.scheduledApplyLeadMs,
		mirrorTransport: repl.mirrorTransport,
		peerCaspar: repl.peerCaspar,
		local,
		peerBox,
		channelParity,
		connection,
		casparParity: runtime?.lastCasparParity || null,
		follower,
		amcpFanout: {
			active: amcpFanout.active,
			receiveBox: amcpFanout.receiveBox,
			connected: !!runtime?.peerCasparConnection?.isConnected,
			endpoint: runtime?.peerCasparConnection?.endpoint || repl.peerCaspar || null,
			commandsSent: runtime?.peerCasparConnection?.commandsSent ?? 0,
			correctionsSent: runtime?.peerCasparConnection?.correctionsSent ?? 0,
			queueDepth: runtime?.peerCasparConnection?.queueDepth ?? 0,
			maxQueueDepth: runtime?.peerCasparConnection?.maxQueueDepth ?? 0,
			droppedBackpressure: runtime?.peerCasparConnection?._droppedBackpressure ?? 0,
			lastError: runtime?.peerCasparConnection?.lastError || '',
			skippedNotConnected: runtime?.amcpFanoutSkippedNotConnected ?? 0,
		},
		playheadSync,
		promotedAt: runtime?.promotedAt || null,
		promoteReason: runtime?.promoteReason || null,
		companion,
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
	ws.on('close', () => {
		_runtime?.peerWsClients.delete(ws)
		if (_ctx) {
			const { notifyReplicationStatusChanged } = require('./replication-ui-notify')
			notifyReplicationStatusChanged(_ctx, 'peer-ws-inbound-closed')
		}
	})
	if (_runtime.lastLiveIntent) broadcastLiveState(_runtime, _runtime.peerWsClients)
	if (_ctx) {
		const { notifyReplicationStatusChanged } = require('./replication-ui-notify')
		notifyReplicationStatusChanged(_ctx, 'peer-ws-inbound')
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
