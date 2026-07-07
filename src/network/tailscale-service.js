'use strict'

const fs = require('fs')
const http = require('http')
const { execFileSync } = require('child_process')
const { loadTailscaleConfig, saveTailscaleConfig } = require('../config/tailscale-config')

const LOCAL_API_HOST = 'local-tailscaled.sock'
const SOCKET_CANDIDATES = [
	'/run/tailscale/tailscaled.sock',
	'/var/run/tailscale/tailscaled.sock',
	'/var/snap/tailscale/common/socket/tailscaled.sock',
]
const TAILSCALE_UNITS = ['tailscaled.service', 'snap.tailscale.tailscaled.service']
const AUTH_URL_RE = /^https:\/\/login\.tailscale\.com\//i

/**
 * @param {string} authUrl
 */
function assertSafeAuthUrl(authUrl) {
	const url = String(authUrl || '').trim()
	if (!AUTH_URL_RE.test(url)) throw new Error('Invalid Tailscale auth URL')
	return url
}

/**
 * @param {string} url
 */
function assertSafeTailscaleWebUrl(url) {
	return assertSafeAuthUrl(url)
}

/**
 * @param {string} bin
 * @param {string[]} args
 * @param {number} [timeoutMs]
 */
function execFileSafe(bin, args, timeoutMs = 8000) {
	try {
		return execFileSync(bin, args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }).trim()
	} catch (e) {
		const out = String(e?.stdout || e?.stderr || e?.message || '').trim()
		const err = new Error(out || 'Command failed')
		err.code = e?.code
		throw err
	}
}

/**
 * @returns {string|null}
 */
function resolveTailscaleCli() {
	for (const bin of ['/usr/bin/tailscale', '/snap/bin/tailscale']) {
		try {
			if (fs.existsSync(bin)) return bin
		} catch {
			/* ignore */
		}
	}
	try {
		return execFileSync('/usr/bin/command', ['-v', 'tailscale'], { encoding: 'utf8', timeout: 2000 }).trim() || null
	} catch {
		return null
	}
}

/**
 * @returns {string|null}
 */
function resolveTailscaleSocket() {
	for (const socketPath of SOCKET_CANDIDATES) {
		try {
			if (fs.existsSync(socketPath)) return socketPath
		} catch {
			/* ignore */
		}
	}
	return null
}

/**
 * @param {'GET'|'POST'} method
 * @param {string} apiPath
 * @param {string} [body]
 */
function localApiRequest(method, apiPath, body) {
	const socketPath = resolveTailscaleSocket()
	if (!socketPath) throw new Error('tailscaled local socket not found')
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				socketPath,
				path: apiPath,
				method,
				headers: {
					Host: LOCAL_API_HOST,
					...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
				},
			},
			(res) => {
				const chunks = []
				res.on('data', (c) => chunks.push(c))
				res.on('end', () => {
					const text = Buffer.concat(chunks).toString('utf8')
					if (res.statusCode && res.statusCode >= 400) {
						reject(new Error(text || `Local API ${res.statusCode}`))
						return
					}
					resolve(text)
				})
			},
		)
		req.on('error', reject)
		if (body) req.write(body)
		req.end()
	})
}

/**
 * @returns {object|null}
 */
function readStatusJsonCli() {
	const cli = resolveTailscaleCli()
	if (!cli) return null
	try {
		const out = execFileSafe(cli, ['status', '--json'], 10000)
		return out ? JSON.parse(out) : null
	} catch {
		return null
	}
}

/**
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
 * @returns {{ unit: string|null, state: string }}
 */
function detectTailscaleDaemon() {
	for (const unit of TAILSCALE_UNITS) {
		const state = systemctlIsActive(unit)
		if (state === 'active' || state === 'activating') return { unit, state: 'active' }
	}
	for (const unit of TAILSCALE_UNITS) {
		const state = systemctlIsActive(unit)
		if (state !== 'inactive' && state !== 'unknown') return { unit, state }
	}
	if (resolveTailscaleCli()) {
		try {
			execFileSafe(resolveTailscaleCli(), ['status', '--json'], 4000)
			return { unit: null, state: 'active' }
		} catch {
			/* ignore */
		}
	}
	return { unit: TAILSCALE_UNITS[0], state: 'inactive' }
}

/**
 * @param {object|null} statusJson
 */
