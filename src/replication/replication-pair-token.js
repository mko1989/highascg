'use strict'

const { getReplicationConfig, normalizeReplicationConfig } = require('../config/replication-config')

/**
 * Persist updated peer.token after realign (pairing must stay enabled).
 * @param {object} ctx
 * @param {string} token
 */
function savePeerToken(ctx, token) {
	const next = String(token || '').trim()
	if (!next || !ctx?.configManager) return false
	const repl = getReplicationConfig(ctx.config)
	if (!repl.enabled) return false
	const cfg = { ...ctx.configManager.get(), replication: { ...repl, peer: { ...repl.peer, token: next } } }
	const ok = ctx.configManager.save(cfg)
	if (ok && ctx.config) Object.assign(ctx.config, ctx.configManager.get())
	return ok
}

/**
 * Leader: return the pair token for a known pairId (LAN repair when tokens desynced via exFAT, etc.).
 * @param {object} ctx
 * @param {{ pairId?: string, selfId?: string }} body
 * @param {import('http').IncomingMessage} [req]
 */
function handleRealignPairToken(ctx, body, req) {
	const repl = getReplicationConfig(ctx.config)
	if (!repl.enabled || !repl.peer?.host) {
		return { ok: false, error: 'not paired' }
	}
	const rt = require('./replication-service').getReplicationRuntime(ctx)
	if (rt?.roleState?.getRole() !== 'leader' && !repl.leaderAvailable) {
		return { ok: false, error: 'leader only' }
	}
	const pairId = String(body?.pairId || '').trim()
	if (!pairId || pairId !== repl.pairId) {
		return { ok: false, error: 'pairId mismatch' }
	}
	const token = String(repl.peer.token || '').trim()
	if (!token) return { ok: false, error: 'no pair token on leader' }

	const remoteHost = String(req?.socket?.remoteAddress || '')
		.replace(/^::ffff:/, '')
		.trim()
	const expected = String(repl.peer.host || '').trim()
	if (expected && remoteHost && remoteHost !== expected && remoteHost !== '127.0.0.1') {
		if (typeof ctx.log === 'function') {
			ctx.log(
				'debug',
				`[replication] realign-pair-token from ${remoteHost} (expected peer ${expected})`,
			)
		}
	}

	return { ok: true, pairId, token }
}

/**
 * Follower/leader: fetch correct pair token from peer and save locally.
 * @param {object} ctx
 */
async function realignPairTokenFromPeer(ctx) {
	const repl = getReplicationConfig(ctx.config)
	if (!repl.enabled || !repl.peer?.host || !repl.pairId) {
		return { ok: false, error: 'not paired' }
	}
	const { peerHttpRequest } = require('./peer-client')
	const { buildRepairHandshakeBody } = require('./replication-handshake')
	const res = await peerHttpRequest(
		{ host: repl.peer.host, port: repl.peer.port || 4200, token: '' },
		'/api/replication/realign-pair-token',
		{
			method: 'POST',
			body: {
				pairId: repl.pairId,
				selfId: repl.selfId,
				...buildRepairHandshakeBody(ctx, { pairId: repl.pairId, role: 'follower' }),
			},
			timeoutMs: 8000,
		},
	)
	if (!res.ok || !res.json?.token) {
		return { ok: false, error: res.error || res.json?.error || `HTTP ${res.status}` }
	}
	const token = String(res.json.token).trim()
	if (token === repl.peer.token) return { ok: true, updated: false, token }
	const saved = savePeerToken(ctx, token)
	if (!saved) return { ok: false, error: 'failed to save pair token' }
	if (typeof ctx.log === 'function') {
		ctx.log('info', '[replication] realigned pair token from peer (was out of sync)')
	}
	return { ok: true, updated: true, token }
}

/**
 * Leader: push authoritative pair token to follower (follower manifest returned 401).
 * @param {object} ctx
 */
async function pushPairTokenToPeer(ctx) {
	const repl = getReplicationConfig(ctx.config)
	if (!repl.enabled || !repl.peer?.host || !repl.pairId) {
		return { ok: false, error: 'not paired' }
	}
	const rt = require('./replication-service').getReplicationRuntime(ctx)
	if (rt?.roleState?.getRole() !== 'leader') {
		return { ok: false, error: 'leader only' }
	}
	const token = String(repl.peer.token || '').trim()
	if (!token) return { ok: false, error: 'no pair token on leader' }
	const { peerHttpRequest } = require('./peer-client')
	const { buildRepairHandshakeBody } = require('./replication-handshake')
	const res = await peerHttpRequest(
		{ host: repl.peer.host, port: repl.peer.port || 4200, token: '' },
		'/api/replication/apply-pair-token',
		{
			method: 'POST',
			body: {
				pairId: repl.pairId,
				token,
				...buildRepairHandshakeBody(ctx, { pairId: repl.pairId, role: 'leader' }),
			},
			timeoutMs: 8000,
		},
	)
	if (!res.ok) {
		return { ok: false, error: res.error || res.json?.error || `HTTP ${res.status}` }
	}
	if (typeof ctx.log === 'function') {
		ctx.log('info', '[replication] pushed pair token to follower (manifest auth was out of sync)')
	}
	return { ok: true, updated: !!res.json?.updated, token }
}

/**
 * Follower: accept pair token pushed by leader.
 * @param {object} ctx
 * @param {{ pairId?: string, token?: string }} body
 * @param {import('http').IncomingMessage} [req]
 */
function handleApplyPairToken(ctx, body, req) {
	const repl = getReplicationConfig(ctx.config)
	if (!repl.enabled || !repl.peer?.host) {
		return { ok: false, error: 'not paired' }
	}
	const rt = require('./replication-service').getReplicationRuntime(ctx)
	if (rt?.roleState?.getRole() !== 'follower') {
		return { ok: false, error: 'follower only' }
	}
	const pairId = String(body?.pairId || '').trim()
	if (!pairId || pairId !== repl.pairId) {
		return { ok: false, error: 'pairId mismatch' }
	}
	const token = String(body?.token || '').trim()
	if (!token) return { ok: false, error: 'token required' }
	if (token === repl.peer.token) return { ok: true, updated: false, token }
	const saved = savePeerToken(ctx, token)
	if (!saved) return { ok: false, error: 'failed to save pair token' }
	if (typeof ctx.log === 'function') {
		ctx.log('info', '[replication] applied pair token from leader')
	}
	return { ok: true, updated: true, token }
}

module.exports = {
	savePeerToken,
	handleRealignPairToken,
	handleApplyPairToken,
	realignPairTokenFromPeer,
	pushPairTokenToPeer,
}
