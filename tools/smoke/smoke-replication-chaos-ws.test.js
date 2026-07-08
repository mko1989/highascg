'use strict'

/**
 * WO-147 T147.2 — chaos smoke for the follower peer WS client.
 *
 * Spins up a local mock leader WS endpoint, connects the real peer-ws-client,
 * then kills/restarts the server mid-traffic ×10 and asserts:
 *  - clean recovery every iteration (reconnect + fresh live_state applied)
 *  - no stuck state (attempt counter resets on each successful open)
 *  - bounded reconnect backoff during an extended outage
 *  - no duplicate replay: stale seq (≤ lastAppliedSeq) is skipped after reconnect
 *  - stop() really stops (no zombie reconnect loop)
 *
 * No live Caspar, no real peers — everything binds to 127.0.0.1 only.
 */

process.env.HIGHASCG_REPL_WS_BACKOFF_BASE_MS = '40'
process.env.HIGHASCG_REPL_WS_BACKOFF_MAX_MS = '300'

const test = require('node:test')
const assert = require('node:assert/strict')
const WebSocket = require('ws')
const { startPeerWsClient, BACKOFF_BASE_MS, BACKOFF_MAX_MS } = require('../../src/replication/peer-ws-client')
const { computeBackoffMs } = require('../../src/replication/reconnect-backoff')
const { RoleState } = require('../../src/replication/role-state')

const CHAOS_ITERATIONS = 10

function waitFor(fn, timeoutMs = 4000, label = 'condition') {
	return new Promise((resolve, reject) => {
		const start = Date.now()
		const t = setInterval(() => {
			if (fn()) {
				clearInterval(t)
				resolve(undefined)
			} else if (Date.now() - start > timeoutMs) {
				clearInterval(t)
				reject(new Error(`timeout waiting for ${label}`))
			}
		}, 10)
	})
}

function makeMockLeader(port) {
	const server = new WebSocket.Server({ host: '127.0.0.1', port })
	const state = { server, sockets: new Set(), connections: 0 }
	server.on('connection', (sock) => {
		state.connections += 1
		state.sockets.add(sock)
		sock.on('close', () => state.sockets.delete(sock))
	})
	return new Promise((resolve, reject) => {
		server.on('error', reject)
		server.on('listening', () => resolve(state))
	})
}

function killLeader(state) {
	for (const sock of state.sockets) {
		try {
			sock.terminate()
		} catch {
			/* ignore */
		}
	}
	state.sockets.clear()
	return new Promise((resolve) => state.server.close(() => resolve(undefined)))
}

function sendLiveState(state, seq) {
	for (const sock of state.sockets) {
		sock.send(JSON.stringify({ type: 'live_state', data: { seq, at: Date.now(), intent: { channels: {} } } }))
	}
}

function makeFollowerCtx(port) {
	const roleState = new RoleState()
	roleState.configure({ enabled: true, role: 'follower' })
	const runtime = {
		roleState,
		peerWsConnected: false,
		lastAppliedSeq: 0,
		lastPeerLiveSeq: 0,
		lastLiveIntent: null,
	}
	const ctx = {
		config: {
			replication: {
				enabled: true,
				role: 'follower',
				pairId: 'chaos-pair',
				selfId: 'chaos-follower',
				peer: { host: '127.0.0.1', port, token: 'chaos-token' },
				followerMode: 'mirror',
				// amcp-fanout transport → live_state apply is skipped (no engine/AMCP in test)
				mirrorTransport: 'amcp-fanout',
			},
		},
		log: () => {},
	}
	ctx._replication = runtime
	return { ctx, runtime }
}

test('chaos: kill/restart mock leader WS ×10 — clean recovery, bounded attempts, traffic resumes', async () => {
	let leader = await makeMockLeader(0)
	const port = leader.server.address().port
	const { ctx, runtime } = makeFollowerCtx(port)
	const client = startPeerWsClient(ctx, runtime)

	try {
		await waitFor(() => runtime.peerWsConnected, 4000, 'initial ws connect')
		let seq = 1
		sendLiveState(leader, seq)
		await waitFor(() => runtime.lastPeerLiveSeq === seq, 2000, `live_state seq=${seq}`)

		for (let i = 1; i <= CHAOS_ITERATIONS; i++) {
			await killLeader(leader)
			await waitFor(() => !runtime.peerWsConnected, 2000, `iteration ${i} disconnect`)

			leader = await makeMockLeader(port)
			await waitFor(() => runtime.peerWsConnected && leader.sockets.size > 0, 5000, `iteration ${i} reconnect`)

			// Clean recovery — attempt counter reset, backoff stayed bounded.
			assert.equal(runtime.peerWsReconnectAttempts, 0, `iteration ${i}: attempts reset after reconnect`)
			assert.ok(
				runtime.peerWsLastBackoffMs === 0 || runtime.peerWsLastBackoffMs <= BACKOFF_MAX_MS * 1.25,
				`iteration ${i}: backoff bounded (${runtime.peerWsLastBackoffMs}ms)`,
			)

			// Traffic resumes with a fresh seq every iteration.
			seq += 1
			sendLiveState(leader, seq)
			await waitFor(() => runtime.lastPeerLiveSeq === seq, 2000, `iteration ${i} live_state seq=${seq}`)
		}

		assert.equal(runtime.peerWsReconnects, CHAOS_ITERATIONS, 'one clean reconnect per chaos iteration')
		assert.equal(runtime.lastPeerLiveSeq, CHAOS_ITERATIONS + 1, 'no stuck state — every post-restart message applied')
	} finally {
		client.stop()
		await killLeader(leader)
	}
})

