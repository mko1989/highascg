'use strict'

/**
 * WO-422 smoke — review 03.08 engine §3: a batch whose COMMIT ack times out was replayed
 * sequentially by the batchSend fallback, double-executing every command on air (PLAYs
 * restart clips from frame 0 mid-transition). The timeout rejection now carries
 * `amcpPayloadSent: true` and the fallback refuses to resend exactly that case; pre-send
 * failures (not connected, validation) keep the sequential fallback.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

process.env.HIGHASCG_AMCP_SEND_TIMEOUT_MS = '120'

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const { runBeginCommitBatch } = require('../../src/caspar/amcp-batch')

function makeConnection() {
	const sent = []
	return {
		sent,
		_amcpSendQueue: Promise.resolve(),
		_amcpBatchDrain: null,
		response_callback: {},
		socket: {
			isConnected: true,
			send(payload) {
				sent.push(payload)
			},
		},
		log() {},
	}
}

test('WO-422: COMMIT-ack timeout rejection is flagged payload-sent', async () => {
	const connection = makeConnection()
	const client = { _context: connection }
	const p = runBeginCommitBatch(client, ['PLAY 1-10 AMB', 'PLAY 1-11 AMB'], { skipMixerPreCommit: true })
	await new Promise((r) => setImmediate(r))
	assert.equal(connection.sent.length, 1, 'payload hit the socket')
	// No ack ever arrives — the 120 ms drain timeout must reject with the marker flag.
	await assert.rejects(p, (e) => e.amcpPayloadSent === true && /ack timeout/.test(String(e.message)))
	assert.equal(connection._amcpBatchDrain, null, 'stale drain cleared')
})

test('WO-422: batchSend fallback refuses to resend a payload-sent failure (source pins)', () => {
	const src = read('src/caspar/amcp-batch.js')
	const fallback = src.slice(src.indexOf('return runBeginCommitBatch(client, clean, options).catch'))
	const block = fallback.slice(0, fallback.indexOf('sequentialRaw(clean, client)'))
	assert.match(block, /e\.amcpPayloadSent === true/, 'fallback checks the marker before any resend')
	assert.match(block, /return Promise\.reject\(e\)/, 'payload-sent failures propagate instead of replaying')
	// The flag is set exactly on the ack-timeout path.
	const timeoutBlock = src.slice(src.indexOf('AMCP batch COMMIT ack timeout ('), src.indexOf('}, batchTimeoutMs)'))
	assert.match(timeoutBlock, /err\.amcpPayloadSent = true/, 'ack-timeout error carries the marker')
})
