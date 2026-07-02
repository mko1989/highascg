/**
 * Server setup info: IPs, Tailscale, Syncthing URLs (read-only; for remote admin).
 * Nuclear actions: reboot, Calamares install, Caspar systemd control (WO-73).
 */

'use strict'

const os = require('os')
const fs = require('fs')
const { execSync, execFileSync, spawn } = require('child_process')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getPublicTailscaleSummary } = require('../network/tailscale-service')
const { getXAuthority } = require('../utils/hardware-info')
const {
	verifyNuclearPasswordFromUi,
	hasConfiguredNuclearPassword,
} = require('../utils/nuclear-password')

const CALAMARES_BIN = '/usr/bin/calamares'
const EGGS_BIN = '/usr/bin/eggs'
const LAUNCH_CALAMARES = '/usr/local/bin/launch-calamares.sh'
const CASPAR_CONTROL = '/usr/local/bin/caspar-systemd-control.sh'

/**
 * @returns {Array<{name: string, address: string}>}
 */
function listIPv4Interfaces() {
	const out = []
	const nets = os.networkInterfaces()
	for (const name of Object.keys(nets)) {
		for (const net of nets[name] || []) {
			if (net.family === 'IPv4' && !net.internal) {
				out.push({ name, address: net.address })
			}
		}
	}
	return out
}

/**
 * @returns {string}
 */
function readDisplayMode() {
	try {
		const p = '/etc/highascg/display-mode'
		if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim() || 'normal'
	} catch {
		/* ignore */
	}
	return 'normal'
}

/**
 * @param {string} bin
 * @returns {boolean}
 */
function isExecutable(bin) {
	try {
		fs.accessSync(bin, fs.constants.X_OK)
		return true
	} catch {
		return false
	}
}

/**
 * @returns {{ installed: boolean, binary: string|null, eggsAvailable: boolean, launchable: boolean }}
 */
function detectCalamaresStatus() {
	const calamaresInstalled = isExecutable(CALAMARES_BIN) || Boolean(execSyncSafe('command -v calamares'))
	const eggsAvailable = isExecutable(EGGS_BIN)
	let eggsCalamares = false
	if (eggsAvailable) {
		try {
			execFileSync(EGGS_BIN, ['calamares', '--help'], { stdio: 'ignore', timeout: 8000 })
			eggsCalamares = true
		} catch {
			eggsCalamares = false
		}
	}
	const launchable = calamaresInstalled || eggsCalamares
	const sudoLaunchAvailable = calamaresInstalled && calamaresSudoLaunchAvailable()
	return {
		installed: calamaresInstalled,
		binary: calamaresInstalled ? CALAMARES_BIN : eggsCalamares ? `${EGGS_BIN} calamares` : null,
		eggsAvailable: eggsCalamares,
		launchable,
		sudoLaunchAvailable,
	}
}

/**
 * @param {string} cmd
 * @returns {string}
 */
function execSyncSafe(cmd) {
	try {
		return execSync(cmd, { encoding: 'utf8', timeout: 4000 }).trim()
	} catch {
		return ''
	}
}

/**
 * @param {string} unit
 * @returns {'active'|'inactive'|'failed'|'unknown'}
 */
function systemctlIsActive(unit) {
	try {
		const st = execFileSync('systemctl', ['is-active', unit], { encoding: 'utf8', timeout: 5000 }).trim()
		if (st === 'active' || st === 'activating') return 'active'
		if (st === 'failed') return 'failed'
		return 'inactive'
	} catch (e) {
		const out = String(e?.stdout || e?.stderr || '').trim()
		if (out === 'failed') return 'failed'
		return 'inactive'
	}
}

/**
 * @returns {{ scanner: string, server: string, inhibited: boolean, unitsInstalled: boolean }}
 */
function detectCasparServiceStatus() {
	const scanner = systemctlIsActive('casparcg-scanner.service')
	const server = systemctlIsActive('casparcg-server.service')
	const inhibited = fs.existsSync('/run/highascg/inhibit-caspar-autostart')
	const unitsInstalled =
		fs.existsSync('/etc/systemd/system/casparcg-scanner.service') &&
		fs.existsSync('/etc/systemd/system/casparcg-server.service')
	return { scanner, server, inhibited, unitsInstalled }
}

/**
 * @param {string} path
 * @param {object} ctx
 */
