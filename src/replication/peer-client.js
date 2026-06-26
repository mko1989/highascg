'use strict'

const http = require('http')
const { getReplicationConfig } = require('../config/replication-config')

const PING_MS = Math.max(500, parseInt(process.env.HIGHASCG_REPL_PING_MS || '2000', 10) || 2000)
const FAILOVER_MS = Math.max(1000, parseInt(process.env.HIGHASCG_REPL_FAILOVER_MS || '5000', 10) || 5000)
const REQUEST_TIMEOUT_MS = Math.max(1000, parseInt(process.env.HIGHASCG_REPL_HTTP_TIMEOUT_MS || '4000', 10) || 4000)

/**
 * @param {import('../config/replication-config').ReplicationPeer} peer
 * @param {string} path
 * @param {object} [opts]
 * @param {'GET'|'POST'} [opts.method]
 * @param {object} [opts.body]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{ ok: boolean, status: number, json: object|null, error?: string }>}
 */
function peerHttpRequest(peer, path, opts = {}) {
	const method = opts.method || 'GET'
	const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS
	return new Promise((resolve) => {
		if (!peer?.host) {
			resolve({ ok: false, status: 0, json: null, error: 'peer host not configured' })
			return
		}
		const bodyStr = opts.body != null ? JSON.stringify(opts.body) : ''
		const req = http.request(
			{
				host: peer.host,
				port: peer.port || 4200,
				path,
				method,
				timeout: timeoutMs,
				headers: {
					Accept: 'application/json',
					'X-HighAsCG-Replication-Token': peer.token || '',
					...(bodyStr
						? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
						: {}),
				},
			},
			(res) => {
				let data = ''
				res.on('data', (c) => {
					data += c
				})
				res.on('end', () => {
					let json = null
					try {
						json = data ? JSON.parse(data) : null
					} catch {
						json = null
					}
					const ok = res.statusCode != null && res.statusCode >= 200 && res.statusCode < 300
					resolve({ ok, status: res.statusCode || 0, json })
				})
			},
		)
		req.on('timeout', () => {
			req.destroy()
			resolve({ ok: false, status: 0, json: null, error: 'timeout' })
		})
		req.on('error', (e) => {
			resolve({ ok: false, status: 0, json: null, error: e?.message || String(e) })
		})
		if (bodyStr) req.write(bodyStr)
		req.end()
	})
}

/**
 * @param {import('../config/replication-config').ReplicationPeer} peer
 */
async function peerPing(peer) {
	return peerHttpRequest(peer, '/api/replication/ping')
}

/**
 * @param {import('../config/replication-config').ReplicationPeer} peer
 * @param {string} path
 * @param {object} body
 */
async function peerPost(peer, path, body) {
	return peerHttpRequest(peer, path, { method: 'POST', body })
}

/**
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 */
function startPeerClient(ctx, runtime) {
	/** @type {ReturnType<typeof setInterval>|null} */
	let timer = null

	async function tick() {
		const repl = getReplicationConfig(ctx.config)
		if (!repl.enabled || !repl.peer.host) return

		const res = await peerPing(repl.peer)
		const now = Date.now()
		if (res.ok && res.json) {
			runtime.lastPeerPingAt = now
			runtime.lastPeerPing = res.json
			runtime.peerReachable = true
			if (runtime.roleState.getRole() === 'follower' && res.json.leaderEpoch > repl.leaderEpoch) {
				runtime.peerLeaderEpoch = res.json.leaderEpoch
			}
		} else {
			runtime.peerReachable = false
			const age = runtime.lastPeerPingAt ? now - runtime.lastPeerPingAt : Infinity
			if (
				runtime.roleState.getRole() === 'follower' &&
				repl.autoPromote &&
				age > FAILOVER_MS &&
				runtime.lastPeerPingAt > 0
			) {
				const { promoteToLeader } = require('./promote')
				await promoteToLeader(ctx, runtime, { reason: 'peer_timeout' })
			}
		}
	}

	function start() {
		stop()
		timer = setInterval(() => {
			void tick().catch((e) => {
				if (typeof ctx.log === 'function') ctx.log('warn', '[replication] peer tick: ' + (e?.message || e))
			})
		}, PING_MS)
		if (timer.unref) timer.unref()
		void tick()
	}

	function stop() {
		if (timer) {
			clearInterval(timer)
			timer = null
		}
	}

	return { start, stop, peerHttpRequest, peerPost, peerPing, PING_MS, FAILOVER_MS }
}

module.exports = { startPeerClient, peerHttpRequest, peerPost, peerPing, PING_MS, FAILOVER_MS }
