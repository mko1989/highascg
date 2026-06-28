'use strict'

const WebSocket = require('ws')
const { getReplicationConfig } = require('../config/replication-config')

/**
 * Follower maintains outbound WS to leader for live-state stream.
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 */
function startPeerWsClient(ctx, runtime) {
	/** @type {import('ws')|null} */
	let ws = null
	/** @type {ReturnType<typeof setTimeout>|null} */
	let reconnectTimer = null

	function stop() {
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
		if (reconnectTimer) return
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null
			connect()
		}, 3000)
		if (reconnectTimer.unref) reconnectTimer.unref()
	}

	function connect() {
		stop()
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
			try {
				const { resetMirrorApplyDedup } = require('./mirror-apply')
				resetMirrorApplyDedup()
			} catch {
				/* ignore */
			}
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

module.exports = { startPeerWsClient }
