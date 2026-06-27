'use strict'

const os = require('os')
const { execFileSync } = require('child_process')
const { isAllowedEthernetIface } = require('../config/network-settings')

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
	return {
		interfaces,
		primaryInterface: primary,
		active,
		appliedMode: nm.mode,
		connectionName: nm.connection,
		configured: networkCfg || null,
	}
}

module.exports = {
	listEthernetInterfaces,
	buildNetworkStatus,
	readNmcliMode,
}