function parseStatusJson(statusJson) {
	const backendState = String(statusJson?.BackendState || '')
	const authUrl = String(statusJson?.AuthURL || '').trim() || null
	const self = statusJson?.Self && typeof statusJson.Self === 'object' ? statusJson.Self : null
	const tailscaleIps = Array.isArray(statusJson?.TailscaleIPs) ? statusJson.TailscaleIPs : []
	const ipv4 =
		tailscaleIps.find((ip) => typeof ip === 'string' && ip.includes('.')) ||
		(self?.TailscaleIPs || []).find((ip) => typeof ip === 'string' && ip.includes('.')) ||
		null
	const hostname = String(self?.HostName || '').trim() || null
	const dnsName = String(self?.DNSName || '').trim().replace(/\.$/, '') || null
	const needsLogin =
		backendState === 'NeedsLogin' ||
		!!authUrl ||
		(backendState !== 'Running' && !ipv4 && backendState !== '')
	const connected = backendState === 'Running' && !!ipv4
	return {
		backendState: backendState || (connected ? 'Running' : 'Unknown'),
		authUrl,
		ipv4,
		hostname,
		dnsName,
		needsLogin,
		connected,
		statusLine: hostname && ipv4 ? `${hostname}  ${ipv4}` : hostname || ipv4 || null,
	}
}

/**
 * @param {{ includeConfig?: boolean }} [opts]
 */
function getTailscaleStatus(opts = {}) {
	const cli = resolveTailscaleCli()
	const daemon = detectTailscaleDaemon()
	const config = opts.includeConfig ? loadTailscaleConfig() : undefined
	/** @type {object|null} */
	let statusJson
	const socketPath = resolveTailscaleSocket()
	if (socketPath) {
		try {
			const raw = execFileSync(
				'curl',
				['-sS', '--unix-socket', socketPath, '-H', `Host: ${LOCAL_API_HOST}`, `http://${LOCAL_API_HOST}/localapi/v0/status`],
				{ encoding: 'utf8', timeout: 6000, maxBuffer: 8 * 1024 * 1024 },
			)
			statusJson = raw ? JSON.parse(raw) : null
		} catch {
			statusJson = readStatusJsonCli()
		}
	} else {
		statusJson = readStatusJsonCli()
	}
	const parsed = parseStatusJson(statusJson)
	return {
		installed: !!cli,
		cli: cli || null,
		daemon,
		socketPath,
		...parsed,
		adminUrl: 'https://login.tailscale.com/admin/machines',
		config,
	}
}

/**
 * Compact block for GET /api/system/setup (legacy shape + extended fields).
 */
function getPublicTailscaleSummary() {
	const st = getTailscaleStatus({ includeConfig: false })
	return {
		ipv4: st.ipv4,
		statusLine: st.statusLine,
		needsLogin: st.needsLogin,
		connected: st.connected,
		backendState: st.backendState,
		authUrl: st.authUrl,
		hostname: st.hostname,
		dnsName: st.dnsName,
		installed: st.installed,
		daemon: st.daemon,
		adminUrl: st.adminUrl,
	}
}

/**
 * @param {Array<{ bin: string, args: string[] }>} candidates
 */
function runSudo(candidates, timeoutMs = 20000) {
	let lastErr = null
	for (const c of candidates) {
		try {
			const out = execFileSync('sudo', ['-n', c.bin, ...c.args], {
				encoding: 'utf8',
				timeout: timeoutMs,
				maxBuffer: 4 * 1024 * 1024,
			})
			return { ok: true, output: String(out || '').trim() }
		} catch (e) {
			lastErr = e
		}
	}
	const msg = lastErr?.stderr ? String(lastErr.stderr).trim() : lastErr?.message || 'sudo command failed'
	return { ok: false, error: msg }
}

/**
 * @param {boolean} enabled
 */
