'use strict'

const fs = require('fs')
const crypto = require('crypto')
const os = require('os')
const { execFileSync } = require('child_process')
const { isAllowedEthernetIface } = require('../config/network-settings')

const EXFAT_NETWORK_CONF = '/home/casparcg/exfat/network/network.conf'
const EXFAT_NETWORK_HASH = '/var/lib/highascg/last-exfat-network.hash'
const NETWORK_CONFIG_SOURCE = '/var/lib/highascg/network-config-source'

/**
 * @returns {Array<{ name: string, address: string | null, mac: string, internal: boolean, operstate: string | null }>}
 */
function listEthernetInterfaces() {
	const nets = os.networkInterfaces()
	const out = []
	for (const [name, entries] of Object.entries(nets)) {
		if (!isAllowedEthernetIface(name)) continue
		let address = null
		let mac = ''
		let internal = true
		for (const e of entries || []) {
			if (!e) continue
			if (e.mac && !mac) mac = e.mac
			if (e.family === 'IPv4') {
				internal = !!e.internal
				if (!e.internal && e.address) address = e.address
			}
		}
		out.push({
			name,
			address,
			mac,
			internal,
			operstate: readOperstate(name),
		})
	}
	return out
}

/**
 * @param {string} iface
 * @returns {string | null}
 */
function readOperstate(iface) {
	try {
		const fs = require('fs')
		const p = `/sys/class/net/${iface}/operstate`
		if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim()
	} catch {
		/* ignore */
	}
	return null
}

/**
 * @param {string} iface
 * @returns {{ mode: 'dhcp' | 'static' | 'unknown', connection: string | null }}
 */
function readNmcliMode(iface) {
	try {
		const out = execFileSync(
			'nmcli',
			['-t', '-f', 'NAME,DEVICE,TYPE', 'con', 'show', '--active'],
			{ encoding: 'utf8', timeout: 5000 },
		)
		let connection = null
		for (const line of out.split('\n')) {
			const parts = line.split(':')
			if (parts.length < 3) continue
			if (parts[1] === iface) {
				connection = parts[0] || null
				break
			}
		}
		if (!connection) {
			const all = execFileSync('nmcli', ['-t', '-f', 'NAME,DEVICE', 'con', 'show'], { encoding: 'utf8', timeout: 5000 })
			for (const line of all.split('\n')) {
				const [name, dev] = line.split(':')
				if (dev === iface && name) {
					connection = name
					break
				}
			}
		}
		if (!connection) return { mode: 'unknown', connection: null }
		const detail = execFileSync(
			'nmcli',
			['-t', '-f', 'ipv4.method', 'con', 'show', connection],
			{ encoding: 'utf8', timeout: 5000 },
		)
		const method = detail.split(':')[1]?.trim().toLowerCase() || ''
		if (method === 'auto') return { mode: 'dhcp', connection }
		if (method === 'manual' || method === 'link-local') return { mode: 'static', connection }
		return { mode: 'unknown', connection }
	} catch {
		return { mode: 'unknown', connection: null }
	}
}

/**
 * @param {string} filePath
 * @returns {string | null}
 */
function hashFileSync(filePath) {
	try {
		const buf = fs.readFileSync(filePath)
		return crypto.createHash('sha256').update(buf).digest('hex')
	} catch {
		return null
	}
}

/**
 * @param {object} [networkCfg]
 * @returns {{ source: 'exfat' | 'ui' | 'default', exfatConfPresent: boolean, exfatConfPath: string | null }}
 */
function resolveNetworkConfigSource(networkCfg) {
	let exfatConfPresent = false
	try {
		exfatConfPresent = fs.existsSync(EXFAT_NETWORK_CONF)
	} catch {
		/* fs probe failed — stays false */
	}

	let source = 'default'
	try {
		if (fs.existsSync(NETWORK_CONFIG_SOURCE)) {
			const recorded = fs.readFileSync(NETWORK_CONFIG_SOURCE, 'utf8').trim().toLowerCase()
			if (recorded === 'exfat' || recorded === 'ui') source = recorded
		}
	} catch {
		/* ignore */
	}

	if (source === 'default' && exfatConfPresent) {
		const cur = hashFileSync(EXFAT_NETWORK_CONF)
		let prev = null
		try {
			if (fs.existsSync(EXFAT_NETWORK_HASH)) {
				prev = fs.readFileSync(EXFAT_NETWORK_HASH, 'utf8').trim()
			}
		} catch {
			prev = null
		}
		if (cur && prev && cur === prev) source = 'exfat'
	}

	if (source === 'default') {
		const cfg = networkCfg && typeof networkCfg === 'object' ? networkCfg : null
		const hasUiConfig =
			!!cfg &&
			((cfg.primaryInterface && isAllowedEthernetIface(cfg.primaryInterface)) ||
				cfg.mode === 'static' ||
				(cfg.static && typeof cfg.static === 'object' && String(cfg.static.address || '').trim()))
		if (hasUiConfig) source = 'ui'
	}

	return {
		source,
		exfatConfPresent,
		exfatConfPath: exfatConfPresent ? EXFAT_NETWORK_CONF : null,
	}
}

/**
 * @param {object} [networkCfg]
 * @returns {object}
 */
function buildNetworkStatus(networkCfg) {
	const interfaces = listEthernetInterfaces()
	const primary =
		(networkCfg?.primaryInterface && isAllowedEthernetIface(networkCfg.primaryInterface)
			? networkCfg.primaryInterface
			: null) ||
		interfaces.find((i) => i.address && !i.internal)?.name ||
		interfaces[0]?.name ||
		null
	const active = primary ? interfaces.find((i) => i.name === primary) || null : null
	const nm = primary ? readNmcliMode(primary) : { mode: 'unknown', connection: null }
	const sourceInfo = resolveNetworkConfigSource(networkCfg)
	return {
		interfaces,
		primaryInterface: primary,
		active,
		appliedMode: nm.mode,
		connectionName: nm.connection,
		configured: networkCfg || null,
		source: sourceInfo.source,
		exfatConfPresent: sourceInfo.exfatConfPresent,
		exfatConfPath: sourceInfo.exfatConfPath,
	}
}

module.exports = {
	listEthernetInterfaces,
	buildNetworkStatus,
	readNmcliMode,
	resolveNetworkConfigSource,
	hashFileSync,
}
