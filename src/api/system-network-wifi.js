'use strict'

/**
 * WO-692 — Wi-Fi from the GUI: status (radio, adapters, last scan), rescan, connect (WPA passphrase), disconnect,
 * radio on / off. The server runs as a system service without a login session, so NetworkManager's polkit rules deny
 * it scanning and system-profile edits (`wifi.scan` / `settings.modify.system` need an active local session). Those
 * go through the same NOPASSWD helper as the Ethernet apply (`highascg-network-apply.sh wifi-*`). The passphrase is
 * passed on stdin, never in argv (argv shows in `ps`).
 */

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { buildWifiStatus, isWifiIface } = require('../system/network-interfaces')

const APPLY_SCRIPT = '/usr/local/lib/highascg/highascg-network-apply.sh'
const REPO_APPLY_SCRIPT = path.join(__dirname, '../../tools/runtime/highascg-network-apply.sh')

function reply(status, body) {
	return { status, headers: JSON_HEADERS, body: jsonBody(body) }
}

/** SSIDs are 1–32 bytes; refuse control characters (they would break the helper's argv / nmcli). */
function isValidSsid(ssid) {
	const s = String(ssid ?? '')
	// eslint-disable-next-line no-control-regex
	return s.length > 0 && Buffer.byteLength(s, 'utf8') <= 32 && !/[\x00-\x1f\x7f]/.test(s)
}

/** WPA-PSK: 8–63 printable characters, or 64 hex digits; empty = an open network. */
function isValidPsk(psk) {
	const s = String(psk ?? '')
	if (s === '') return true
	if (/^[0-9a-fA-F]{64}$/.test(s)) return true
	// eslint-disable-next-line no-control-regex
	return s.length >= 8 && s.length <= 63 && !/[\x00-\x1f\x7f]/.test(s)
}

/**
 * @param {string[]} args
 * @param {{ input?: string, timeout?: number, exec?: Function }} [opts]
 */
function runHelper(args, opts = {}) {
	const script = fs.existsSync(APPLY_SCRIPT) ? APPLY_SCRIPT : REPO_APPLY_SCRIPT
	const exec = opts.exec || execFileSync
	try {
		const log = exec('sudo', ['-n', script, ...args], {
			encoding: 'utf8',
			timeout: opts.timeout || 45000,
			input: opts.input ?? '',
		})
		return { ok: true, log: String(log || '') }
	} catch (e) {
		const err = e && typeof e === 'object' ? e : {}
		const text = String(err.stderr || err.stdout || err.message || e)
		const needsSudo = /password|a password is required|not allowed/i.test(text)
		const oldHelper = /Usage: .*dhcp\|static/.test(text) // helper on the box predates WO-692
		return {
			ok: false,
			status: needsSudo || oldHelper ? 503 : 500,
			error: oldHelper
				? 'The network helper on this box is older than Wi-Fi support — install the new one (see WO-692)'
				: needsSudo
					? 'Wi-Fi changes need passwordless sudo for highascg-network-apply.sh'
					: text.trim().split('\n').slice(-1)[0] || 'Wi-Fi command failed',
			log: text,
		}
	}
}

/** The adapter to use: the one asked for, else the first Wi-Fi adapter. */
function pickAdapter(b, status) {
	const asked = String(b?.interface || '').trim()
	if (asked) return isWifiIface(asked) ? asked : null
	return status.adapters[0]?.name || null
}

function handleWifiGet() {
	return reply(200, buildWifiStatus())
}

/**
 * @param {string} p
 * @param {string} body
 * @param {{ exec?: Function }} [deps]
 */
function handleWifiPost(p, body, deps = {}) {
	const b = parseBody(body) || {}
	const status = buildWifiStatus()
	if (p === '/api/system/network/wifi/radio') {
		const r = runHelper(['wifi-radio', b.on === false || b.on === 'off' ? 'off' : 'on'], deps)
		return r.ok ? reply(200, { ok: true, log: r.log, ...buildWifiStatus() }) : reply(r.status, r)
	}
	if (!status.available) return reply(404, { error: 'No Wi-Fi adapter on this machine' })
	const iface = pickAdapter(b, status)
	if (!iface) return reply(400, { error: 'Invalid Wi-Fi interface' })
	if (p === '/api/system/network/wifi/scan') {
		const r = runHelper(['wifi-scan', iface], { ...deps, timeout: 30000 })
		return r.ok ? reply(200, { ok: true, ...buildWifiStatus() }) : reply(r.status, r)
	}
	if (p === '/api/system/network/wifi/connect') {
		const ssid = String(b.ssid ?? '')
		const psk = String(b.password ?? '')
		if (!isValidSsid(ssid)) return reply(400, { error: 'Invalid network name (SSID)' })
		if (!isValidPsk(psk)) return reply(400, { error: 'The Wi-Fi password must be 8–63 characters' })
		const r = runHelper(['wifi-connect', iface, ssid], { ...deps, input: psk ? `${psk}\n` : '', timeout: 60000 })
		return r.ok ? reply(200, { ok: true, log: r.log, ...buildWifiStatus() }) : reply(r.status, r)
	}
	if (p === '/api/system/network/wifi/disconnect') {
		const r = runHelper(['wifi-disconnect', iface], deps)
		return r.ok ? reply(200, { ok: true, log: r.log, ...buildWifiStatus() }) : reply(r.status, r)
	}
	return null
}

module.exports = { handleWifiGet, handleWifiPost, isValidSsid, isValidPsk }