test('chaos: extended outage — attempts grow, backoff caps, then single clean recovery', async () => {
	let leader = await makeMockLeader(0)
	const port = leader.server.address().port
	const { ctx, runtime } = makeFollowerCtx(port)
	const client = startPeerWsClient(ctx, runtime)

	try {
		await waitFor(() => runtime.peerWsConnected, 4000, 'initial ws connect')
		await killLeader(leader)

		// Leave the leader down long enough for several backoff cycles.
		await waitFor(() => runtime.peerWsReconnectAttempts >= 3, 5000, 'multiple reconnect attempts')
		assert.ok(runtime.peerWsLastBackoffMs >= 1, 'backoff engaged')
		assert.ok(
			runtime.peerWsLastBackoffMs <= BACKOFF_MAX_MS * 1.25,
			`backoff bounded during outage (${runtime.peerWsLastBackoffMs}ms ≤ ${BACKOFF_MAX_MS}×1.25)`,
		)

		leader = await makeMockLeader(port)
		await waitFor(() => runtime.peerWsConnected, 5000, 'recovery after extended outage')
		assert.equal(runtime.peerWsReconnectAttempts, 0, 'attempt counter reset after recovery')
		assert.equal(runtime.peerWsLastBackoffMs, 0, 'backoff reset after recovery')
	} finally {
		client.stop()
		await killLeader(leader)
	}
})

test('no duplicate command replay: stale live_state seq is skipped after reconnect', async () => {
	const { handlePeerWsMessage } = require('../../src/replication/replication-service')
	const { ctx, runtime } = makeFollowerCtx(9)

	runtime.lastAppliedSeq = 7
	const stale = await handlePeerWsMessage(ctx, {
		type: 'live_state',
		data: { seq: 7, intent: { channels: {} } },
	})
	assert.equal(stale, 'stale_seq', 'seq ≤ lastAppliedSeq is not re-applied')

	const older = await handlePeerWsMessage(ctx, {
		type: 'live_state',
		data: { seq: 3, intent: { channels: {} } },
	})
	assert.equal(older, 'stale_seq', 'older snapshot replay is not re-applied')

	const fresh = await handlePeerWsMessage(ctx, {
		type: 'live_state',
		data: { seq: 8, intent: { channels: {} } },
	})
	assert.equal(fresh, 'amcp_fanout_skip', 'newer seq passes the guard (skipped only by fan-out transport here)')
	assert.equal(runtime.lastPeerLiveSeq, 8, 'seq telemetry still tracked for stale + fresh messages')
})

test('stop() halts the reconnect loop — no zombie reconnects', async () => {
	let leader = await makeMockLeader(0)
	const port = leader.server.address().port
	const { ctx, runtime } = makeFollowerCtx(port)
	const client = startPeerWsClient(ctx, runtime)

	await waitFor(() => runtime.peerWsConnected, 4000, 'initial ws connect')
	await killLeader(leader)
	client.stop()

	leader = await makeMockLeader(port)
	await new Promise((r) => setTimeout(r, Math.min(1000, BACKOFF_MAX_MS * 2)))
	assert.equal(leader.connections, 0, 'stopped client never reconnected')
	assert.equal(runtime.peerWsConnected, false)
	await killLeader(leader)
})

test('computeBackoffMs: exponential, jittered, bounded', () => {
	const fixed = () => 0.5 // jitter midpoint → deterministic raw value
	assert.equal(computeBackoffMs(1, { baseMs: 100, maxMs: 3000, random: fixed }), 100)
	assert.equal(computeBackoffMs(2, { baseMs: 100, maxMs: 3000, random: fixed }), 200)
	assert.equal(computeBackoffMs(5, { baseMs: 100, maxMs: 3000, random: fixed }), 1600)
	assert.equal(computeBackoffMs(10, { baseMs: 100, maxMs: 3000, random: fixed }), 3000, 'capped at maxMs')
	assert.equal(computeBackoffMs(1000, { baseMs: 100, maxMs: 3000, random: fixed }), 3000, 'huge attempt count stays capped')

	const low = computeBackoffMs(10, { baseMs: 100, maxMs: 3000, random: () => 0 })
	const high = computeBackoffMs(10, { baseMs: 100, maxMs: 3000, random: () => 0.999999 })
	assert.ok(low >= 3000 * 0.75 - 1, `jitter lower bound (${low})`)
	assert.ok(high <= 3000 * 1.25 + 1, `jitter upper bound (${high})`)
	assert.ok(computeBackoffMs(1, { baseMs: 1, maxMs: 1, random: () => 0 }) >= 1, 'never below 1ms')

	// module-under-test picked up the chaos env overrides
	assert.equal(BACKOFF_BASE_MS, 40)
	assert.equal(BACKOFF_MAX_MS, 300)
})
