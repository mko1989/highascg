'use strict'

/**
 * AMCP up/down waits for the Caspar restart paths (split out of caspar-restart.js at its 500-line limit, WO-805).
 *
 * WO-805: the Apply used to notice the reconnected client up to ~0.8 s late — a 400 ms port poll, then a FIXED
 * 400 ms sleep after the reconnect nudge even though the client connects within milliseconds of it (journal 29.10:
 * Caspar "Initialized controllers" → node "AMCP back" 0.44-0.76 s, of which exactly 0.40 s was that sleep). Every
 * sleep here now wakes the moment the client is connected (a property read every 25 ms, no forks).
 */

const { execFile } = require('child_process')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)

const DEFAULT_AMCP_PORT = parseInt(String(process.env.CASPAR_AMCP_PORT || '5250'), 10) || 5250
/** Granularity of the early-wake check inside {@link sleepUntilConnected} (property read only). */
const CONNECTED_CHECK_MS = 25

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
 * WO-805: sleep up to `ms`, but return as soon as the AMCP client is connected.
 * @param {object} ctx
 * @param {number} ms
 * @returns {Promise<boolean>} connected at wake-up
 */
async function sleepUntilConnected(ctx, ms) {
	const end = Date.now() + Math.max(0, ms)
	while (!isAmcpTcpConnected(ctx)) {
		const left = end - Date.now()
		if (left <= 0) return false
		await sleep(Math.min(CONNECTED_CHECK_MS, left))
	}
	return true
}

/**
 * Wait until AMCP TCP client is up or :5250 is listening (Caspar booted; client may lag).
 * `portStableMs` (WO-805): with `acceptPortListening`, the port must also have been up this long — so a faster
 * `pollMs` cannot shorten the "port up but no client" fallback window (default: the old 3-poll window at 400 ms).
 * `isPortListening` is injectable for tests (the default probes the box's real :5250).
 * @param {object} ctx
 * @param {number} maxMs
 * @param {number | { pollMs?: number, log?: Function, progressIntervalMs?: number, acceptPortListening?: boolean, portStablePolls?: number, portStableMs?: number, isPortListening?: () => Promise<boolean> }} [pollMsOrOpts]
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
	const portStableMs = Math.max(0, opts.portStableMs ?? 0)
	const portListening = typeof opts.isPortListening === 'function' ? opts.isPortListening : isAmcpPortListening

	const t0 = Date.now()
	let lastProgress = t0
	let lastNudge = 0
	let portUpStreak = 0
	let portUpSince = 0

	while (Date.now() - t0 < maxMs) {
		const now = Date.now()
		if (isAmcpTcpConnected(ctx)) return true

		const portUp = await portListening()
		if (portUp) {
			portUpStreak++
			if (!portUpSince) portUpSince = now
			if (now - lastNudge >= 2000) {
				nudgeCasparConnectionReconnect(ctx)
				lastNudge = now
			}
			if (await sleepUntilConnected(ctx, Math.min(pollMs, 800))) return true
			if (acceptPortListening && portUpStreak >= portStablePolls && Date.now() - portUpSince >= portStableMs) return true
		} else {
			portUpStreak = 0
			portUpSince = 0
		}

		if (log && now - lastProgress >= progressIntervalMs) {
			const elapsedSec = Math.round((now - t0) / 1000)
			let mainRunning = false
			try {
				mainRunning = await require('./caspar-restart').isCasparMainProcessRunning(ctx)
			} catch {
				/* ignore */
			}
			log(
				'info',
				`[Caspar restart] still waiting (${elapsedSec}s) — amcp_port=${portUp ? 'up' : 'down'} caspar=${mainRunning ? 'running' : 'stopped'} client=${isAmcpTcpConnected(ctx) ? 'up' : 'down'}`,
			)
			lastProgress = now
		}

		if (await sleepUntilConnected(ctx, pollMs)) return true
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

module.exports = {
	isAmcpPortListening,
	nudgeCasparConnectionReconnect,
	isAmcpTcpConnected,
	sleepUntilConnected,
	waitForAmcpReady,
	waitForAmcpDisconnect,
}
