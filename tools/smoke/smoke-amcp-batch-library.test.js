'use strict'

/**
 * Live Caspar: BEGIN…COMMIT batch through casparcg-connection transport.
 */
const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')
const { ConnectionManager } = require('../../src/caspar/connection-manager')

const HOST = process.env.HIGHASCG_CASPAR_HOST || process.env.CASPAR_HOST || '127.0.0.1'
const PORT = parseInt(process.env.HIGHASCG_CASPAR_PORT || process.env.CASPAR_PORT || '5250', 10)

async function waitConnected(cm, ms = 8000) {
	const deadline = Date.now() + ms
	while (Date.now() < deadline) {
		if (cm.amcp.isConnected) return
		await new Promise((r) => setTimeout(r, 25))
	}
	throw new Error('connect timeout')
}

describe('AMCP batch (library transport)', () => {
	it('batchSend completes with COMMIT ack (batched: true)', async (t) => {
		const cm = new ConnectionManager({
			host: HOST,
			port: PORT,
			config: { amcp_batch: true },
			healthIntervalMs: 0,
			healthConnectDelayMs: 0,
		})
		try {
			cm.start()
			await waitConnected(cm)
			// Need ≥2 lines for BEGIN…COMMIT; 404 PLAY is fine — we only assert COMMIT ack.
			const result = await cm.amcp.batchSend(['PLAY 1-10 AMB', 'PLAY 1-11 AMB'], {
				skipMixerPreCommit: true,
			})
			assert.equal(result.ok, true)
			assert.equal(result.batched, true)
			assert.ok(Array.isArray(result.rawLines))
			assert.ok(result.rawLines.some((line) => /2\d{2}\s+COMMIT/i.test(line)))
		} catch (e) {
			if (/connect timeout/i.test(String(e.message))) {
				t.skip(`Caspar not reachable at ${HOST}:${PORT} (${e.message})`)
			}
			throw e
		} finally {
			cm.stop()
		}
	})
})
