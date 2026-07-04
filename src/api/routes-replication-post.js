'use strict'

const crypto = require('crypto')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { normalizeReplicationConfig } = require('../config/replication-config')
const { getReplicationRuntime } = require('../replication/replication-service')
const { receiveProjectFromPeer } = require('../replication/replicate-projects')
const { receiveProjectTombstoneFromPeer } = require('../replication/project-tombstone')
const { receiveTimelineFromPeer } = require('../replication/replicate-timelines')
const { promoteToLeader, generatePairingCredentials, leaderYield } = require('../replication/promote')
const {
	becomeLeaderAvailable,
	stopLeaderAvailable,
	connectToLeader,
	disconnectToStandalone,
	registerFollowerOnLeader,
} = require('../replication/connect-pair')
const {
	replicationTokenOk,
	replicationPeerAuthOk,
	rejectIfLeader,
} = require('./routes-replication-shared')

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

module.exports = {
	handlePost,
}
