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
const { receiveTimelineFromPeer } = require('../replication/replicate-timelines')
const { promoteToLeader, generatePairingCredentials } = require('../replication/promote')
const { getMediaSyncStatus } = require('../replication/syncthing-media-status')
const pkg = require('../../package.json')

function replicationTokenOk(ctx, req, body) {
	const repl = getReplicationConfig(ctx.config)
	const hdr = req?.headers?.['x-highascg-replication-token']
	const fromHdr = Array.isArray(hdr) ? hdr[0] : hdr
	const token = String(fromHdr || body?.token || '').trim()
	return !!(repl.peer.token && token === repl.peer.token)
}

function rejectIfLeader(ctx) {
	const rt = getReplicationRuntime(ctx)
	if (rt?.roleState?.getRole() === 'leader') {
		return { status: 409, headers: JSON_HEADERS, body: jsonBody({ error: 'leader cannot accept replication push' }) }
	}
	return null
}

async function handleGet(path, ctx, req) {
	if (path === '/api/replication/ping') {
		const repl = getReplicationConfig(ctx.config)
		const rt = getReplicationRuntime(ctx)
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				selfId: repl.selfId,
				pairId: repl.pairId,
				role: rt?.roleState?.getRole() || 'standalone',
				appVersion: pkg.version,
				configHash: hashConfig(ctx.config),
				liveStateSeq: rt?.liveStateSeq ?? 0,
				leaderEpoch: repl.leaderEpoch,
			}),
		}
	}

	if (path === '/api/replication/status') {
		const status = await buildReplicationStatus(ctx)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(status) }
	}

	if (path === '/api/replication/media-status') {
		const repl = getReplicationConfig(ctx.config)
		const media = await getMediaSyncStatus(repl.syncthingMediaFolderId)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(media) }
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

	if (path === '/api/replication/pair-credentials') {
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(generatePairingCredentials()) }
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
