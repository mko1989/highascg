'use strict'

/**
 * WO-845 smoke — AMCP client defects from the 29.10 sweep (REPORT §5 "AMCP client"):
 *  - a single-command timeout reset `_amcpSendQueue`, so later commands overtook queued ones (STOP before CLEAR)
 *  - `500 FAILED` is ONE line but was parsed as two, swallowing the next command's reply
 *  - Caspar's bare `PONG` reply (no status code) never settled the PING waiter
 *  - ConnectionManager.stop() did not stop the library's auto-reconnect (and destroy() sent AMCP DISCARD)
 * Pure fake-socket / loopback-TCP harnesses: no Caspar, no live state.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')

process.env.HIGHASCG_AMCP_SEND_TIMEOUT_MS = '250'

const { AmcpClient } = require('../../src/caspar/amcp-client')
const { AmcpProtocol } = require('../../src/caspar/amcp-protocol')
const { ConnectionManager } = require('../../src/caspar/connection-manager')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function harness() {
	const sent = []
	const ctx = {
		response_callback: {},
		_pendingResponseKey: undefined,
		_amcpBatchDrain: null,
		config: {},
		log() {},
		socket: {
			isConnected: true,
			send(l) {
				sent.push(l)
			},
		},
	}
	const protocol = new AmcpProtocol({ context: ctx, log() {} })
	ctx._resetAmcpProtocol = () => protocol.reset()
	const client = new AmcpClient(ctx)
	return { ctx, protocol, client, sent }
}

test('WO-845: a single-command timeout does not reorder the send queue (STOP never overtakes an earlier CLEAR)', async () => {
	const { client, protocol, sent } = harness()
	const settle = (p) => p.catch((e) => e)
	const a = settle(client._send('MIXER 1-1 OPACITY 1'))
	const b = settle(client._send('MIXER 1-2 OPACITY 1'))
	const c = settle(client._send('CLEAR 1-3'))
	await sleep(40)
	assert.deepEqual(sent, ['MIXER 1-1 OPACITY 1'], 'only the head is on the wire')
	await sleep(300) // head times out (250 ms); next one goes out
	assert.match(String(await a), /timeout/)
	assert.equal(sent[1], 'MIXER 1-2 OPACITY 1', 'second command sent after the timeout')
	// A NEW command arrives while MIXER 1-2 still waits for its reply and CLEAR is still queued.
	const d = settle(client._send('STOP 1-9'))
	await sleep(40)
	assert.deepEqual(sent.slice(2), [], 'STOP must wait behind MIXER 1-2 and CLEAR (old code sent it here)')
	protocol.handleLine('202 MIXER OK')
	await sleep(40)
	assert.equal(sent[2], 'CLEAR 1-3')
	protocol.handleLine('202 CLEAR OK')
	await sleep(40)
	assert.equal(sent[3], 'STOP 1-9')
	protocol.handleLine('202 STOP OK')
	await Promise.all([b, c, d])
	assert.deepEqual(sent, ['MIXER 1-1 OPACITY 1', 'MIXER 1-2 OPACITY 1', 'CLEAR 1-3', 'STOP 1-9'])
})

test('WO-845: `500 FAILED` consumes exactly its own reply', async () => {
	const { client, protocol } = harness()
	const play = client._send('PLAY 1-1 "x"').then(
		() => 'ok',
		(e) => e.message,
	)
	await sleep(20)
	protocol.handleLine('500 FAILED')
	assert.match(await play, /^500 FAILED/, 'PLAY rejects with its own error line')
	const stop = client._send('STOP 1-1')
	await sleep(20)
	protocol.handleLine('202 STOP OK')
	assert.deepEqual(await stop, { ok: true, data: '202 STOP OK' }, 'the next reply belongs to the next command')
})

test('WO-845: 504 QUEUE OVERFLOW / 600 FAILED settle the waiter instead of timing out', async () => {
	const { client, protocol } = harness()
	const p = client._send('PLAY 1-1 "x"').catch((e) => e.message)
	await sleep(20)
	protocol.handleLine('504 PLAY QUEUE OVERFLOW')
	assert.match(await p, /504 PLAY QUEUE OVERFLOW/)
	const q = client._send('LOADBG 1-1 "x"').catch((e) => e.message)
	await sleep(20)
	protocol.handleLine('600 LOADBG FAILED')
	assert.match(await q, /600 LOADBG FAILED/)
})

test('WO-845: PING resolves on its real bare PONG reply', async () => {
	const { client, protocol } = harness()
	const t0 = Date.now()
	const p = client.basic.ping('abc')
	await sleep(20)
	protocol.handleLine('PONG abc')
	const r = await p
	assert.equal(r.ok, true)
	assert.equal(r.data, 'PONG abc')
	assert.ok(Date.now() - t0 < 200, 'did not wait for the timeout')
	// untokened PING
	const p2 = client.basic.ping()
	await sleep(20)
	protocol.handleLine('PONG')
	assert.equal((await p2).ok, true)
})

function dummyCaspar() {
	const state = { connections: 0, sockets: new Set(), commands: [] }
	const server = net.createServer((sock) => {
		state.connections++
		state.sockets.add(sock)
		sock.on('close', () => state.sockets.delete(sock))
		sock.on('error', () => {})
		sock.on('data', (d) => {
			for (const line of d.toString().split('\r\n').filter(Boolean)) {
				state.commands.push(line)
				// The library's typed VERSION carries a `REQ <id>` prefix and wants `RES <id>` back.
				const m = /^(?:REQ (\S+) )?VERSION/i.exec(line)
				if (m) sock.write(`${m[1] ? `RES ${m[1]} ` : ''}201 VERSION OK\r\n2.5.0\r\n`)
			}
		})
	})
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, port: server.address().port })))
}

test('WO-845: ConnectionManager.stop() cancels auto-reconnect; start() after stop reports status again', async () => {
	const { server, state, port } = await dummyCaspar()
	const m = new ConnectionManager({ host: '127.0.0.1', port, healthIntervalMs: 0, healthConnectDelayMs: 0, log() {} })
	m.on('error', () => {})
	const statuses = []
	m.on('status', (s) => statuses.push(s))
	try {
		m.start()
		await sleep(300)
		assert.equal(state.connections, 1)
		assert.equal(m.isConnected, true)

		// An in-flight command must settle on stop(), not wait out its timeout.
		const inflight = m.amcp._send('MIXER 1-1 OPACITY 1').catch((e) => e.message)
		await sleep(30)
		m.stop()
		assert.match(await inflight, /closed/i, 'waiter rejected by stop()')
		await sleep(150)
		assert.equal(state.sockets.size, 0, 'server sees the socket closed')
		const conn = m._ccg._connection
		assert.equal(conn._reconnectTimeout, undefined, 'library reconnect timer not armed after stop()')
		assert.equal(m._ccg.connected, false)

		const before = statuses.length
		m.start()
		await sleep(300)
		assert.equal(state.connections, 2)
		assert.ok(statuses.length > before, 'start() after stop() emits a status again')
		assert.equal(statuses[statuses.length - 1].connected, true)
		assert.ok(state.commands.filter((c) => /VERSION/i.test(c)).length >= 2, 'connect probe ran on the second start')
	} finally {
		m.destroy()
		server.close()
		for (const s of state.sockets) s.destroy()
	}
})

test('WO-845: destroy() closes the socket (no AMCP DISCARD), reconnect() on an unstarted manager opens nothing', async () => {
	const { server, state, port } = await dummyCaspar()
	try {
		const idle = new ConnectionManager({ host: '127.0.0.1', port: 1, healthIntervalMs: 0, log() {} })
		idle.reconnect('127.0.0.1', port)
		await sleep(150)
		assert.equal(state.connections, 0, 'reconnect() on a never-started manager must not connect')
		idle.start()
		await sleep(250)
		assert.equal(state.connections, 1, 'start() uses the reconnect() target')
		idle.destroy()
		await sleep(150)
		assert.equal(state.sockets.size, 0, 'destroy() closed the socket')
		assert.ok(!state.commands.some((c) => /DISCARD/i.test(c)), 'no AMCP DISCARD was sent')
		assert.equal(idle._ccg._connection._reconnectTimeout, undefined)
	} finally {
		server.close()
		for (const s of state.sockets) s.destroy()
	}
})
