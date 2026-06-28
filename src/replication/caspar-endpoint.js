'use strict'

const os = require('os')

function localPrimaryIp() {
	for (const list of Object.values(os.networkInterfaces())) {
		if (!list) continue
		for (const iface of list) {
			if (iface && !iface.internal && iface.family === 'IPv4') return iface.address
		}
	}
	return '127.0.0.1'
}

/**
 * Caspar AMCP endpoint reachable from a replication peer (not loopback when paired over LAN).
 * @param {object} config
 * @returns {{ host: string, port: number }}
 */
function getCasparEndpointForPeer(config) {
	const rawHost = String(config?.caspar?.host || '127.0.0.1').trim() || '127.0.0.1'
	const port = Math.max(1, Math.min(65535, parseInt(String(config?.caspar?.port ?? 5250), 10) || 5250))
	const host =
		rawHost === '127.0.0.1' || rawHost === 'localhost' || rawHost === '::1' ? localPrimaryIp() : rawHost
	return { host, port }
}

module.exports = { getCasparEndpointForPeer, localPrimaryIp }
