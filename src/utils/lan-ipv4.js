'use strict'

const os = require('os')

/** Non-loopback IPv4 addresses, sorted unique. */
function getLanIPv4Addresses() {
	const nets = os.networkInterfaces()
	const out = []
	for (const name of Object.keys(nets)) {
		for (const a of nets[name] || []) {
			const fam = a.family
			const isV4 = fam === 'IPv4' || fam === 4
			if (isV4 && !a.internal) out.push(a.address)
		}
	}
	return [...new Set(out)].sort()
}

module.exports = { getLanIPv4Addresses }
