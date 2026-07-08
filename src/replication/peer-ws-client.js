'use strict'

const WebSocket = require('ws')
const { getReplicationConfig } = require('../config/replication-config')
const { computeBackoffMs } = require('./reconnect-backoff')

const BACKOFF_BASE_MS = Math.max(
	25,
	parseInt(process.env.HIGHASCG_REPL_WS_BACKOFF_BASE_MS || '1000', 10) || 1000,
)
const BACKOFF_MAX_MS = Math.max(
	BACKOFF_BASE_MS,
	parseInt(process.env.HIGHASCG_REPL_WS_BACKOFF_MAX_MS || '30000', 10) || 30000,
)

/**
 * Follower maintains outbound WS to leader for live-state stream.
 *
 * Reconnect policy (WO-147 T147.1 / WO-65 T65.C2): bounded exponential backoff with
 * jitter (base 1 s → cap 30 s), attempt counter reset on a clean open. After a drop the
 * client re-handshakes from scratch (fresh URL + token from config); duplicate replay of
 * the leader snapshot is prevented by the seq guard in `handlePeerWsMessage` — the
 * mirror-apply dedup map is intentionally NOT cleared on reconnect (it is cleared only
 * when the peer instance changes, see peer-client.js).
 *
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 */
function startPeerWsClient(ctx, runtime) {
	/** @type {import('ws')|null} */
	let ws = null
	/** @type {ReturnType<typeof setTimeout>|null} */
	let reconnectTimer = null
	let reconnectAttempts = 0
	let stopped = false

	runtime.peerWsReconnectAttempts = 0
	runtime.peerWsReconnects = runtime.peerWsReconnects || 0
	runtime.peerWsLastBackoffMs = 0

	function stop() {
		stopped = true
		runtime.peerWsConnected = false
		if (reconnectTimer) {
			clearTimeout(reconnectTimer)
			reconnectTimer = null
		}
		if (ws) {
			try {
				ws.close()
			} catch {
				/* ignore */
			}
			ws = null
		}
	}

	function scheduleReconnect() {
		if (stopped || reconnectTimer) return
		reconnectAttempts += 1
		runtime.peerWsReconnectAttempts = reconnectAttempts
		const delayMs = computeBackoffMs(reconnectAttempts, {
			baseMs: BACKOFF_BASE_MS,
			maxMs: BACKOFF_MAX_MS,
		})
		runtime.peerWsLastBackoffMs = delayMs
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null
			connect()
		}, delayMs)
		if (reconnectTimer.unref) reconnectTimer.unref()
	}

	function connect() {
		stop()
		stopped = false
		const repl = getReplicationConfig(ctx.config)
		if (!repl.enabled || !repl.peer.host || runtime.roleState.getRole() !== 'follower') return

		const url = `ws://${repl.peer.host}:${repl.peer.port || 4200}/api/replication/ws?token=${encodeURIComponent(repl.peer.token)}`
		try {
			ws = new WebSocket(url)
		} catch (e) {
			if (typeof ctx.log === 'function') ctx.log('warn', '[replication] peer ws connect: ' + (e?.message || e))
			scheduleReconnect()
			return
		}

		ws.on('open', () => {
			runtime.peerWsConnected = true
			if (reconnectAttempts > 0) runtime.peerWsReconnects = (runtime.peerWsReconnects || 0) + 1
			reconnectAttempts = 0
			runtime.peerWsReconnectAttempts = 0
			runtime.peerWsLastBackoffMs = 0
			if (typeof ctx.log === 'function') ctx.log('info', '[replication] peer live-state ws connected')
			const { notifyReplicationStatusChanged } = require('./replication-ui-notify')
			notifyReplicationStatusChanged(ctx, 'peer-ws-connected')
		})
		ws.on('message', (raw) => {
			try {
				const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)
				const msg = JSON.parse(text)
				const { handlePeerWsMessage } = require('./replication-service')
				void handlePeerWsMessage(ctx, msg)
			} catch {
				/* ignore */
			}
		})
		ws.on('close', () => {
			runtime.peerWsConnected = false
			ws = null
			const { notifyReplicationStatusChanged } = require('./replication-ui-notify')
			notifyReplicationStatusChanged(ctx, 'peer-ws-disconnected')
			scheduleReconnect()
		})
		ws.on('error', () => {
			/* close handler reconnects */
		})
	}

	runtime.roleState.on('roleChange', (role) => {
		if (role === 'follower') connect()
		else stop()
	})

	if (runtime.roleState.getRole() === 'follower') connect()

	return { stop, connect, start: connect }
}

module.exports = { startPeerWsClient, BACKOFF_BASE_MS, BACKOFF_MAX_MS }
