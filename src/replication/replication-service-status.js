'use strict'

const os = require('os')
const { getReplicationConfig, replicationPairConfigured } = require('../config/replication-config')
const { hashConfig, getReplicationRuntime } = require('./replication-service-runtime')

function buildPeerBox(runtime, peerPing, repl) {
	if (!repl.enabled || !repl.peer?.host) return null
	const ping = peerPing || {}
	return {
		host: repl.peer.host,
		port: repl.peer.port || 4200,
		selfId: ping.selfId || null,
		hostname: ping.hostname || null,
		hardwareId: ping.hardwareId || null,
		appId: ping.appId || null,
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
		activeShowRevision: ping.activeShowRevision ?? null,
		activeShowSavedAt: ping.activeShowSavedAt ?? null,
	}
}

/**
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 * @param {ReturnType<import('../config/replication-config').getReplicationConfig>} repl
 */
function buildLocalBox(ctx, runtime, repl) {
	const { buildChannelMapSummary } = require('./channel-parity')
	let channelMap
	try {
		channelMap = buildChannelMapSummary(ctx.config)
	} catch {
		channelMap = null
	}
	let localIdentity = { hardwareId: null, appId: 'highascg', hostname: os.hostname() }
	try {
		const { getHardwareIdentityPingFields } = require('../system/hardware-identity')
		localIdentity = getHardwareIdentityPingFields()
	} catch {
		/* optional */
	}
	return {
		selfId: repl.selfId,
		hostname: localIdentity.hostname,
		hardwareId: localIdentity.hardwareId,
		appId: localIdentity.appId,
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
			const st = getPlayheadSyncStatus(runtime, ctx)
			return {
				enabled: amcpFanout.active,
				measureOnly: !st.correction?.enabled,
				...st,
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
						? {
								connected: !!runtime?.peerWsConnected,
								direction: 'outbound',
								reconnectAttempts: runtime?.peerWsReconnectAttempts ?? 0,
								reconnects: runtime?.peerWsReconnects ?? 0,
								lastBackoffMs: runtime?.peerWsLastBackoffMs ?? 0,
							}
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

	let companion
	try {
		const { buildCompanionControlStatus } = require('../api/companion-control-status')
		companion = buildCompanionControlStatus(ctx)
	} catch {
		companion = null
	}

	let projectHotBackup
	try {
		const { loadFullProject } = require('../engine/project-scenes')
		const { hotBackupPeerLabel } = require('./project-hot-backup')
		const project = loadFullProject()
		projectHotBackup = project?.hotBackup || null
		if (projectHotBackup) {
			projectHotBackup = {
				...projectHotBackup,
				peerLabel: hotBackupPeerLabel(projectHotBackup, role),
			}
		}
	} catch {
		projectHotBackup = null
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
		peerHardwareId: repl.enabled ? peerPing?.hardwareId || null : null,
		peerAppId: repl.enabled ? peerPing?.appId || null : null,
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
		showSync: await (async () => {
			let leaderRevision = peerPing?.activeShowRevision ?? null
			let leaderSavedAt = peerPing?.activeShowSavedAt ?? null
			if (role === 'leader') {
				try {
					const { getLeaderActiveShowPingFields } = require('./active-show-revision')
					const f = await getLeaderActiveShowPingFields(ctx)
					leaderRevision = f.activeShowRevision
					leaderSavedAt = f.activeShowSavedAt
				} catch {
					/* optional */
				}
			}
			return {
				leaderRevision,
				leaderSavedAt,
				appliedRevision: runtime?.lastAppliedShowRevision ?? null,
				receivedAt: runtime?.lastShowReceivedAt ?? null,
				receivedAtMs: runtime?.lastShowReceivedAtMs ?? null,
				revisionLag:
					role === 'follower' &&
					!!leaderRevision &&
					!!runtime?.lastAppliedShowRevision &&
					leaderRevision !== runtime.lastAppliedShowRevision,
			}
		})(),
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
		parityGate: runtime?.lastParityGate || null,
		follower,
		amcpFanout: {
			active: amcpFanout.active,
			receiveBox: amcpFanout.receiveBox,
			role,
			connected: !!runtime?.peerCasparConnection?.isConnected,
			endpoint: runtime?.peerCasparConnection?.endpoint || repl.peerCaspar || null,
			commandsSent: runtime?.peerCasparConnection?.commandsSent ?? 0,
			correctionsSent: runtime?.peerCasparConnection?.correctionsSent ?? 0,
			lastFanoutAt: runtime?.peerCasparConnection?.lastSendAt || 0,
			lastFanoutAgeMs: runtime?.peerCasparConnection?.lastSendAt
				? Date.now() - runtime.peerCasparConnection.lastSendAt
				: null,
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
		projectHotBackup,
	}
}

module.exports = {
	buildPeerBox,
	buildLocalBox,
	buildReplicationStatus,
}
