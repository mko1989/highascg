'use strict'

/**
 * WO-692 — every NIC on the box, including the ones that are down (no cable, no address), and the Wi-Fi state.
 * `os.networkInterfaces()` (network-inventory.js) only reports interfaces that hold an address, so an unplugged port
 * never reached the GUI and could not be set up ahead of time. Here: /sys/class/net for the list, `ip -j -4 addr`
 * for the addresses, nmcli for each device's profile (mode, static values to pre-fill).
 *
 * Read-only. Every nmcli call here works without polkit rights (the server runs as a system service, no session):
 * listing devices / profiles / the cached scan. Rescan and connect go through the sudo helper.
 */

const fs = require('fs')
const { execFileSync } = require('child_process')
const { isAllowedEthernetIface } = require('../config/network-settings')

const SYS_NET = '/sys/class/net'
const WIFI_RE = /^wl[a-z0-9]+$/i

/** @param {string} name */
function isWifiIface(name) {
	return WIFI_RE.test(String(name || ''))
}

/**
 * @param {string} cmd
 * @param {string[]} args
 */
function run(cmd, args) {
	try {
		return execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
	} catch {
		return ''
	}
}

/** nmcli -t escapes ':' and '\' with a backslash; split on the unescaped colons. */
function splitTerse(line) {
	const out = []
	let cur = ''
	for (let i = 0; i < line.length; i++) {
		const c = line[i]
		if (c === '\\' && i + 1 < line.length) {
			cur += line[++i]
		} else if (c === ':') {
			out.push(cur)
			cur = ''
		} else cur += c
	}
	out.push(cur)
	return out
}

/** @param {string} name */
function readSys(name, file) {
	try {
		return fs.readFileSync(`${SYS_NET}/${name}/${file}`, 'utf8').trim()
	} catch {
		return null
	}
}

/** `ip -j -4 addr` → { ifname: [{ address, prefixLength }] } */
function parseIpAddr(text) {
	const out = {}
	let rows
	try {
		rows = JSON.parse(text || '[]')
	} catch {
		rows = []
	}
	for (const r of Array.isArray(rows) ? rows : []) {
		if (!r || !r.ifname) continue
		out[r.ifname] = (r.addr_info || [])
			.filter((a) => a && a.family === 'inet' && a.local)
			.map((a) => ({ address: a.local, prefixLength: Number(a.prefixlen) || 0 }))
	}
	return out
}

/** `nmcli -t -f DEVICE,TYPE,STATE,CONNECTION dev` → { device: { type, state, connection } } */
function parseNmDevices(text) {
	const out = {}
	for (const line of String(text || '').split('\n')) {
		if (!line.trim()) continue
		const [device, type, state, connection] = splitTerse(line)
		if (device) out[device] = { type: type || '', state: state || '', connection: connection || null }
	}
	return out
}

/**
 * `nmcli -t -f NAME,DEVICE,TYPE con show` → { device: profile }. An inactive profile (port down) lists no DEVICE, so
 * ours is also found by its name `highascg-<iface>` — the helper's naming (highascg-network-apply.sh).
 */
function parseNmProfiles(text) {
	const out = {}
	for (const line of String(text || '').split('\n')) {
		const [name, device, type] = splitTerse(line)
		if (!name) continue
		const dev = device || (name.startsWith('highascg-') && !name.startsWith('highascg-wifi-') ? name.slice(9) : '')
		if (dev && (!out[dev] || device)) out[dev] = { name, type: type || '' }
	}
	return out
}

/** `nmcli -t -f ipv4.method,ipv4.addresses,ipv4.gateway,ipv4.dns con show <name>` */
function parseProfileIpv4(text) {
	const kv = {}
	for (const line of String(text || '').split('\n')) {
		const i = line.indexOf(':')
		if (i > 0) kv[line.slice(0, i)] = line.slice(i + 1).trim()
	}
	const method = String(kv['ipv4.method'] || '').toLowerCase()
	const first = String(kv['ipv4.addresses'] || '').split(',')[0].trim()
	const [address, prefix] = first.split('/')
	return {
		mode: method === 'auto' ? 'dhcp' : method === 'manual' || method === 'link-local' ? 'static' : 'unknown',
		static: {
			address: address || '',
			prefixLength: Number(prefix) || 24,
			gateway: kv['ipv4.gateway'] && kv['ipv4.gateway'] !== '--' ? kv['ipv4.gateway'] : '',
			dns: String(kv['ipv4.dns'] || '')
				.split(',')
				.map((s) => s.trim())
				.filter((s) => s && s !== '--'),
		},
	}
}

