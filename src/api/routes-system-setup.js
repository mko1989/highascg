/**
 * Server setup info: IPs, Tailscale, Syncthing URLs (read-only; for remote admin).
 */

'use strict'

const os = require('os')
const fs = require('fs')
const { execSync, execFileSync } = require('child_process')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')

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
	} catch { /* ignore */ }
	return 'normal'
}

/**
 * @param {string} path
 * @param {object} ctx
 */
async function handleGet(path, ctx) {
	if (path !== '/api/system/setup') return null

	const httpPort = ctx.config?.server?.httpPort ?? 8080
	const interfaces = listIPv4Interfaces()
	const primary = interfaces[0]?.address || '127.0.0.1'

	let tailscale = { ipv4: null, statusLine: null, needsLogin: null }
	try {
		const ip = execSync('tailscale ip -4 2>/dev/null', { encoding: 'utf8', timeout: 4000 }).trim()
		tailscale.ipv4 = ip || null
	} catch {
		tailscale.ipv4 = null
	}
	// If CLI failed but tailscale0 has a CGNAT address (same as `ip addr`), treat as connected
	if (!tailscale.ipv4) {
		const tsIf = interfaces.find((i) => i.name === 'tailscale0' || /^100\./.test(i.address))
		if (tsIf) tailscale.ipv4 = tsIf.address
	}
	try {
		tailscale.statusLine = execSync('tailscale status --self 2>/dev/null | head -1', {
			encoding: 'utf8',
			timeout: 4000,
		}).trim()
	} catch {
		tailscale.statusLine = null
	}
	try {
		const st = execSync('tailscale status 2>/dev/null', { encoding: 'utf8', timeout: 4000 })
		tailscale.needsLogin = /NeedsLogin|Please log in|Log in/i.test(st)
	} catch {
		tailscale.needsLogin = !tailscale.ipv4
	}

	const syncthingGui = `http://${primary}:8384`
	const adminUrls = {
		highascg: `http://${primary}:${httpPort}/`,
		setupPage: `http://${primary}:${httpPort}/setup.html`,
		syncthing: syncthingGui,
		tailscaleAdmin: 'https://login.tailscale.com/admin/machines',
	}

	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			displayMode: readDisplayMode(),
			interfaces,
			primaryIp: primary,
			httpPort,
			tailscale,
			syncthing: {
				guiUrl: syncthingGui,
				note:
					'Syncthing does not auto-pair devices. Open this URL on a client on the same LAN or Tailnet, add a remote device ID, then accept the folder on each side.',
			},
			tailscaleInstructions: {
				summary:
					'Tailscale has no local web UI. On the server run: sudo tailscale up — then open the printed URL to log in. Use the admin link below to manage machines.',
				cliLogin: 'sudo tailscale up',
				webAdmin: adminUrls.tailscaleAdmin,
			},
			adminUrls,
		}),
	}
}

function checkNuclearPassword(body, ctx) {
	const cfgUi = ctx?.config?.ui && typeof ctx.config.ui === 'object' ? ctx.config.ui : {}
	const requirePassword = cfgUi.nuclearRequirePassword === true || cfgUi.nuclearRequirePassword === 'true'
	if (!requirePassword) return { ok: true }
	const expected = String(cfgUi.nuclearPassword || '')
	if (!expected) return { ok: false, status: 403, error: 'Nuclear password required but not configured.' }
	const b = parseBody(body)
	const provided = String(b?.password || '')
	if (provided !== expected) return { ok: false, status: 403, error: 'Invalid password.' }
	return { ok: true }
}

function runSudoNoPrompt(candidates) {
	let lastErr = null
	for (const c of candidates) {
		try {
			const out = execFileSync('sudo', ['-n', c.bin, ...c.args], { encoding: 'utf8', timeout: 15000 })
			return { ok: true, command: `${c.bin} ${c.args.join(' ')}`.trim(), output: String(out || '').trim() }
		} catch (e) {
			lastErr = e
		}
	}
	const msg = lastErr?.stderr ? String(lastErr.stderr).trim() : (lastErr?.message || 'Command failed')
	return { ok: false, error: msg }
}

async function handlePost(path, body, ctx) {
	if (path !== '/api/system/setup/restart-window-manager' && path !== '/api/system/setup/reboot') return null
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

module.exports = { handleGet, handlePost, readDisplayMode }
