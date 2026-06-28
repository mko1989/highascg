'use strict'

const crypto = require('crypto')
const os = require('os')
const { getReplicationConfig, normalizeReplicationConfig } = require('../config/replication-config')
const { getLocalSyncthingDeviceId } = require('./syncthing-client')
const { syncProjectMediaToPeer } = require('./sync-project-media')
const { reconcileFromLeader } = require('./replication-reconcile')
const { peerHttpRequest, SYNC_REQUEST_TIMEOUT_MS } = require('./peer-client')
const { loadFullProject } = require('../engine/project-scenes')
const { getCasparEndpointForPeer } = require('./caspar-endpoint')

async function disconnectToStandalone(ctx, runtime, opts = {}) {
	const repl = getReplicationConfig(ctx.config)
	const nextRepl = normalizeReplicationConfig({
		...repl,
		enabled: false,
		role: 'auto',
		peer: { host: '', port: 4200, token: '' },
	})
	if (ctx.configManager) {
		const cfg = { ...ctx.configManager.get(), replication: nextRepl }
		ctx.configManager.save(cfg)
		if (ctx.config) Object.assign(ctx.config, ctx.configManager.get())
	}
	runtime.roleState.clearForcedRole()
	runtime.roleState.configure({ enabled: false, role: 'auto' })
	runtime.peerReachable = false
	runtime.lastPeerPingAt = 0
	const { reloadReplicationFromConfig } = require('./replication-reload')
	reloadReplicationFromConfig(ctx)
	if (typeof ctx.log === 'function') ctx.log('info', `[replication] standalone (${opts.reason || 'disconnect'})`)
	const { notifyReplicationStatusChanged } = require('./replication-ui-notify')
	notifyReplicationStatusChanged(ctx, 'disconnect')
	return { ok: true, reason: opts.reason || 'disconnect' }
}

async function becomeLeaderAvailable(ctx) {
	const repl = getReplicationConfig(ctx.config)
	const selfId = repl.selfId || os.hostname()
	const nextRepl = normalizeReplicationConfig({ ...repl, selfId, leaderAvailable: true })
	if (ctx.configManager) {
		const cfg = { ...ctx.configManager.get(), replication: nextRepl }
		ctx.configManager.save(cfg)
		if (ctx.config) Object.assign(ctx.config, ctx.configManager.get())
	}
	const { reloadReplicationFromConfig } = require('./replication-reload')
	reloadReplicationFromConfig(ctx)
	return { ok: true, replication: nextRepl }
}

async function stopLeaderAvailable(ctx) {
	const repl = getReplicationConfig(ctx.config)
	const nextRepl = normalizeReplicationConfig({ ...repl, leaderAvailable: false })
	if (ctx.configManager) {
		const cfg = { ...ctx.configManager.get(), replication: nextRepl }
		ctx.configManager.save(cfg)
		if (ctx.config) Object.assign(ctx.config, ctx.configManager.get())
	}
	const { reloadReplicationFromConfig } = require('./replication-reload')
	reloadReplicationFromConfig(ctx)
	return { ok: true }
}

function localPrimaryIp() {
	for (const list of Object.values(os.networkInterfaces())) {
		if (!list) continue
		for (const iface of list) {
			if (iface && !iface.internal && iface.family === 'IPv4') return iface.address
		}
	}
	return '127.0.0.1'
}

