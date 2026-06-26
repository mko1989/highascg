'use strict'

const { execFile } = require('child_process')
const { promisify } = require('util')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')

const execFileAsync = promisify(execFile)

const DEFAULT_AMCP_PORT = parseInt(String(process.env.CASPAR_AMCP_PORT || '5250'), 10) || 5250

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms))
}

async function isAmcpPortListening(port = DEFAULT_AMCP_PORT) {
	try {
		const { stdout } = await execFileAsync('ss', ['-tln'], { timeout: 2000, encoding: 'utf8' })
		const re = new RegExp(`:${port}\\b`)
		return re.test(String(stdout || ''))
	} catch {
		return false
	}
}

function nudgeCasparConnectionReconnect(ctx) {
	const conn = ctx?.casparConnection
	if (conn && typeof conn.reconnect === 'function') {
		try {
			conn.reconnect(conn.host, conn.port)
		} catch {
			/* ignore */
		}
	}
}

/**
 * True when the main casparcg binary for this install is running (excludes CEF helper processes).
 * @param {object} ctx
 * @returns {Promise<boolean>}
 */
async function isCasparMainProcessRunning(ctx) {
	const casparRoot = resolveCasparRoot(ctx)
	const configPath = String(
		ctx?.config?.casparServer?.configPath || path.join(casparRoot, 'config/casparcg.config')
	)
	try {
		const { stdout } = await execFileAsync('pgrep', ['-af', configPath], {
			timeout: 2500,
			encoding: 'utf8',
		})
		return String(stdout || '')
			.split('\n')
			.some((line) => /casparcg/i.test(line) && !/--type=/.test(line))
	} catch {
		return false
	}
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
 * Wait until AMCP TCP client is up or :5250 is listening (Caspar booted; client may lag).
 * @param {object} ctx
 * @param {number} maxMs
 * @param {number | { pollMs?: number, log?: Function, progressIntervalMs?: number, acceptPortListening?: boolean, portStablePolls?: number }} [pollMsOrOpts]
 * @returns {Promise<boolean>}
 */
async function waitForAmcpReady(ctx, maxMs, pollMsOrOpts = 400) {
	const opts =
		typeof pollMsOrOpts === 'object' && pollMsOrOpts !== null ? pollMsOrOpts : { pollMs: pollMsOrOpts }
	const pollMs = opts.pollMs ?? 400
	const log = typeof opts.log === 'function' ? opts.log : null
	const progressIntervalMs = opts.progressIntervalMs ?? 5000
	const acceptPortListening = opts.acceptPortListening === true
	const portStablePolls = Math.max(1, opts.portStablePolls ?? 3)

	const t0 = Date.now()
	let lastProgress = t0
	let lastNudge = 0
	let portUpStreak = 0

	while (Date.now() - t0 < maxMs) {
		const now = Date.now()
		if (isAmcpTcpConnected(ctx)) return true

		const portUp = await isAmcpPortListening()
		if (portUp) {
			portUpStreak++
			if (now - lastNudge >= 2000) {
				nudgeCasparConnectionReconnect(ctx)
				lastNudge = now
			}
			await sleep(Math.min(pollMs, 800))
			if (isAmcpTcpConnected(ctx)) return true
			if (acceptPortListening && portUpStreak >= portStablePolls) return true
		} else {
			portUpStreak = 0
		}

		if (log && now - lastProgress >= progressIntervalMs) {
			const elapsedSec = Math.round((now - t0) / 1000)
			let mainRunning = false
			try {
				mainRunning = await isCasparMainProcessRunning(ctx)
			} catch {
				/* ignore */
			}
			log(
				'info',
				`[Caspar restart] still waiting (${elapsedSec}s) — amcp_port=${portUp ? 'up' : 'down'} caspar=${mainRunning ? 'running' : 'stopped'} client=${isAmcpTcpConnected(ctx) ? 'up' : 'down'}`,
			)
			lastProgress = now
		}

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

function casparKillEnv(casparRoot) {
	return {
		...process.env,
		CASPAR_ROOT: casparRoot,
		CASPAR_KILL_FAST: '1',
		CASPAR_PORT_FREE_WAIT_SEC: process.env.CASPAR_PORT_FREE_WAIT_SEC || '5',
		CASPAR_RESTART_GRACE_SEC: process.env.CASPAR_RESTART_GRACE_SEC || '0',
	}
}

/**
 * Force-kill the main casparcg binary when AMCP RESTART does not complete teardown.
 * @param {object} ctx
 * @returns {Promise<boolean>}
 */
async function killStuckCasparMainProcess(ctx) {
	const casparRoot = resolveCasparRoot(ctx)
	const script = path.join(casparRoot, 'tools/runtime/caspar-kill-main.sh')
	try {
		await execFileAsync('bash', [script], {
			env: casparKillEnv(casparRoot),
			timeout: 12_000,
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

function resolveApplyDisconnectWaitMs() {
	const raw = process.env.HIGHASCG_CASPAR_APPLY_DISCONNECT_WAIT_MS
	if (raw === undefined || raw === '') return 4_000
	const n = parseInt(String(raw), 10)
	return Number.isFinite(n) && n >= 0 ? Math.min(n, 30_000) : 4_000
}

function resolveApplyReconnectWaitMs() {
	const raw = process.env.HIGHASCG_CASPAR_APPLY_RECONNECT_WAIT_MS
	if (raw === undefined || raw === '') return 45_000
	const n = parseInt(String(raw), 10)
	return Number.isFinite(n) && n >= 0 ? Math.min(n, 180_000) : 45_000
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

	const disconnectMs =
		typeof opts.disconnectMs === 'number' && opts.disconnectMs >= 0
			? opts.disconnectMs
			: resolveDisconnectWaitMs()
	const reconnectMs =
		typeof opts.reconnectMs === 'number' && opts.reconnectMs >= 0 ? opts.reconnectMs : resolveReconnectWaitMs()
	const clientWaitMs =
		typeof opts.clientWaitMs === 'number' && opts.clientWaitMs >= 0
			? opts.clientWaitMs
			: Math.min(8_000, reconnectMs)

	log('info', '[Caspar restart] Sending AMCP RESTART…')
	await ctx.amcp.query.restart()

	let disconnected = await waitForAmcpDisconnect(ctx, disconnectMs)
	if (!disconnected) {
		if (await isAmcpPortListening()) {
			log('info', '[Caspar restart] AMCP port cycle complete — treating as reloaded in-process')
			disconnected = true
		} else {
			log('warn', `[Caspar restart] AMCP still connected after ${disconnectMs}ms — killing main casparcg`)
			await killStuckCasparMainProcess(ctx)
			disconnected = await waitForAmcpDisconnect(ctx, 8_000)
		}
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
	} else {
		nudgeCasparConnectionReconnect(ctx)
	}

	log('info', '[Caspar restart] AMCP disconnected — waiting for Caspar to relaunch via run.sh…')
	const waitOpts = {
		log,
		progressIntervalMs: 5000,
		acceptPortListening: opts.acceptPortListening !== false,
	}
	let reconnected = reconnectMs > 0 ? await waitForAmcpReady(ctx, reconnectMs, waitOpts) : false

	if (reconnected && !isAmcpTcpConnected(ctx)) {
		log('info', '[Caspar restart] AMCP port up — waiting briefly for client session…')
		const clientOk = await waitForAmcpReady(ctx, clientWaitMs, {
			log,
			progressIntervalMs: 3000,
			acceptPortListening: false,
		})
		reconnected = clientOk || (await isAmcpPortListening())
	}

	if (!reconnected && !(await isAmcpPortListening())) {
		log('warn', `[Caspar restart] AMCP still down after ${reconnectMs}ms — killing hung casparcg`)
		await killStuckCasparMainProcess(ctx)
		reconnected = await waitForAmcpReady(ctx, Math.min(reconnectMs, 30_000), waitOpts)
		if (reconnected) {
			log('info', '[Caspar restart] AMCP reconnected after kill')
		} else {
			log('warn', '[Caspar restart] AMCP still down after kill')
		}
	} else if (reconnected && isAmcpTcpConnected(ctx)) {
		log('info', '[Caspar restart] AMCP reconnected')
	} else if (reconnected) {
		log('info', '[Caspar restart] AMCP port up (client session still settling)')
	} else {
		log('warn', '[Caspar restart] AMCP did not return within wait window — apply may continue')
	}

	return { restartSent: true, disconnected: true, reconnected: !!reconnected }
}

/**
 * After apply wrote new config: brief AMCP RESTART, then fast-kill if Caspar is still up so
 * run.sh relaunches with the new file. Avoids ~90s hangs when RESTART teardown leaves screen
 * consumers visible while HighAsCG waits for reconnect.
 *
 * @param {object} ctx
 * @param {{ log?: Function, skipRestartCommand?: boolean, disconnectMs?: number, reconnectMs?: number }} [opts]
 */
async function reloadCasparAfterConfigWrite(ctx, opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	const disconnectMs =
		typeof opts.disconnectMs === 'number' && opts.disconnectMs >= 0
			? opts.disconnectMs
			: resolveApplyDisconnectWaitMs()
	const reconnectMs =
		typeof opts.reconnectMs === 'number' && opts.reconnectMs >= 0
			? opts.reconnectMs
			: resolveApplyReconnectWaitMs()
	const waitOpts = {
		log,
		progressIntervalMs: 5000,
		acceptPortListening: opts.acceptPortListening !== false,
	}

	if (!ctx?.amcp) {
		return { attempted: false, restartSent: false, disconnected: true, reconnected: false }
	}

	let restartSent = false
	const skipRestartCommand = opts.skipRestartCommand === true

	if (!skipRestartCommand && isAmcpTcpConnected(ctx) && ctx.amcp.query?.restart) {
		log('info', '[Caspar restart] Apply: sending AMCP RESTART…')
		try {
			await ctx.amcp.query.restart()
			restartSent = true
		} catch (e) {
			log('warn', `[Caspar restart] Apply: RESTART failed (${e.message}) — will kill for relaunch`)
		}
	}

	if (restartSent) {
		await waitForAmcpDisconnect(ctx, disconnectMs)
	}

	let mainRunning = await isCasparMainProcessRunning(ctx)
	let portUp = await isAmcpPortListening()
	if (mainRunning || portUp) {
		log('info', '[Caspar restart] Apply: caspar still up — fast kill so run.sh relaunches with new config')
		await killStuckCasparMainProcess(ctx)
		await waitForAmcpDisconnect(ctx, 5_000)
		mainRunning = await isCasparMainProcessRunning(ctx)
		portUp = await isAmcpPortListening()
		if (mainRunning || portUp) {
			log('warn', '[Caspar restart] Apply: caspar still up after fast kill')
		}
	}

	nudgeCasparConnectionReconnect(ctx)
	log('info', '[Caspar restart] Apply: waiting for run.sh relaunch…')

	let reconnected =
		reconnectMs > 0 ? await waitForAmcpReady(ctx, reconnectMs, waitOpts) : false

	if (!reconnected && !(await isAmcpPortListening())) {
		log('warn', `[Caspar restart] Apply: no AMCP after ${reconnectMs}ms — kill + short retry`)
		await killStuckCasparMainProcess(ctx)
		reconnected = await waitForAmcpReady(ctx, Math.min(reconnectMs, 20_000), waitOpts)
	}

	if (reconnected) {
		log('info', '[Caspar restart] Apply: AMCP back after config reload')
	} else {
		log('warn', `[Caspar restart] Apply: AMCP did not return within ${reconnectMs}ms`)
	}

	return {
		attempted: true,
		restartSent,
		disconnected: true,
		reconnected: !!reconnected,
	}
}

/**
 * @param {object} ctx
 * @param {{ log?: Function }} [opts]
 */
async function finishCasparAfterApply(ctx, opts = {}) {
	return reloadCasparAfterConfigWrite(ctx, opts)
}

module.exports = {
	isAmcpTcpConnected,
	isAmcpPortListening,
	isCasparMainProcessRunning,
	waitForAmcpReady,
	waitForAmcpTcp: waitForAmcpReady,
	waitForAmcpDisconnect,
	killStuckCasparMainProcess,
	nudgeCasparConnectionReconnect,
	sendRestartAndWaitForCaspar,
	reloadCasparAfterConfigWrite,
	finishCasparAfterApply,
	resolveReconnectWaitMs,
	resolveApplyDisconnectWaitMs,
	resolveApplyReconnectWaitMs,
}
