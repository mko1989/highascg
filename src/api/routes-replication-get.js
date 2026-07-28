'use strict'

const os = require('os')
const { JSON_HEADERS, jsonBody } = require('./response')
const { getReplicationConfig, replicationPairConfigured } = require('../config/replication-config')
const {
	buildReplicationStatus,
	getReplicationRuntime,
	hashConfig,
} = require('../replication/replication-service')
const { discoverAvailableLeaders } = require('../replication/discover-leaders')
const { getReplicationMediaSyncStatus } = require('../replication/media-sync-status')
const { getLocalSyncthingDeviceId } = require('../replication/syncthing-client')
const pkg = require('../../package.json')
const { getCasparEndpointForPeer } = require('../replication/caspar-endpoint')
const { replicationTokenOk, rejectIfNotLeader, localPrimaryIp } = require('./routes-replication-shared')
const { getLeaderActiveShowPingFields } = require('../replication/active-show-revision')

async function handleGet(path, ctx, req) {
	if (path === '/api/replication/ping') {
		const repl = getReplicationConfig(ctx.config)
		const rt = getReplicationRuntime(ctx)
		const casparEp = getCasparEndpointForPeer(ctx.config)
		let syncthingDeviceId
		try {
			syncthingDeviceId = (await getLocalSyncthingDeviceId()) || ''
		} catch {
			syncthingDeviceId = ''
		}
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
		let channelMap
		try {
			const { buildChannelMapSummary } = require('../replication/channel-parity')
			channelMap = buildChannelMapSummary(ctx.config)
		} catch {
			channelMap = null
		}
		let projectMedia
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
		const role = rt?.roleState?.getRole() || 'standalone'
		let activeShowSlug = null
		let activeShowRevision = null
		let activeShowSavedAt = null
		if (role === 'leader') {
			const showFields = await getLeaderActiveShowPingFields(ctx)
			activeShowSlug = showFields.activeShowSlug
			activeShowRevision = showFields.activeShowRevision
			activeShowSavedAt = showFields.activeShowSavedAt
		} else if (rt) {
			activeShowRevision = rt.lastAppliedShowRevision || null
			activeShowSavedAt = rt.lastShowReceivedAt || null
			activeShowSlug = null
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
				role,
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
				activeShowSlug,
				activeShowRevision,
				activeShowSavedAt,
				lastShowReceivedAtMs: rt?.lastShowReceivedAtMs ?? null,
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

module.exports = {
	handleGet,
}
