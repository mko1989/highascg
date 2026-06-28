'use strict'

const http = require('http')
const os = require('os')
const { getReplicationConfig } = require('../config/replication-config')
const { updateClockOffsetFromPing } = require('./sync-clock')

const PING_MS = Math.max(500, parseInt(process.env.HIGHASCG_REPL_PING_MS || '2000', 10) || 2000)
const FAILOVER_MS = Math.max(1000, parseInt(process.env.HIGHASCG_REPL_FAILOVER_MS || '5000', 10) || 5000)
const REQUEST_TIMEOUT_MS = Math.max(1000, parseInt(process.env.HIGHASCG_REPL_HTTP_TIMEOUT_MS || '4000', 10) || 4000)
const SYNC_REQUEST_TIMEOUT_MS = Math.max(
	REQUEST_TIMEOUT_MS,
	parseInt(process.env.HIGHASCG_REPL_SYNC_TIMEOUT_MS || '120000', 10) || 120_000,
)

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
 * @param {{ timeoutMs?: number }} [opts]
 */
async function peerPost(peer, path, body, opts = {}) {
	return peerHttpRequest(peer, path, { method: 'POST', body, timeoutMs: opts.timeoutMs })
}

/**
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 */
function startPeerClient(ctx, runtime) {
	/** @type {ReturnType<typeof setInterval>|null} */
	let timer = null
	let peerFailStreak = 0

	async function tick() {
		const repl = getReplicationConfig(ctx.config)
		if (!repl.enabled || !repl.peer.host) return

		const wasReachable = runtime.peerReachable
		const res = await peerPing(repl.peer)
		const now = Date.now()
		if (res.ok && res.json) {
			peerFailStreak = 0
			runtime.lastPeerPingAt = now
			runtime.lastPeerPing = res.json
			runtime.peerReachable = true
			updateClockOffsetFromPing(runtime, now, res.json)
			runtime.peerLeaderEpoch = res.json.leaderEpoch ?? runtime.peerLeaderEpoch
			if (typeof res.json.lastAppliedSeq === 'number') {
				runtime.peerLastAppliedSeq = res.json.lastAppliedSeq
			}
			const peerLiveSeq = res.json.liveStateSeq ?? 0
			runtime.peerLiveStateSeq = peerLiveSeq

			const localRole = runtime.roleState.getRole()
			const peerEpoch = res.json.leaderEpoch || 0

			if (
				localRole === 'follower' &&
				peerLiveSeq > (runtime.lastAppliedSeq || 0) &&
				!runtime._liveStateCatchUpInFlight
			) {
				const { isAmcpFanoutMirrorActive } = require('./amcp-fanout')
				if (!isAmcpFanoutMirrorActive(ctx.config)) {
					runtime._liveStateCatchUpInFlight = true
					const { catchUpLiveStateFromLeader } = require('./replication-reconcile')
					void catchUpLiveStateFromLeader(ctx, runtime)
						.catch((e) => {
							if (typeof ctx.log === 'function') {
								ctx.log('warn', '[replication] live-state catch-up: ' + (e?.message || e))
							}
						})
						.finally(() => {
							runtime._liveStateCatchUpInFlight = false
						})
				}
			}

			if (localRole === 'leader' && peerEpoch > (repl.leaderEpoch || 0)) {
				const { demoteToFollower } = require('./promote')
				await demoteToFollower(ctx, runtime, peerEpoch)
			} else if (localRole === 'follower' && !wasReachable) {
				const { reconcileFromLeader } = require('./replication-reconcile')
				await reconcileFromLeader(ctx, runtime)
			}
		} else {
			peerFailStreak += 1
			runtime.peerReachable = false
			const age = runtime.lastPeerPingAt ? now - runtime.lastPeerPingAt : Infinity
			const failTicksNeeded = Math.max(2, Math.ceil(FAILOVER_MS / PING_MS))
			if (
				age > FAILOVER_MS &&
				runtime.lastPeerPingAt > 0 &&
				repl.enabled &&
				peerFailStreak >= failTicksNeeded
			) {
				if (repl.disconnectPolicy === 'standalone' || !repl.autoPromote) {
					const { disconnectToStandalone } = require('./connect-pair')
					await disconnectToStandalone(ctx, runtime, { reason: 'peer_lost' })
					peerFailStreak = 0
				} else if (runtime.roleState.getRole() === 'follower' && repl.autoPromote) {
					const { promoteToLeader } = require('./promote')
					await promoteToLeader(ctx, runtime, { reason: 'peer_timeout' })
					peerFailStreak = 0
				}
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

	return { start, stop, peerHttpRequest, peerPost, peerPing, PING_MS, FAILOVER_MS, REQUEST_TIMEOUT_MS, SYNC_REQUEST_TIMEOUT_MS }
}

module.exports = {
	startPeerClient,
	peerHttpRequest,
	peerPost,
	peerPing,
	PING_MS,
	FAILOVER_MS,
	REQUEST_TIMEOUT_MS,
	SYNC_REQUEST_TIMEOUT_MS,
}
