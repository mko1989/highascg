/**
 * Server setup info: IPs, Tailscale, Syncthing URLs (read-only; for remote admin).
 */

'use strict'

const os = require('os')
const fs = require('fs')
const { execSync } = require('child_process')
const { JSON_HEADERS, jsonBody } = require('./response')

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

module.exports = { handleGet, readDisplayMode }
