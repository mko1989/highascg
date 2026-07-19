/**
 * AMCP batch-drain wedge regression (2026-07-19 incident).
 *
 * A BEGIN…COMMIT batch whose `2xx COMMIT` ack never arrives used to leave
 * `_amcpBatchDrain` installed forever: the stale drain swallowed EVERY subsequent
 * response line, so each queued single command burned its full send timeout while
 * Caspar answered instantly — operator actions executed minutes late. Two guards
 * now bound it: the drain has its own ack timeout (amcp-batch.js), and a single
 * command's timeout clears any stale drain (amcp-client-transport.js).
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')

process.env.HIGHASCG_AMCP_SEND_TIMEOUT_MS = '120'

const { runBeginCommitBatch, isBatchCommitAckLine } = require('../../src/caspar/amcp-batch')
const transport = require('../../src/caspar/amcp-client-transport')

function makeConnection() {
	const sent = []
	const logs = []
	return {
		sent,
		logs,
		_amcpSendQueue: Promise.resolve(),
		_amcpBatchDrain: null,
		response_callback: {},
		socket: {
			isConnected: true,
			send(payload) {
				sent.push(payload)
			},
		},
		log(level, msg) {
			logs.push(`${level}: ${msg}`)
		},
	}
}

test('COMMIT ack resolves the batch and clears the drain', async () => {
	const connection = makeConnection()
	const client = { _context: connection }
	const p = runBeginCommitBatch(client, ['PLAY 1-10 AMB', 'MIXER 1-10 OPACITY 1'], { skipMixerPreCommit: true })
	await new Promise((r) => setImmediate(r))
	assert.ok(connection._amcpBatchDrain, 'drain installed after send')
	connection._amcpBatchDrain.onLine('202 PLAY OK')
	connection._amcpBatchDrain.onLine('202 MIXER OK')
	connection._amcpBatchDrain.onLine('202 COMMIT OK')
	const res = await p
	assert.strictEqual(res.ok, true)
	assert.strictEqual(connection._amcpBatchDrain, null, 'drain cleared on ack')
})

test('missing COMMIT ack times out, rejects, and clears the stale drain', async () => {
	const connection = makeConnection()
	const client = { _context: connection }
	const p = runBeginCommitBatch(client, ['PLAY 1-10 AMB'], { skipMixerPreCommit: true })
	await new Promise((r) => setImmediate(r))
	assert.ok(connection._amcpBatchDrain, 'drain installed after send')
	// Per-command replies arrive but the terminal `2xx COMMIT` never does.
	connection._amcpBatchDrain.onLine('202 PLAY OK')
	await assert.rejects(p, /COMMIT ack timeout/)
	assert.strictEqual(connection._amcpBatchDrain, null, 'stale drain cleared by timeout')
	assert.ok(
		connection.logs.some((l) => l.includes('COMMIT ack timeout')),
		'timeout is logged as a warning',
	)
})

test('single-command timeout clears a stale batch drain left by someone else', async () => {
	const connection = makeConnection()
	let staleRejected = false
	connection._amcpBatchDrain = {
		lines: [],
		onLine() {},
		rejectBatch() {
			staleRejected = true
		},
	}
	// The transport is a mixin (_send calls this._sendPrepare) — inherit it.
	const fakeClient = Object.assign(Object.create(transport), { _context: connection, isOffline: false })
	const p = fakeClient._send('MIXER 1 OPACITY 0')
	await assert.rejects(p, /AMCP response timeout/)
	assert.strictEqual(connection._amcpBatchDrain, null, 'stale drain cleared on single timeout')
	assert.strictEqual(staleRejected, true, 'stale drain batch promise rejected')
})

test('isBatchCommitAckLine matches only the batch terminal ack', () => {
	assert.strictEqual(isBatchCommitAckLine('202 COMMIT OK'), true)
	assert.strictEqual(isBatchCommitAckLine('RES uid 202 COMMIT OK'), true)
	assert.strictEqual(isBatchCommitAckLine('202 MIXER OK'), false)
	assert.strictEqual(isBatchCommitAckLine('202 PLAY OK'), false)
	assert.strictEqual(isBatchCommitAckLine(''), false)
})