async function handleGet(path, ctx) {
	if (path !== '/api/system/setup') return null

	const httpPort = ctx.config?.server?.httpPort ?? 4200
	const interfaces = listIPv4Interfaces()
	const primary = interfaces[0]?.address || '127.0.0.1'

	const tailscale = getPublicTailscaleSummary()

	const syncthingGui = `http://${primary}:8384`
	const adminUrls = {
		highascg: `http://${primary}:${httpPort}/`,
		setupPage: `http://${primary}:${httpPort}/setup.html`,
		syncthing: syncthingGui,
		tailscaleAdmin: 'https://login.tailscale.com/admin/machines',
	}

	const calamares = detectCalamaresStatus()
	const casparService = detectCasparServiceStatus()

	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			displayMode: readDisplayMode(),
			interfaces,
			primaryIp: primary,
			httpPort,
			tailscale,
			calamares,
			casparService,
			syncthing: {
				guiUrl: syncthingGui,
				note:
					'Syncthing does not auto-pair devices. Open this URL on a client on the same LAN or Tailnet, add a remote device ID, then accept the folder on each side.',
			},
			tailscaleInstructions: {
				summary:
					'Configure Tailscale from Settings → Tailscale, or use the login URL below. Admin console link manages machines on your tailnet.',
				cliLogin: 'sudo tailscale up',
				webAdmin: adminUrls.tailscaleAdmin,
				settingsTab: 'tailscale',
			},
			adminUrls,
		}),
	}
}

function checkNuclearPassword(body, ctx) {
	const cfgUi = ctx?.config?.ui && typeof ctx.config.ui === 'object' ? ctx.config.ui : {}
	const requirePassword = cfgUi.nuclearRequirePassword === true || cfgUi.nuclearRequirePassword === 'true'
	if (!requirePassword) return { ok: true }
	if (!hasConfiguredNuclearPassword(cfgUi)) {
		return { ok: false, status: 403, error: 'Nuclear password required but not configured.' }
	}
	const b = parseBody(body)
	const provided = String(b?.password || '')
	if (!verifyNuclearPasswordFromUi(provided, cfgUi)) {
		return { ok: false, status: 403, error: 'Invalid password.' }
	}
	return { ok: true }
}

function runSudoNoPrompt(candidates, timeoutMs = 15000) {
	let lastErr = null
	for (const c of candidates) {
		try {
			const out = execFileSync('sudo', ['-n', c.bin, ...c.args], { encoding: 'utf8', timeout: timeoutMs })
			return { ok: true, command: `${c.bin} ${c.args.join(' ')}`.trim(), output: String(out || '').trim() }
		} catch (e) {
			lastErr = e
		}
	}
	const msg = lastErr?.stderr ? String(lastErr.stderr).trim() : lastErr?.message || 'Command failed'
	return { ok: false, error: msg }
}

/**
 * @param {string[]} args
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {{ ok: boolean, output?: string, error?: string }}
 */
function runCasparControl(args, opts = {}) {
	if (!isExecutable(CASPAR_CONTROL)) {
		return { ok: false, error: 'caspar-systemd-control.sh not installed — run scripts/setup/13-caspar-systemd-units.sh' }
	}
	const timeoutMs = opts.timeoutMs ?? 15000
	const r = runSudoNoPrompt([{ bin: CASPAR_CONTROL, args }], timeoutMs)
	return r.ok ? r : { ok: false, error: r.error }
}

/**
 * Fire-and-forget Caspar control (stop/restart can exceed systemd TimeoutStopSec).
 * @param {string[]} args
 */
function runCasparControlDetached(args) {
	if (!isExecutable(CASPAR_CONTROL)) {
		return { ok: false, error: 'caspar-systemd-control.sh not installed — run scripts/setup/13-caspar-systemd-units.sh' }
	}
	try {
		const child = spawn('sudo', ['-n', CASPAR_CONTROL, ...args], {
			detached: true,
			stdio: 'ignore',
		})
		child.unref()
		return { ok: true }
	} catch (e) {
		return { ok: false, error: e?.message || 'Launch failed' }
	}
}

/**
 * Parse caspar-systemd-control.sh status output into an object.
 * @param {string} text
 */
function parseCasparControlOutput(text) {
	/** @type {Record<string, string>} */
	const out = {}
	for (const line of String(text || '').split('\n')) {
		const m = line.match(/^([a-z_]+)=(.+)$/)
		if (m) out[m[1]] = m[2]
	}
	return out
}

function calamaresSudoLaunchAvailable() {
	if (!isExecutable(LAUNCH_CALAMARES)) return false
	try {
		const out = execFileSync('sudo', ['-n', '-l'], { encoding: 'utf8', timeout: 4000 })
		return out.includes('launch-calamares.sh')
	} catch {
		return false
	}
}

