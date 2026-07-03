'use strict'

const crypto = require('crypto')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getReplicationConfig, normalizeReplicationConfig, replicationPairConfigured } = require('../config/replication-config')
const {
	buildReplicationStatus,
	getReplicationRuntime,
	hashConfig,
} = require('../replication/replication-service')
const { receiveProjectFromPeer } = require('../replication/replicate-projects')
const { receiveProjectTombstoneFromPeer } = require('../replication/project-tombstone')
const { receiveTimelineFromPeer } = require('../replication/replicate-timelines')
const { promoteToLeader, generatePairingCredentials, leaderYield } = require('../replication/promote')
const { getReplicationMediaSyncStatus } = require('../replication/media-sync-status')
const { discoverAvailableLeaders } = require('../replication/discover-leaders')
const {
	becomeLeaderAvailable,
	stopLeaderAvailable,
	connectToLeader,
	disconnectToStandalone,
	registerFollowerOnLeader,
} = require('../replication/connect-pair')
const { getLocalSyncthingDeviceId } = require('../replication/syncthing-client')
const os = require('os')
const pkg = require('../../package.json')
const { getCasparEndpointForPeer } = require('../replication/caspar-endpoint')

function replicationTokenOk(ctx, req, body) {
	const repl = getReplicationConfig(ctx.config)
	const hdr = req?.headers?.['x-highascg-replication-token']
	const fromHdr = Array.isArray(hdr) ? hdr[0] : hdr
	const token = String(fromHdr || body?.token || '').trim()
	return !!(repl.peer.token && token === repl.peer.token)
}

function replicationPeerAuthOk(ctx, req, body, opts = {}) {
	if (replicationTokenOk(ctx, req, body)) return { ok: true, method: 'token' }
	const { verifyReplicationRepairRequest } = require('../replication/replication-handshake')
	const repair = verifyReplicationRepairRequest(ctx, body, req, opts)
	if (repair.ok) return repair
	return { ok: false, error: repair.error || 'unauthorized' }
}

function rejectIfLeader(ctx) {
	const rt = getReplicationRuntime(ctx)
	if (rt?.roleState?.getRole() === 'leader') {
		return { status: 409, headers: JSON_HEADERS, body: jsonBody({ error: 'leader cannot accept replication push' }) }
	}
	return null
}

function rejectIfNotLeader(ctx) {
	const rt = getReplicationRuntime(ctx)
	if (rt?.roleState?.getRole() !== 'leader') {
		return { status: 409, headers: JSON_HEADERS, body: jsonBody({ error: 'leader export only' }) }
	}
	return null
}

function localPrimaryIp() {
	for (const list of Object.values(os.networkInterfaces())) {
		if (!list) continue
		for (const iface of list) {
			if (iface && !iface.internal && iface.family === 'IPv4') return iface.address
		}
	}
	return ''
}