/**
 * @param {{ names?: string[], exec?: (cmd: string, args: string[]) => string, sys?: (name: string, file: string) => string | null }} [deps]
 * @returns {Array<object>}
 */
function listNetworkInterfaces(deps = {}) {
	const exec = deps.exec || run
	const sys = deps.sys || readSys
	let names = deps.names
	if (!names) {
		try {
			names = fs.readdirSync(SYS_NET)
		} catch {
			names = []
		}
	}
	names = names.filter((n) => isAllowedEthernetIface(n) || isWifiIface(n)).sort()
	const addrs = parseIpAddr(exec('ip', ['-j', '-4', 'addr', 'show']))
	const devs = parseNmDevices(exec('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'dev']))
	const profiles = parseNmProfiles(exec('nmcli', ['-t', '-f', 'NAME,DEVICE,TYPE', 'con', 'show']))
	return names.map((name) => {
		const dev = devs[name] || null
		const connection = (dev && dev.connection) || (profiles[name] && profiles[name].name) || null
		const ipv4 = connection
			? parseProfileIpv4(exec('nmcli', ['-t', '-f', 'ipv4.method,ipv4.addresses,ipv4.gateway,ipv4.dns', 'con', 'show', connection]))
			: { mode: 'unknown', static: { address: '', prefixLength: 24, gateway: '', dns: [] } }
		const list = addrs[name] || []
		return {
			name,
			kind: isWifiIface(name) ? 'wifi' : 'ethernet',
			mac: sys(name, 'address') || '',
			operstate: sys(name, 'operstate'),
			carrier: sys(name, 'carrier') === '1',
			address: list[0] ? list[0].address : null,
			addresses: list,
			nmState: dev ? dev.state : 'unknown',
			connection,
			activeConnection: !!(dev && dev.connection),
			mode: ipv4.mode,
			static: ipv4.static,
		}
	})
}

/** `nmcli -t -f IN-USE,BSSID,SSID,SIGNAL,SECURITY,CHAN dev wifi list` → one row per SSID (strongest), sorted. */
function parseWifiList(text) {
	const best = new Map()
	for (const line of String(text || '').split('\n')) {
		if (!line.trim()) continue
		const [inUse, bssid, ssid, signal, security, chan] = splitTerse(line)
		if (!ssid) continue
		const row = {
			ssid,
			bssid: bssid || '',
			signal: Number(signal) || 0,
			security: security && security !== '--' ? security : '',
			channel: Number(chan) || 0,
			inUse: inUse === '*',
		}
		const prev = best.get(ssid)
		if (!prev || row.inUse || (!prev.inUse && row.signal > prev.signal)) best.set(ssid, row)
	}
	return [...best.values()].sort((a, b) => Number(b.inUse) - Number(a.inUse) || b.signal - a.signal)
}

/**
 * Wi-Fi state: radio, adapters (from listNetworkInterfaces) and the networks from NetworkManager's last scan.
 * @param {{ exec?: (cmd: string, args: string[]) => string, interfaces?: Array<object> }} [deps]
 */
function buildWifiStatus(deps = {}) {
	const exec = deps.exec || run
	const ifaces = (deps.interfaces || listNetworkInterfaces(deps)).filter((i) => i.kind === 'wifi')
	const radio = exec('nmcli', ['radio', 'wifi']).trim().toLowerCase()
	const networks = ifaces.length
		? parseWifiList(exec('nmcli', ['-t', '-f', 'IN-USE,BSSID,SSID,SIGNAL,SECURITY,CHAN', 'dev', 'wifi', 'list', '--rescan', 'no']))
		: []
	const connected = networks.find((n) => n.inUse) || null
	return {
		available: ifaces.length > 0,
		radio: radio === 'enabled' ? 'on' : radio === 'disabled' ? 'off' : 'unknown',
		adapters: ifaces,
		connected: connected ? connected.ssid : null,
		networks,
	}
}

module.exports = { isWifiIface, listNetworkInterfaces, buildWifiStatus }