function launchCalamaresAsync(ctx) {
	const calamares = detectCalamaresStatus()
	if (!calamares.installed) {
		return { ok: false, status: 503, error: 'Calamares not installed. Run eggs calamares --install on the build host.' }
	}

	if (!isExecutable(LAUNCH_CALAMARES)) {
		return {
			ok: false,
			status: 503,
			error: 'launch-calamares.sh not installed — run scripts/setup/13-caspar-systemd-units.sh',
		}
	}

	if (!calamaresSudoLaunchAvailable()) {
		return {
			ok: false,
			status: 502,
			error:
				'Passwordless sudo for Calamares is not configured. On the playout host run: sudo bash scripts/setup/12-passwordless-sudo.sh && sudo bash scripts/setup/13-caspar-systemd-units.sh',
		}
	}

	const env = {
		...process.env,
		DISPLAY: ':0',
		XAUTHORITY: getXAuthority(),
	}
	unsetWayland(env)

	try {
		const child = spawn('sudo', ['-n', LAUNCH_CALAMARES], {
			detached: true,
			stdio: 'ignore',
			env,
		})
		child.unref()
		if (ctx?.config) {
			const { scheduleGuiWindowPosition } = require('../utils/x-display-session')
			const log = (level, msg) => {
				if (typeof ctx.log === 'function') ctx.log(level, msg)
			}
			scheduleGuiWindowPosition('calamares', ctx.config, { log })
		}
		return { ok: true, action: 'install', mode: 'launch-calamares.sh' }
	} catch (e) {
		return { ok: false, status: 502, error: e?.message || 'Launch failed' }
	}
}

/** @param {NodeJS.ProcessEnv} env */
function unsetWayland(env) {
	delete env.WAYLAND_DISPLAY
}

async function handlePost(path, body, ctx) {
	const nuclearPaths = new Set([
		'/api/system/setup/restart-window-manager',
		'/api/system/setup/reboot',
		'/api/system/setup/restart-app',
		'/api/system/setup/install',
		'/api/system/setup/caspar/stop',
		'/api/system/setup/caspar/start',
		'/api/system/setup/caspar/restart',
	])
	if (!nuclearPaths.has(path)) return null

	const pw = checkNuclearPassword(body, ctx)
	if (!pw.ok) return { status: pw.status || 403, headers: JSON_HEADERS, body: jsonBody({ error: pw.error }) }

	if (path === '/api/system/setup/restart-window-manager') {
		const r = runSudoNoPrompt([
			{ bin: '/bin/systemctl', args: ['restart', 'nodm'] },
			{ bin: '/usr/bin/systemctl', args: ['restart', 'nodm'] },
		])
		if (!r.ok) {
			return {
				status: 502,
				headers: JSON_HEADERS,
				body: jsonBody({ error: `Restart failed: ${r.error}. Check sudoers for casparcg user.` }),
			}
		}
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, action: 'restart-window-manager' }) }
	}
	if (path === '/api/system/setup/restart-app') {
		setTimeout(() => {
			try {
				process.kill(process.pid, 'SIGTERM')
			} catch {
				process.exit(0)
			}
		}, 150)
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: true,
				action: 'restart-app',
				note: 'Restart signal sent. If HighAsCG is supervised (systemd), it should restart automatically.',
			}),
		}
	}
	if (path === '/api/system/setup/install') {
		const launched = launchCalamaresAsync(ctx)
		if (!launched.ok) {
			return {
				status: launched.status || 502,
				headers: JSON_HEADERS,
				body: jsonBody({ error: launched.error }),
			}
		}
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: true,
				action: 'install',
				mode: launched.mode,
				note: 'Calamares installer opening on the operator display (:0).',
			}),
		}
	}

	if (path === '/api/system/setup/caspar/stop') {
		const r = runCasparControlDetached(['stop'])
		if (!r.ok) {
			return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: r.error }) }
		}
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: true,
				action: 'caspar-stop',
				note: 'Stop sent. CasparCG may take up to 2 minutes to fully exit (systemd TimeoutStopSec).',
			}),
		}
	}
	if (path === '/api/system/setup/caspar/start') {
		const r = runCasparControl(['start'])
		if (!r.ok) {
			return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: r.error }) }
		}
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true, action: 'caspar-start', caspar: parseCasparControlOutput(r.output) }),
		}
	}
	if (path === '/api/system/setup/caspar/restart') {
		const r = runCasparControlDetached(['restart'])
		if (!r.ok) {
			return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: r.error }) }
		}
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: true,
				action: 'caspar-restart',
				note: 'Restart sent. CasparCG may take up to 2 minutes to stop before coming back.',
			}),
		}
	}

	const r = runSudoNoPrompt([
		{ bin: '/sbin/reboot', args: [] },
		{ bin: '/usr/sbin/reboot', args: [] },
		{ bin: '/bin/systemctl', args: ['reboot'] },
		{ bin: '/usr/bin/systemctl', args: ['reboot'] },
	])
	if (!r.ok) {
		return {
			status: 502,
			headers: JSON_HEADERS,
			body: jsonBody({ error: `Reboot failed: ${r.error}. Check sudoers for casparcg user.` }),
		}
	}
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, action: 'reboot' }) }
}

module.exports = {
	handleGet,
	handlePost,
	readDisplayMode,
	checkNuclearPassword,
	detectCalamaresStatus,
	detectCasparServiceStatus,
	parseCasparControlOutput,
	systemctlIsActive,
}