async function handleGet(path, ctx, req) {
	if (path === '/api/replication/ping') {
		const repl = getReplicationConfig(ctx.config)
		const rt = getReplicationRuntime(ctx)
		const casparEp = getCasparEndpointForPeer(ctx.config)
		let syncthingDeviceId = ''
		try {
			syncthingDeviceId = (await getLocalSyncthingDeviceId()) || ''
		} catch {
			syncthingDeviceId = ''
		}
		/** @type {Record<string, string>} */
		let programFramerates = {}
		try {
			const { exportProgramPlayheads } = require('../replication/playhead-export')
			const playheads = await exportProgramPlayheads(ctx)
			for (const [chKey, ch] of Object.entries(playheads.channels || {})) {
				if (ch?.framerate) programFramerates[chKey] = String(ch.framerate)
			}
		} catch {
			programFramerates = {}
		}
		let channelMap = null
		try {
			const { buildChannelMapSummary } = require('../replication/channel-parity')
			channelMap = buildChannelMapSummary(ctx.config)
		} catch {
			channelMap = null
		}
		let projectMedia = null
		try {
			const { getProjectMediaPingSummary } = require('../replication/project-media-parity')
			projectMedia = await getProjectMediaPingSummary(ctx)
		} catch {
			projectMedia = null
		}
		let pingIdentity = { appId: 'highascg', hardwareId: null, hostname: os.hostname() }
		try {
			const { getHardwareIdentityPingFields } = require('../system/hardware-identity')
			pingIdentity = getHardwareIdentityPingFields()
		} catch {
			/* optional */
		}
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				selfId: repl.selfId,
				pairId: repl.pairId,
				hostname: pingIdentity.hostname,
				hardwareId: pingIdentity.hardwareId,
				appId: pingIdentity.appId,
				role: rt?.roleState?.getRole() || 'standalone',
				leaderAvailable: !!repl.leaderAvailable,
				appVersion: pkg.version,
				configHash: hashConfig(ctx.config),
				liveStateSeq: rt?.liveStateSeq ?? 0,
				lastAppliedSeq: rt?.lastAppliedSeq ?? 0,
				leaderEpoch: repl.leaderEpoch,
				serverTimeMs: Date.now(),
				syncthingDeviceId,
				casparHost: casparEp.host,
				casparPort: casparEp.port,
				mirrorTransport: repl.mirrorTransport,
				programFramerates,
				channelMap,
				instanceId: rt?.instanceId || null,
				projectMedia,
			}),
		}
	}

	if (path === '/api/replication/leaders') {
		const leaders = await discoverAvailableLeaders({ excludeSelf: localPrimaryIp() })
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ leaders }) }
	}

	if (path === '/api/replication/status') {
		const status = await buildReplicationStatus(ctx)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(status) }
	}

	if (path === '/api/replication/media-status') {
		const media = await getReplicationMediaSyncStatus(ctx)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(media) }
	}

	if (path === '/api/replication/project-media-manifest') {
		const repl = getReplicationConfig(ctx.config)
		if (replicationPairConfigured(repl) && !replicationTokenOk(ctx, req, {})) {
			return { status: 401, headers: JSON_HEADERS, body: jsonBody({ error: 'invalid replication token' }) }
		}
		try {
			const { getLocalProjectMediaManifest } = require('../replication/project-media-parity')
			const manifest = await getLocalProjectMediaManifest(ctx)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(manifest) }
		} catch (e) {
			return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: e?.message || String(e) }) }
		}
	}

	if (path === '/api/replication/compare-project-media') {
		try {
			const { compareProjectMediaWithPeer } = require('../replication/project-media-parity')
			const out = await compareProjectMediaWithPeer(ctx, { forcePing: true })
			return {
				status: out.ok ? 200 : 503,
				headers: JSON_HEADERS,
				body: jsonBody(out),
			}
		} catch (e) {
			return { status: 500, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: e?.message || String(e) }) }
		}
	}

	if (path === '/api/replication/export/caspar-channels') {
		if (!replicationTokenOk(ctx, req, {})) {
			return { status: 401, headers: JSON_HEADERS, body: jsonBody({ error: 'invalid replication token' }) }
		}
		try {
			const { fetchLocalCasparChannels } = require('../replication/caspar-parity')
			const out = await fetchLocalCasparChannels(ctx)
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({
					ok: out.ok,
					channelCount: out.channelCount,
					channels: out.channels,
					error: out.error || null,
				}),
			}
		} catch (e) {
			return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: e?.message || String(e) }) }
		}
	}

	if (path === '/api/replication/export/project') {
		if (!replicationTokenOk(ctx, req, {})) {
			return { status: 401, headers: JSON_HEADERS, body: jsonBody({ error: 'invalid replication token' }) }
		}
		const leaderReject = rejectIfNotLeader(ctx)
		if (leaderReject) return leaderReject
		try {
			const projectStore = require('../engine/project-store')
			const { loadFullProject } = require('../engine/project-scenes')
			const { stripDeviceLocalFromProject } = require('../config/config-classify')
			const slug = projectStore.getActiveSlug(ctx.persistence || require('../utils/persistence'))
			const project = await loadFullProject()
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({ slug, project: stripDeviceLocalFromProject(project) }),
			}
		} catch (e) {
			return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: e?.message || String(e) }) }
		}
	}

	if (path === '/api/replication/export/timelines') {
		if (!replicationTokenOk(ctx, req, {})) {
			return { status: 401, headers: JSON_HEADERS, body: jsonBody({ error: 'invalid replication token' }) }
		}
		const leaderReject = rejectIfNotLeader(ctx)
		if (leaderReject) return leaderReject
		const eng = ctx.timelineEngine
		const timelines = eng && typeof eng.getAll === 'function' ? eng.getAll() : []
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				timelines: timelines.map((tl) => ({ timelineId: tl.id, timeline: tl })),
			}),
		}
	}

	if (path === '/api/replication/export/playhead') {
		if (!replicationTokenOk(ctx, req, {})) {
			return { status: 401, headers: JSON_HEADERS, body: jsonBody({ error: 'invalid replication token' }) }
		}
		try {
			const { exportProgramPlayheads } = require('../replication/playhead-export')
			const playheads = await exportProgramPlayheads(ctx)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(playheads) }
		} catch (e) {
			return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: e?.message || String(e) }) }
		}
	}

	if (path === '/api/replication/playhead-export') {
		if (!replicationTokenOk(ctx, req, {})) {
			return { status: 401, headers: JSON_HEADERS, body: jsonBody({ error: 'invalid replication token' }) }
		}
		try {
			const { exportProgramPlayheads } = require('../replication/playhead-export')
			const playheads = await exportProgramPlayheads(ctx)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(playheads) }
		} catch (e) {
			return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: e?.message || String(e) }) }
		}
	}

	if (path === '/api/replication/export/live-state') {
		if (!replicationTokenOk(ctx, req, {})) {
			return { status: 401, headers: JSON_HEADERS, body: jsonBody({ error: 'invalid replication token' }) }
		}
		const leaderReject = rejectIfNotLeader(ctx)
		if (leaderReject) return leaderReject
	const rt = getReplicationRuntime(ctx)
	const { buildLiveStateForExport } = require('../replication/live-state-feed')
	const liveState = rt ? buildLiveStateForExport(rt, ctx) : null
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ liveState }),
		}
	}

	return null
}

