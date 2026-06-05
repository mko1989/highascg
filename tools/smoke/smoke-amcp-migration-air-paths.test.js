'use strict'

/**
 * Automatable subset of T7.4 (air-critical AMCP paths) — no visual PGM check.
 * Skips when Caspar is not reachable.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { ConnectionManager } = require('../../src/caspar/connection-manager')

const HOST = process.env.HIGHASCG_CASPAR_HOST || process.env.CASPAR_HOST || '127.0.0.1'
const PORT = parseInt(process.env.HIGHASCG_CASPAR_PORT || process.env.CASPAR_PORT || '5250', 10)

async function withCaspar(fn) {
	const cm = new ConnectionManager({
		host: HOST,
		port: PORT,
		config: { amcp_batch: true },
		healthIntervalMs: 0,
		healthConnectDelayMs: 0,
		log: () => {},
	})
	cm.start()
	const deadline = Date.now() + 8000
	while (Date.now() < deadline) {
		if (cm.amcp.isConnected) {
			try {
				return await fn(cm)
			} finally {
				cm.stop()
			}
		}
		await new Promise((r) => setTimeout(r, 25))
	}
	cm.stop()
	throw new Error('connect timeout')
}

describe('AMCP migration air-path proxies (T7.4 automated)', () => {
	it('batchSendChunked completes with COMMIT ack', async (t) => {
		try {
			await withCaspar(async (cm) => {
				const lines = Array.from({ length: 6 }, (_, i) => `CLEAR 1-${10 + i}`)
				const result = await cm.amcp.batchSendChunked(lines, { skipMixerPreCommit: true })
				assert.equal(result.ok, true)
				assert.equal(result.batched, true)
				assert.ok(result.rawLines?.some((l) => /2\d{2}\s+COMMIT/i.test(l)))
			})
		} catch (e) {
			if (/connect timeout/i.test(String(e.message))) t.skip(`Caspar not at ${HOST}:${PORT}`)
			else throw e
		}
	})

	it('MIXER DEFER in batch then COMMIT via pre-commit path', async (t) => {
		try {
			await withCaspar(async (cm) => {
				const lines = [
					'MIXER 1-10 OPACITY 0.5 25 linear DEFER',
					'MIXER 1-11 OPACITY 0.5 25 linear DEFER',
				]
				const result = await cm.amcp.batchSend(lines)
				assert.equal(result.ok, true)
				assert.equal(result.batched, true)
			})
		} catch (e) {
			if (/connect timeout/i.test(String(e.message))) t.skip(`Caspar not at ${HOST}:${PORT}`)
			else throw e
		}
	})

	it('reconnect after stop/start still answers VERSION', async (t) => {
		try {
			const cm = new ConnectionManager({
				host: HOST,
				port: PORT,
				healthIntervalMs: 0,
				healthConnectDelayMs: 0,
				log: () => {},
			})
			cm.start()
			const deadline = Date.now() + 8000
			while (!cm.amcp.isConnected && Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, 25))
			}
			if (!cm.amcp.isConnected) {
				cm.stop()
				t.skip(`Caspar not at ${HOST}:${PORT}`)
				return
			}
			cm.stop()
			cm.start()
			const deadline2 = Date.now() + 8000
			while (!cm.amcp.isConnected && Date.now() < deadline2) {
				await new Promise((r) => setTimeout(r, 25))
			}
			assert.ok(cm.amcp.isConnected)
			const r = await cm.amcp.version()
			assert.equal(r.ok, true)
			assert.ok(String(r.data || '').length > 0)
			cm.stop()
		} catch (e) {
			if (/connect timeout/i.test(String(e.message))) t.skip(`Caspar not at ${HOST}:${PORT}`)
			else throw e
		}
	})
})
