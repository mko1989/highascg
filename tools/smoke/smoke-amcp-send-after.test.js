'use strict'

/**
 * Live: MIXER COMMIT via _sendAfter before BEGIN…COMMIT (no deadlock).
 */
const { describe, it } = require('node:test')
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

describe('AMCP _sendAfter + batch (library transport)', () => {
	it('mixerCommit then batchSend without hanging', async (t) => {
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
			await cm.amcp.mixer.mixerCommit(1)
			const result = await cm.amcp.batchSend(['PLAY 1-10 AMB', 'PLAY 1-11 AMB'], { skipMixerPreCommit: true })
			assert.equal(result.ok, true)
			assert.equal(result.batched, true)
		} catch (e) {
			if (/connect timeout/i.test(String(e.message))) {
				t.skip(`Caspar not reachable at ${HOST}:${PORT}`)
				return
			}
			throw e
		} finally {
			cm.stop()
		}
	})

	it('batchSend with default mixer pre-commit (channel 1)', async (t) => {
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
			const result = await cm.amcp.batchSend(['PLAY 1-10 AMB', 'PLAY 1-11 AMB'])
			assert.equal(result.ok, true)
		} catch (e) {
			if (/connect timeout/i.test(String(e.message))) {
				t.skip(`Caspar not reachable at ${HOST}:${PORT}`)
				return
			}
			throw e
		} finally {
			cm.stop()
		}
	})
})