async function handlePost(path, body, ctx, req) {
	let payload = {}
	try {
		payload = typeof body === 'string' && body ? parseBody(body) : body && typeof body === 'object' ? body : {}
	} catch {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid JSON' }) }
	}

	if (path === '/api/replication/become-leader') {
		const out = await becomeLeaderAvailable(ctx)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(out) }
	}

	if (path === '/api/replication/stop-leader') {
		const out = await stopLeaderAvailable(ctx)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(out) }
	}

	if (path === '/api/replication/connect') {
		const rt = getReplicationRuntime(ctx)
		if (!rt) return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'replication service not started' }) }
		const leaderHost = String(payload.leaderHost || payload.host || '').trim()
		const leaderPort = parseInt(String(payload.leaderPort ?? payload.port ?? 4200), 10) || 4200
		const out = await connectToLeader(ctx, rt, { leaderHost, leaderPort })
		return { status: out.ok ? 200 : 400, headers: JSON_HEADERS, body: jsonBody(out) }
	}

	if (path === '/api/replication/disconnect') {
		const rt = getReplicationRuntime(ctx)
		if (!rt) return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'replication service not started' }) }
		const out = await disconnectToStandalone(ctx, rt, { reason: 'manual' })
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(out) }
	}

	if (path === '/api/replication/refresh-connection') {
		const { refreshReplicationConnection } = require('../replication/replication-refresh')
		const out = await refreshReplicationConnection(ctx)
		return {
			status: out.ok ? 200 : 400,
			headers: JSON_HEADERS,
			body: jsonBody(out),
		}
	}

	if (path === '/api/replication/sync-project-media') {
		const rt = getReplicationRuntime(ctx)
		if (!rt) {
			return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'replication service not started' }) }
		}
		const { loadFullProject } = require('../engine/project-scenes')
		const { syncProjectMediaToPeer } = require('../replication/sync-project-media')
		const direction =
			payload.direction === 'pull' || payload.direction === 'push' ? payload.direction : 'auto'
		try {
			const project = await loadFullProject()
			const out = await syncProjectMediaToPeer(ctx, project, { direction })
			const status = out.ok || out.skipped ? 200 : out.authFailed ? 503 : 500
			return {
				status,
				headers: JSON_HEADERS,
				body: jsonBody(out),
			}
		} catch (e) {
			return {
				status: 500,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: false, error: e?.message || String(e) }),
			}
		}
	}

	if (path === '/api/replication/validate-caspar-parity') {
		const rt = getReplicationRuntime(ctx)
		if (!rt) {
			return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'replication service not started' }) }
		}
		const { validateCasparParityForPair } = require('../replication/caspar-parity')
		const parity = await validateCasparParityForPair(ctx)
		rt.lastCasparParity = parity
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(parity) }
	}

	if (path === '/api/replication/apply-device-view-caspar') {
		const rt = getReplicationRuntime(ctx)
		if (!rt) {
			return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'replication service not started' }) }
		}
		const { isFollowerRole } = require('../replication/follower-machine-profile')
		if (!isFollowerRole(ctx)) {
			return { status: 409, headers: JSON_HEADERS, body: jsonBody({ error: 'follower only' }) }
		}
		const { ensureFollowerCasparParity } = require('../replication/caspar-parity')
		const parity = await ensureFollowerCasparParity(ctx, rt, { forceRegenerate: true })
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: parity.ok, parity }),
		}
	}

	if (path === '/api/replication/reload-local-machine') {
		const {
			buildMachineProfileFromCtx,
			saveLocalMachineProfile,
			applyLocalMachineProfileToConfig,
			regenerateFollowerCasparFromDeviceView,
			isFollowerRole,
		} = require('../replication/follower-machine-profile')
		if (!isFollowerRole(ctx)) {
			return { status: 409, headers: JSON_HEADERS, body: jsonBody({ error: 'follower only' }) }
		}
		const snap = buildMachineProfileFromCtx(ctx)
		if (snap) saveLocalMachineProfile(snap)
		applyLocalMachineProfileToConfig(ctx, snap)
		const caspar = await regenerateFollowerCasparFromDeviceView(ctx)
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true, caspar }),
		}
	}

	if (path === '/api/replication/register-follower') {
		const out = await registerFollowerOnLeader(ctx, payload)
		const status = out.ok ? 200 : out.status || 400
		return { status, headers: JSON_HEADERS, body: jsonBody(out) }
	}

	if (path === '/api/replication/setup') {
		const pairId = String(payload.pairId || '').trim() || crypto.randomUUID()
		const token = String(payload.token || '').trim() || crypto.randomBytes(24).toString('hex')
		const selfId = String(payload.selfId || '').trim()
		const peerHost = String(payload.peerHost || payload.peer?.host || '').trim()
		const peerPort = parseInt(String(payload.peerPort ?? payload.peer?.port ?? 4200), 10) || 4200
		if (!selfId || !peerHost) {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'selfId and peerHost required' }) }
		}
		const nextRepl = normalizeReplicationConfig({
			enabled: true,
			role: payload.role || 'auto',
			pairId,
			selfId,
			peer: { host: peerHost, port: peerPort, token },
			followerMode: payload.followerMode || 'mirror',
			autoPromote: payload.autoPromote !== false,
			scheduledApply: !!payload.scheduledApply,
			leaderEpoch: payload.leaderEpoch ?? 0,
		})
		if (!ctx.configManager) {
			return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: 'configManager unavailable' }) }
		}
		const cfg = { ...ctx.configManager.get(), replication: nextRepl }
		ctx.configManager.save(cfg)
		if (ctx.config) Object.assign(ctx.config, ctx.configManager.get())
		try {
			const { exportSecretsToPrivateDir } = require('../system/private-secrets-export')
			const { hostPrivateDir } = require('../system/private-volume-sync')
			const { getMachineId } = require('../config/machine-identity')
			exportSecretsToPrivateDir(hostPrivateDir(getMachineId(ctx)), ctx)
		} catch {
			/* optional */
		}
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true, replication: nextRepl, note: 'Restart bridge or reload replication service to apply peer loop.' }),
		}
	}

	if (path === '/api/replication/promote') {
		const rt = getReplicationRuntime(ctx)
		if (!rt) return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'replication service not started' }) }
		const out = await promoteToLeader(ctx, rt, { reason: 'manual' })
		return { status: out.ok ? 200 : 400, headers: JSON_HEADERS, body: jsonBody(out) }
	}

	if (path === '/api/replication/leader-yield') {
		if (!replicationTokenOk(ctx, req, payload)) {
			return { status: 401, headers: JSON_HEADERS, body: jsonBody({ error: 'invalid replication token' }) }
		}
		const out = await leaderYield(ctx, payload)
		return { status: out.ok ? 200 : 409, headers: JSON_HEADERS, body: jsonBody(out) }
	}

	if (path === '/api/replication/pair-credentials') {
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(generatePairingCredentials()) }
	}

	if (path === '/api/replication/realign-pair-token') {
		const auth = replicationPeerAuthOk(ctx, req, payload, { expectedRole: 'follower' })
		if (!auth.ok) {
			return { status: 401, headers: JSON_HEADERS, body: jsonBody({ error: auth.error || 'unauthorized' }) }
		}
		const { handleRealignPairToken } = require('../replication/replication-pair-token')
		const out = handleRealignPairToken(ctx, payload, req)
		return { status: out.ok ? 200 : 400, headers: JSON_HEADERS, body: jsonBody(out) }
	}

	if (path === '/api/replication/apply-pair-token') {
		const auth = replicationPeerAuthOk(ctx, req, payload, { expectedRole: 'leader' })
		if (!auth.ok) {
			return { status: 401, headers: JSON_HEADERS, body: jsonBody({ error: auth.error || 'unauthorized' }) }
		}
		const { handleApplyPairToken } = require('../replication/replication-pair-token')
		const out = handleApplyPairToken(ctx, payload, req)
		return { status: out.ok ? 200 : 400, headers: JSON_HEADERS, body: jsonBody(out) }
	}

	if (path === '/api/replication/exchange-ssh') {
		const auth = replicationPeerAuthOk(ctx, req, payload)
		if (!auth.ok) {
			return { status: 401, headers: JSON_HEADERS, body: jsonBody({ error: auth.error || 'unauthorized' }) }
		}
		const { handleExchangeReplicationSsh } = require('../replication/replication-ssh-setup')
		const out = handleExchangeReplicationSsh(ctx, payload)
		return { status: out.ok ? 200 : 400, headers: JSON_HEADERS, body: jsonBody(out) }
	}

	if (path === '/api/replication/project') {
		if (!replicationTokenOk(ctx, req, payload)) {
			return { status: 401, headers: JSON_HEADERS, body: jsonBody({ error: 'invalid replication token' }) }
		}
		const leaderReject = rejectIfLeader(ctx)
		if (leaderReject) return leaderReject
		const out = await receiveProjectFromPeer(ctx, payload)
		return {
			status: out.ok ? 200 : 400,
			headers: JSON_HEADERS,
			body: jsonBody(out),
		}
	}

	if (path === '/api/replication/project-tombstone') {
		if (!replicationTokenOk(ctx, req, payload)) {
			return { status: 401, headers: JSON_HEADERS, body: jsonBody({ error: 'invalid replication token' }) }
		}
		const leaderReject = rejectIfLeader(ctx)
		if (leaderReject) return leaderReject
		const out = await receiveProjectTombstoneFromPeer(ctx, payload)
		return {
			status: out.ok ? 200 : 400,
			headers: JSON_HEADERS,
			body: jsonBody(out),
		}
	}

	if (path === '/api/replication/timelines') {
		if (!replicationTokenOk(ctx, req, payload)) {
			return { status: 401, headers: JSON_HEADERS, body: jsonBody({ error: 'invalid replication token' }) }
		}
		const leaderReject = rejectIfLeader(ctx)
		if (leaderReject) return leaderReject
		const out = await receiveTimelineFromPeer(ctx, payload)
		return {
			status: out.ok ? 200 : 400,
			headers: JSON_HEADERS,
			body: jsonBody(out),
		}
	}

	return null
}

module.exports = { handleGet, handlePost, replicationPairConfigured }
