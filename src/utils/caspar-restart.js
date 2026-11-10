'use strict'

const fs = require('fs')
const { execFile } = require('child_process')
const { promisify } = require('util')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')

const execFileAsync = promisify(execFile)
/* WO-805: the AMCP up/down waits live in caspar-amcp-wait.js (this file was at the 500-line limit). */
const {
	isAmcpPortListening,
	nudgeCasparConnectionReconnect,
	isAmcpTcpConnected,
	waitForAmcpReady,
	waitForAmcpDisconnect,
} = require('./caspar-amcp-wait')

const CASPAR_SYSTEMD_CONTROL = '/usr/local/bin/caspar-systemd-control.sh'
const CASPAR_SERVER_UNIT = 'casparcg-server.service'
/** WO-805: Apply's AMCP-back port poll, and how long the port must be up before a client-less "back" counts. */
const APPLY_AMCP_POLL_MS = 150
const APPLY_PORT_STABLE_MS = 2000

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

function isCasparSystemdControlInstalled() {
	return fs.existsSync(CASPAR_SYSTEMD_CONTROL)
}

/**
 * @returns {Promise<boolean>}
 */
async function isCasparSystemdServerActive() {
	try {
		const { stdout } = await execFileAsync('systemctl', ['is-active', CASPAR_SERVER_UNIT], {
			timeout: 5000,
			encoding: 'utf8',
		})
		const st = String(stdout || '').trim()
		return st === 'active' || st === 'activating'
	} catch {
		return false
	}
}

/**
 * Restart casparcg-server via passwordless sudo helper (Nuclear tab wiring).
 * @param {Function} log
 * @returns {Promise<boolean>}
 */
async function restartCasparViaSystemd(log) {
	if (!isCasparSystemdControlInstalled()) {
		log('warn', '[Caspar restart] caspar-systemd-control.sh missing — cannot systemd restart')
		return false
	}
	try {
		await execFileAsync('sudo', ['-n', CASPAR_SYSTEMD_CONTROL, 'restart'], {
			timeout: 120_000,
			encoding: 'utf8',
		})
		log('info', '[Caspar restart] systemd casparcg-server restart triggered')
		return true
	} catch (e) {
		const detail = e?.stderr ? String(e.stderr).trim() : e?.message || String(e)
		log('warn', `[Caspar restart] systemd restart failed: ${detail}`)
		return false
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
 * After apply wrote new config: brief AMCP RESTART, then fast-kill if Caspar is still up so
 * run.sh relaunches with the new file. Avoids ~90s hangs when RESTART teardown leaves screen
 * consumers visible while HighAsCG waits for reconnect.
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
	/* WO-805: port poll 400 → 150 ms (Caspar listening → client nudged ≤0.17 s instead of ≤0.42 s; one `ss` per
	 * tick, only while the Apply waits), and the "port up, no client" fallback keeps its old ~2 s window. */
	const waitOpts = {
		log,
		progressIntervalMs: 5000,
		acceptPortListening: opts.acceptPortListening !== false,
		pollMs: APPLY_AMCP_POLL_MS,
		portStableMs: APPLY_PORT_STABLE_MS,
	}

	if (!ctx?.amcp) {
		return { attempted: false, restartSent: false, disconnected: true, reconnected: false }
	}

	let restartSent = false
	const skipRestartCommand = opts.skipRestartCommand === true

	/* WO-337 #3: tell run.sh this exit is operator-initiated — it consumes the marker and skips
	 * its crash-loop damping sleeps (5s relaunch + 2×2s grace) for exactly this one relaunch. */
	try {
		require('fs').writeFileSync('/tmp/caspar-operator-restart', String(Date.now()))
	} catch {
		/* marker is best-effort — without it the relaunch just keeps the damping sleeps */
	}

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
	/* WO-337: after a clean AMCP RESTART the process is usually mid-exit here — pgrep/ss can
	 * still see it for a few hundred ms, and invoking the kill script then burns its fixed
	 * TERM/KILL sleeps (measured 2.15s) against an already-dead process. Give it a short settle
	 * poll before deciding it is actually stuck. */
	for (let i = 0; (mainRunning || portUp) && i < 5; i++) {
		await new Promise((r) => setTimeout(r, 200))
		mainRunning = await isCasparMainProcessRunning(ctx)
		portUp = await isAmcpPortListening()
	}
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

	const supervisorDown = !(await isCasparSystemdServerActive())
	if (supervisorDown || skipRestartCommand) {
		if (supervisorDown) {
			log(
				'info',
				'[Caspar restart] Apply: casparcg-server inactive (e.g. nodm restart) — starting via systemd',
			)
		} else {
			log('info', '[Caspar restart] Apply: post-nodm path — ensuring casparcg-server via systemd')
		}
		await restartCasparViaSystemd(log)
	}

	log('info', '[Caspar restart] Apply: waiting for run.sh relaunch…')

	let reconnected =
		reconnectMs > 0 ? await waitForAmcpReady(ctx, reconnectMs, waitOpts) : false

	if (!reconnected && !(await isAmcpPortListening())) {
		log('warn', `[Caspar restart] Apply: no AMCP after ${reconnectMs}ms — kill + short retry`)
		await killStuckCasparMainProcess(ctx)
		if (!(await isCasparSystemdServerActive())) {
			await restartCasparViaSystemd(log)
		}
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

/** WO-1029: loopback http URL of a virtual box's fake Caspar control endpoint ('' = no hook / not acceptable). */
function sandboxRestartHookUrl() {
	if (!require('../bootstrap/sandbox').isSandbox()) return ''
	const raw = String(process.env.HIGHASCG_SANDBOX_CASPAR_RESTART_URL || '').trim()
	if (!raw) return ''
	try {
		const u = new URL(raw)
		const loop = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(u.hostname)
		return u.protocol === 'http:' && loop && u.port !== '5250' ? u.origin : ''
	} catch {
		return ''
	}
}

function hookRequest(origin, method, p, ms = 5000) {
	return new Promise((resolve) => {
		const req = require('http').request(origin + p, { method, timeout: ms }, (res) => {
			const c = []
			res.on('data', (d) => c.push(d))
			res.on('end', () => {
				try {
					resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(c).toString('utf8')) })
				} catch {
					resolve({ status: res.statusCode, data: null })
				}
			})
		})
		req.on('timeout', () => req.destroy(new Error('timeout')))
		req.on('error', () => resolve({ status: 0, data: null }))
		req.end()
	})
}

