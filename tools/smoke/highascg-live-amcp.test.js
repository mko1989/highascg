'use strict'

/**
 * Live CasparCG AMCP over TCP (same stack as production: {@link ConnectionManager}).
 * Expects Caspar listening on HIGHASCG_CASPAR_HOST:HIGHASCG_CASPAR_PORT (defaults 127.0.0.1:5250).
 *
 * Side note: avoid `DIAG` in automated tests — in CasparCG it opens on-output diagnostics
 * and can displace the screen consumer. Stick to read-only queries (VERSION, CLS, TLS, …).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { ConnectionManager } = require('../../src/caspar/connection-manager')

const CASPAR_HOST = process.env.HIGHASCG_CASPAR_HOST || process.env.CASPAR_HOST || '127.0.0.1'
const CASPAR_PORT = Number.parseInt(process.env.HIGHASCG_CASPAR_PORT || process.env.CASPAR_PORT || '5250', 10)

/**
 * @param {number} timeoutMs
 * @returns {Promise<ConnectionManager>}
 */
function connectCaspar(timeoutMs) {
	const cm = new ConnectionManager({
		host: CASPAR_HOST,
		port: CASPAR_PORT,
		config: {},
		log() {},
		healthIntervalMs: 0,
		healthConnectDelayMs: 0,
	})

	return new Promise((resolve, reject) => {
		const to = setTimeout(() => {
			cm.stop()
			reject(
				new Error(
					`AMCP TCP connect timeout (${timeoutMs}ms) to ${CASPAR_HOST}:${CASPAR_PORT} — is casparcg listening?`,
				),
			)
		}, timeoutMs)

		/** @param {Error} e */
		const onErr = (e) => {
			clearTimeout(to)
			cm.off('status', onStatus)
			cm.off('error', onErr)
			cm.stop()
			reject(e)
		}

		/** @param {{ connected?: boolean }} p */
		const onStatus = (p) => {
			if (p.connected) {
				clearTimeout(to)
				cm.off('status', onStatus)
				cm.off('error', onErr)
				resolve(cm)
			}
		}

		cm.on('status', onStatus)
		cm.on('error', onErr)
		cm.start()
	})
}

test('live Caspar: VERSION succeeds', async () => {
	const cm = await connectCaspar(12_000)
	try {
		const r = await cm.amcp.version()
		assert.equal(r.ok, true)
		const line = Array.isArray(r.data) ? r.data.join('\n') : String(r.data || '')
		assert.match(line, /casparcg|Caspar|\d+\.\d+/i, `expected version text, got: ${line.slice(0, 200)}`)
	} finally {
		cm.stop()
	}
})

test('live Caspar: TLS returns template list payload (read-only)', async () => {
	const cm = await connectCaspar(12_000)
	try {
		const r = await cm.amcp.query.tls()
		assert.equal(r.ok, true)
		assert.ok(Array.isArray(r.data), 'TLS data should be an array of template entries')
	} finally {
		cm.stop()
	}
})

test('live Caspar: CLS returns media list payload', async () => {
	const cm = await connectCaspar(12_000)
	try {
		const r = await cm.amcp.query.cls()
		assert.equal(r.ok, true)
		assert.ok(Array.isArray(r.data), 'CLS data should be an array of entries')
	} finally {
		cm.stop()
	}
})