function setTailscaleEnabled(enabled) {
	saveTailscaleConfig({ enabled })
	if (enabled) {
		/** @type {Array<{bin: string, args: string[]}>} */
		const candidates = [
			{ bin: '/bin/systemctl', args: ['enable', '--now', 'tailscaled'] },
			{ bin: '/usr/bin/systemctl', args: ['enable', '--now', 'tailscaled'] },
		]
		if (!fs.existsSync('/usr/bin/tailscale') && fs.existsSync('/snap/bin/tailscale')) {
			candidates.push(
				{ bin: '/bin/systemctl', args: ['start', 'snap.tailscale.tailscaled.service'] },
				{ bin: '/usr/bin/systemctl', args: ['start', 'snap.tailscale.tailscaled.service'] },
			)
		}
		return runSudo(candidates)
	}
	/** @type {Array<{bin: string, args: string[]}>} */
	const stopCandidates = [
		{ bin: '/bin/systemctl', args: ['stop', 'tailscaled'] },
		{ bin: '/usr/bin/systemctl', args: ['stop', 'tailscaled'] },
	]
	if (fs.existsSync('/snap/bin/tailscale')) {
		stopCandidates.push(
			{ bin: '/bin/systemctl', args: ['stop', 'snap.tailscale.tailscaled.service'] },
			{ bin: '/usr/bin/systemctl', args: ['stop', 'snap.tailscale.tailscaled.service'] },
		)
	}
	return runSudo(stopCandidates)
}

/**
 * @param {Partial<import('../config/tailscale-config').DEFAULTS>} [prefs]
 */
async function startTailscaleLogin(_prefs) {
	const before = getTailscaleStatus()
	if (before.connected) {
		return { ok: true, authUrl: null, state: before.backendState, connected: true }
	}
	const socketPath = resolveTailscaleSocket()
	if (socketPath) {
		try {
			await localApiRequest('POST', '/localapi/v0/login-interactive')
		} catch (e) {
			const afterErr = getTailscaleStatus()
			if (afterErr.connected) {
				return { ok: true, authUrl: null, state: afterErr.backendState, connected: true }
			}
			const msg = String(e?.message || e || '').toLowerCase()
			if (msg.includes('login access denied') || msg.includes('403')) {
				return { ok: true, authUrl: null, state: afterErr.backendState, connected: afterErr.connected }
			}
			const r = runSudo([{ bin: '/usr/local/lib/highascg/highascg-tailscale-up.sh', args: [] }])
			if (!r.ok) return { ok: false, error: r.error }
		}
	} else {
		const r = runSudo([{ bin: '/usr/local/lib/highascg/highascg-tailscale-up.sh', args: [] }])
		if (!r.ok) return { ok: false, error: r.error }
	}
	await new Promise((r) => setTimeout(r, 800))
	const st = getTailscaleStatus()
	return { ok: true, authUrl: st.authUrl, state: st.backendState, connected: st.connected }
}

/**
 * @param {string} authUrl
 */
function spawnOperatorTailscaleLogin(authUrl) {
	const { spawnOperatorFirefox } = require('../api/system-hardware-gui')
	const url = assertSafeTailscaleWebUrl(authUrl)
	const bin = spawnOperatorFirefox(url)
	return { ok: true, bin, url }
}

/**
 * @param {Partial<import('../config/tailscale-config').DEFAULTS>} patch
 */
function saveTailscalePrefs(patch) {
	return saveTailscaleConfig(patch)
}

function logoutTailscale() {
	return runSudo([
		{ bin: '/usr/bin/tailscale', args: ['logout'] },
		{ bin: '/snap/bin/tailscale', args: ['logout'] },
	])
}

/**
 * @param {{ log?: Function }} [opts]
 */
async function maybeAutoLoginOnBoot(opts = {}) {
	const cfg = loadTailscaleConfig()
	if (!cfg.enabled || !cfg.autoLoginOnBoot) return { skipped: true }
	const st = getTailscaleStatus()
	if (st.connected) return { skipped: true, connected: true }
	if (!st.needsLogin && st.backendState === 'Running') return { skipped: true }
	const login = await startTailscaleLogin(cfg)
	if (typeof opts.log === 'function') {
		opts.log('info', `[tailscale] autoLoginOnBoot state=${login.state || st.backendState} auth=${login.authUrl ? 'yes' : 'no'}`)
	}
	if (cfg.operatorLoginAssist && login.authUrl) {
		try {
			spawnOperatorTailscaleLogin(login.authUrl)
		} catch (e) {
			if (typeof opts.log === 'function') opts.log('warn', `[tailscale] operator login spawn failed: ${e.message || e}`)
		}
	}
	return { ok: true, ...login }
}

module.exports = {
	getTailscaleStatus,
	getPublicTailscaleSummary,
	setTailscaleEnabled,
	startTailscaleLogin,
	spawnOperatorTailscaleLogin,
	saveTailscalePrefs,
	logoutTailscale,
	maybeAutoLoginOnBoot,
	loadTailscaleConfig,
	parseStatusJson,
	assertSafeAuthUrl,
}
