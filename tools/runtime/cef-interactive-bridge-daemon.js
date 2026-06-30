#!/usr/bin/env node
'use strict'

/**
 * Standalone CEF interactive bridge (for testing before HighAsCG restart).
 * Exits when stdin closes or SIGTERM. Prefer syncCefInteractiveBridge in index.js in production.
 */

const path = require('path')
const { ConfigManager } = require('../../src/config/config-manager')
const { ConnectionManager } = require('../../src/caspar/connection-manager')
const { startCefInteractiveBridge, stopCefInteractiveBridge } = require('../../src/system/cef-interactive-bridge')
const { REPO_ROOT } = require('../../src/repo-paths')

function log(level, msg) {
	process.stderr.write(`[cef-bridge-daemon] ${level}: ${msg}\n`)
}

async function main() {
	const configDir = process.env.HIGHASCG_CONFIG_PATH || path.join(REPO_ROOT, 'config')
	const cm = new ConfigManager(configDir, { info() {}, warn() {}, error() {} })
	cm.load()
	const config = cm.get()

	const caspar = await new Promise((resolve, reject) => {
		const conn = new ConnectionManager({
			host: process.env.HIGHASCG_CASPAR_HOST || '127.0.0.1',
			port: parseInt(process.env.HIGHASCG_CASPAR_PORT || '5250', 10),
			config: {},
			log() {},
			healthIntervalMs: 0,
			healthConnectDelayMs: 0,
		})
		const to = setTimeout(() => {
			conn.stop()
			reject(new Error('AMCP connect timeout'))
		}, 15_000)
		conn.on('status', (p) => {
			if (p.connected) {
				clearTimeout(to)
				resolve(conn)
			}
		})
		conn.on('error', (e) => {
			clearTimeout(to)
			reject(e)
		})
		conn.start()
	})

	const result = await startCefInteractiveBridge(config, { log, amcp: caspar.amcp })
	if (!result.ok) {
		log('error', `bridge failed: ${result.reason || 'unknown'}`)
		caspar.stop()
		process.exit(1)
	}
	log('info', `running (${result.zones ?? 0} zone(s)); send SIGTERM to stop`)

	const shutdown = () => {
		stopCefInteractiveBridge()
		caspar.stop()
		process.exit(0)
	}
	process.on('SIGINT', shutdown)
	process.on('SIGTERM', shutdown)
}

main().catch((e) => {
	log('error', e?.message || String(e))
	process.exit(1)
})
