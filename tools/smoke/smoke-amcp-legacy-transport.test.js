'use strict'

/**
 * T7.5 — Legacy AMCP transport (HIGHASCG_AMCP_LEGACY_TRANSPORT=1) live smoke.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

// Must set before ConnectionManager is loaded in this process.
process.env.HIGHASCG_AMCP_LEGACY_TRANSPORT = '1'

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

describe('AMCP legacy transport (T7.5)', () => {
	it('uses TcpClient + AmcpProtocol', () => {
		const cm = new ConnectionManager({ host: HOST, port: PORT })
		assert.equal(cm._useLegacy, true)
		assert.ok(cm.protocol)
		assert.ok(cm.tcp)
		cm.stop()
	})

	it('VERSION over legacy stack', async (t) => {
		const cm = new ConnectionManager({
			host: HOST,
			port: PORT,
			healthIntervalMs: 0,
			healthConnectDelayMs: 0,
		})
		try {
			cm.start()
			await waitConnected(cm)
			const r = await cm.amcp.version()
			assert.equal(r.ok, true)
			const line = typeof r.data === 'string' ? r.data : Array.isArray(r.data) ? r.data.join(' ') : ''
			assert.ok(line.length > 0, 'expected version text')
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

	it('BEGIN…COMMIT batch over legacy stack', async (t) => {
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
			const result = await cm.amcp.batchSend(['PLAY 1-10 AMB', 'PLAY 1-11 AMB'], {
				skipMixerPreCommit: true,
			})
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
})