async function connectToLeader(ctx, runtime, opts) {
	const leaderHost = String(opts.leaderHost || '').trim()
	const leaderPort = parseInt(String(opts.leaderPort ?? 4200), 10) || 4200
	if (!leaderHost) return { ok: false, error: 'leaderHost required' }

	const ping = await peerHttpRequest({ host: leaderHost, port: leaderPort, token: '' }, '/api/replication/ping')
	if (!ping.ok || !ping.json?.leaderAvailable) return { ok: false, error: 'leader not available at host' }

	const pairId = String(ping.json.pairId || '').trim() || crypto.randomUUID()
	const token = crypto.randomBytes(24).toString('hex')
	const selfId = getReplicationConfig(ctx.config).selfId || os.hostname()
	const syncthingDeviceId = (await getLocalSyncthingDeviceId()) || ''
	const followerCaspar = getCasparEndpointForPeer(ctx.config)

	// Enable replication before register so the leader can push project/timelines during pairing.
	const preRepl = normalizeReplicationConfig({
		enabled: true,
		role: 'follower',
		pairId,
		selfId,
		peer: { host: leaderHost, port: leaderPort, token },
		followerMode: 'mirror',
		autoPromote: false,
		disconnectPolicy: 'standalone',
		mirrorTransport: 'amcp-fanout',
		scheduledApply: false,
		syncClock: 'immediate',
		leaderAvailable: false,
	})
	if (ctx.configManager) {
		const cfg = { ...ctx.configManager.get(), replication: preRepl }
		ctx.configManager.save(cfg)
		if (ctx.config) Object.assign(ctx.config, ctx.configManager.get())
	}
	runtime.roleState.configure({ enabled: true, role: 'follower' })
	runtime.roleState.forceRole('follower')

	const register = await peerHttpRequest(
		{ host: leaderHost, port: leaderPort, token: '' },
		'/api/replication/register-follower',
		{
			method: 'POST',
			body: {
				pairId,
				token,
				selfId,
				followerHost: localPrimaryIp(),
				followerCasparHost: followerCaspar.host,
				followerCasparPort: followerCaspar.port,
				syncthingDeviceId,
			},
			timeoutMs: SYNC_REQUEST_TIMEOUT_MS,
		},
	)
	if (!register.ok) {
		return {
			ok: false,
			error:
				register.error === 'timeout'
					? 'Leader register timed out — check leader load and retry Connect'
					: register.error || 'register-follower failed',
			status: register.status,
		}
	}

	const leaderToken = register.json?.token || token
	const leaderSyncthingId = register.json?.syncthingDeviceId || ping.json.syncthingDeviceId || ''

	const nextRepl = normalizeReplicationConfig({
		...preRepl,
		pairId: register.json?.pairId || pairId,
		peer: { host: leaderHost, port: leaderPort, token: leaderToken },
	})

	if (ctx.configManager) {
		const cfg = { ...ctx.configManager.get(), replication: nextRepl }
		ctx.configManager.save(cfg)
		if (ctx.config) Object.assign(ctx.config, ctx.configManager.get())
	}

	if (runtime.peerClient?.start) runtime.peerClient.start()
	if (runtime.peerWsClient?.start) runtime.peerWsClient.start()

	void runFollowerPostConnectSync(ctx, runtime, leaderSyncthingId)
	const { reloadReplicationFromConfig } = require('./replication-reload')
	reloadReplicationFromConfig(ctx)

	const { notifyReplicationStatusChanged } = require('./replication-ui-notify')
	notifyReplicationStatusChanged(ctx, 'connect')

	return { ok: true, syncing: true, replication: nextRepl, leader: { host: leaderHost, port: leaderPort } }
}

async function runFollowerPostConnectSync(ctx, runtime, _leaderSyncthingId) {
	try {
		await reconcileFromLeader(ctx, runtime)
	} catch (e) {
		if (typeof ctx.log === 'function') {
			ctx.log('warn', '[replication] post-connect reconcile: ' + (e?.message || e))
		}
	}
	try {
		const { loadFullProject } = require('../engine/project-scenes')
		const project = await loadFullProject()
		await syncProjectMediaToPeer(ctx, project, { direction: 'pull' })
	} catch (e) {
		if (typeof ctx.log === 'function') ctx.log('warn', '[replication] project media rsync pull: ' + (e?.message || e))
	}
}