/**
 * WO-1029: the sandbox branch of the Caspar restart. A virtual box (tools/e2e/virtual-boxes.js) gives its node the
 * loopback control URL of ITS OWN fake Caspar; "restart" POSTs there, so the node sees a real disconnect and reconnect.
 * Never systemctl, never a process, never :5250. Same answer shape as {@link reloadCasparAfterConfigWrite}.
 * @param {object} ctx
 * @param {{ log?: Function, disconnectMs?: number, reconnectMs?: number }} [opts]
 */
async function reloadCasparViaSandboxHook(ctx, opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	const origin = sandboxRestartHookUrl()
	if (!origin || !ctx?.amcp) return { attempted: false, restartSent: false, disconnected: false, reconnected: false }
	const r = await hookRequest(origin, 'POST', '/restart')
	if (r.status !== 200) {
		log('warn', `[Caspar restart] sandbox hook failed (${r.status})`)
		return { attempted: true, restartSent: false, disconnected: false, reconnected: false }
	}
	log('info', '[Caspar restart] sandbox hook: fake Caspar restarting')
	const disconnected = await waitForAmcpDisconnect(ctx, opts.disconnectMs ?? resolveApplyDisconnectWaitMs())
	// "port listening" = the fake says it listens again (no ss, no probe connection); the nudge reconnects the client
	const reconnected = await waitForAmcpReady(ctx, opts.reconnectMs ?? resolveApplyReconnectWaitMs(), {
		log,
		pollMs: 100,
		isPortListening: async () => (await hookRequest(origin, 'GET', '/state', 1500)).data?.listening === true,
	})
	return { attempted: true, restartSent: true, disconnected: !!disconnected, reconnected: !!reconnected }
}

module.exports = {
	reloadCasparViaSandboxHook,
	sandboxRestartHookUrl,
	isAmcpTcpConnected,
	isAmcpPortListening,
	isCasparMainProcessRunning,
	isCasparSystemdServerActive,
	isCasparSystemdControlInstalled,
	restartCasparViaSystemd,
	waitForAmcpReady,
	waitForAmcpDisconnect,
	killStuckCasparMainProcess,
	nudgeCasparConnectionReconnect,
	reloadCasparAfterConfigWrite,
	resolveReconnectWaitMs,
	resolveApplyDisconnectWaitMs,
	resolveApplyReconnectWaitMs,
}
