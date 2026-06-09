'use strict'

const { execFileSync } = require('child_process')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms))
}

/**
 * @param {object} ctx
 * @returns {boolean}
 */
function isAmcpTcpConnected(ctx) {
	const conn = ctx.casparConnection
	if (conn && typeof conn.isConnected === 'boolean') return conn.isConnected
	const sock = ctx.amcp?._context?.socket
	if (sock && typeof sock.isConnected === 'boolean') return sock.isConnected
	return !!(conn?.tcp?.isConnected)
}

/**
 * @param {object} ctx
 * @param {number} maxMs
 * @param {number} [pollMs]
 */
async function waitForAmcpTcp(ctx, maxMs, pollMs = 400) {
	const t0 = Date.now()
	while (Date.now() - t0 < maxMs) {
		if (isAmcpTcpConnected(ctx)) return true
		await sleep(pollMs)
	}
	return isAmcpTcpConnected(ctx)
}

/**
 * @param {object} ctx
 * @param {number} maxMs
 * @param {number} [pollMs]
 */
async function waitForAmcpDisconnect(ctx, maxMs, pollMs = 250) {
	if (!isAmcpTcpConnected(ctx)) return true
	const t0 = Date.now()
	while (Date.now() - t0 < maxMs) {
		if (!isAmcpTcpConnected(ctx)) return true
		await sleep(pollMs)
	}
	return !isAmcpTcpConnected(ctx)
}

function resolveCasparRoot(ctx) {
	const fromEnv = String(process.env.CASPAR_ROOT || '').trim()
	if (fromEnv) return fromEnv
	const cfgPath = String(ctx?.config?.casparServer?.configPath || '').trim()
	if (cfgPath) {
		const dir = path.dirname(cfgPath)
		if (dir.endsWith(`${path.sep}config`)) return path.dirname(dir)
	}
	return path.join(REPO_ROOT)
}

/**
 * Force-kill the main casparcg binary when AMCP RESTART does not complete teardown.
 * @param {object} ctx
 */
function killStuckCasparMainProcess(ctx) {
	const casparRoot = resolveCasparRoot(ctx)
	const script = path.join(casparRoot, 'tools/runtime/caspar-kill-main.sh')
	try {
		execFileSync('bash', [script], {
			env: { ...process.env, CASPAR_ROOT: casparRoot },
			timeout: 15_000,
			stdio: ['ignore', 'pipe', 'pipe'],
		})
		return true
	} catch {
		return false
	}
}

function resolveDisconnectWaitMs() {
	const raw = process.env.HIGHASCG_CASPAR_RESTART_DISCONNECT_WAIT_MS
	if (raw === undefined || raw === '') return 45_000
	const n = parseInt(String(raw), 10)
	return Number.isFinite(n) && n >= 0 ? Math.min(n, 180_000) : 45_000
}

function resolveReconnectWaitMs() {
	const raw = process.env.HIGHASCG_CASPAR_RESTART_RECONNECT_WAIT_MS
	if (raw === undefined || raw === '') return 120_000
	const n = parseInt(String(raw), 10)
	return Number.isFinite(n) && n >= 0 ? Math.min(n, 300_000) : 120_000
}

/**
 * Send AMCP RESTART and wait for Caspar to exit (AMCP down) then come back.
 * If teardown hangs, kill the main casparcg process so run.sh can relaunch.
 *
 * @param {object} ctx
 * @param {{ log?: Function }} [opts]
 */
async function sendRestartAndWaitForCaspar(ctx, opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	const onDisconnected = typeof opts.onDisconnected === 'function' ? opts.onDisconnected : null
	if (!ctx?.amcp?.query?.restart) {
		throw new Error('AMCP client unavailable')
	}

	const disconnectMs = resolveDisconnectWaitMs()
	const reconnectMs = resolveReconnectWaitMs()

	log('info', '[Caspar restart] Sending AMCP RESTART…')
	await ctx.amcp.query.restart()

	let disconnected = await waitForAmcpDisconnect(ctx, disconnectMs)
	if (!disconnected) {
		log('warn', `[Caspar restart] AMCP still connected after ${disconnectMs}ms — killing main casparcg`)
		killStuckCasparMainProcess(ctx)
		disconnected = await waitForAmcpDisconnect(ctx, 15_000)
	}

	if (!disconnected) {
		log('warn', '[Caspar restart] Caspar did not release AMCP after kill attempt')
		return { restartSent: true, disconnected: false, reconnected: false }
	}

	if (onDisconnected) {
		try {
			await onDisconnected()
		} catch (e) {
			log('warn', `[Caspar restart] onDisconnected hook failed: ${e.message}`)
		}
	}

	log('info', '[Caspar restart] AMCP disconnected — waiting for Caspar to relaunch via run.sh…')
	let reconnected = reconnectMs > 0 ? await waitForAmcpTcp(ctx, reconnectMs) : false
	if (!reconnected) {
		log('warn', `[Caspar restart] AMCP did not reconnect within ${reconnectMs}ms — killing hung casparcg`)
		killStuckCasparMainProcess(ctx)
		const retryMs = Math.min(reconnectMs, 60_000)
		reconnected = retryMs > 0 ? await waitForAmcpTcp(ctx, retryMs) : false
		if (reconnected) {
			log('info', '[Caspar restart] AMCP reconnected after kill')
		} else {
			log('warn', `[Caspar restart] AMCP still down after kill + ${retryMs}ms`)
		}
	} else {
		log('info', '[Caspar restart] AMCP reconnected')
	}

	return { restartSent: true, disconnected: true, reconnected }
}

module.exports = {
	isAmcpTcpConnected,
	waitForAmcpTcp,
	waitForAmcpDisconnect,
	killStuckCasparMainProcess,
	sendRestartAndWaitForCaspar,
	resolveReconnectWaitMs,
}