async function registerFollowerOnLeader(ctx, body) {
	const repl = getReplicationConfig(ctx.config)
	if (!repl.leaderAvailable) return { ok: false, error: 'leader not available' }

	const pairId = String(body.pairId || repl.pairId || '').trim() || crypto.randomUUID()
	const token = String(body.token || repl.peer.token || '').trim() || crypto.randomBytes(24).toString('hex')
	const followerHost = String(body.followerHost || body.peerHost || '').trim()
	const followerSyncthingId = String(body.syncthingDeviceId || '').trim()
	if (!followerHost) return { ok: false, error: 'followerHost required' }

	const followerCasparHost = String(body.followerCasparHost || body.peerCasparHost || followerHost).trim()
	const followerCasparPort =
		Math.max(1, parseInt(String(body.followerCasparPort ?? body.peerCasparPort ?? 5250), 10) || 5250)

	const followerSelfId = String(body.selfId || '').trim()
	const nextRepl = normalizeReplicationConfig({
		...repl,
		enabled: true,
		role: 'leader',
		leaderAvailable: true,
		pairId,
		peer: { host: followerHost, port: body.followerPort || 4200, token },
		peerCaspar: { host: followerCasparHost, port: followerCasparPort, connectTimeoutMs: 5000 },
		mirrorTransport: 'amcp-fanout',
		autoPromote: false,
		disconnectPolicy: 'standalone',
		scheduledApply: false,
		syncClock: 'immediate',
	})

	if (ctx.configManager) {
		const cfg = { ...ctx.configManager.get(), replication: nextRepl }
		ctx.configManager.save(cfg)
		if (ctx.config) Object.assign(ctx.config, ctx.configManager.get())
	}

	const leaderSyncthingId = (await getLocalSyncthingDeviceId()) || ''
	const response = {
		ok: true,
		pairId,
		token,
		syncthingDeviceId: leaderSyncthingId,
		follower: { host: followerHost, selfId: followerSelfId },
	}

	const runtime = ctx._replication
	if (runtime) {
		runtime.roleState.configure({ enabled: true, role: 'leader' })
		runtime.roleState.forceRole('leader')
		runtime.peerReachable = false
		if (runtime.peerClient?.start) runtime.peerClient.start()
		if (runtime.peerWsClient?.start) runtime.peerWsClient.start()
	}
	const { reloadReplicationFromConfig } = require('./replication-reload')
	reloadReplicationFromConfig(ctx)

	if (typeof ctx.log === 'function') {
		ctx.log('info', `[replication] follower registered: ${followerSelfId || followerHost}`)
	}

	void runLeaderPostRegisterSync(ctx, runtime, followerSyncthingId)

	const { notifyReplicationStatusChanged } = require('./replication-ui-notify')
	notifyReplicationStatusChanged(ctx, 'follower-registered')

	return response
}

async function runLeaderPostRegisterSync(ctx, runtime, _followerSyncthingId) {
	if (!runtime) return
	try {
		const { reconcileAllToPeer } = require('./replication-reconcile')
		await reconcileAllToPeer(ctx, runtime)
	} catch (e) {
		if (typeof ctx.log === 'function') {
			ctx.log('warn', '[replication] leader post-register reconcile: ' + (e?.message || e))
		}
	}
	try {
		const { loadFullProject } = require('../engine/project-scenes')
		const project = await loadFullProject()
		await syncProjectMediaToPeer(ctx, project, { direction: 'push' })
	} catch (e) {
		if (typeof ctx.log === 'function') {
			ctx.log('warn', '[replication] leader project media rsync push: ' + (e?.message || e))
		}
	}
	try {
		const { validateCasparParityForPair } = require('./caspar-parity')
		const parity = await validateCasparParityForPair(ctx)
		runtime.lastCasparParity = parity
		if (!parity.ok && typeof ctx.log === 'function') {
			const note = parity.followerNeedsMoreChannels
				? `backup needs ${parity.missingCount} more Caspar channel(s)`
				: parity.mismatches?.[0]?.message || 'Caspar config mismatch'
			ctx.log('warn', `[replication] Caspar parity on pair: ${note}`)
		}
	} catch (e) {
		if (typeof ctx.log === 'function') {
			ctx.log('warn', '[replication] leader caspar parity: ' + (e?.message || e))
		}
	}
}

module.exports = {
	disconnectToStandalone,
	becomeLeaderAvailable,
	stopLeaderAvailable,
	connectToLeader,
	registerFollowerOnLeader,
}
