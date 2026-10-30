'use strict'

/**
 * WO-836: is anything on this machine already bound to UDP `port`? (Linux /proc/net/udp{,6}; false elsewhere.)
 * The live box's Art-Net input owns :6454 — a smoke that must bind it (the port is fixed in src/fixtures/artdmx.js)
 * would share it and inject DMX into the lighting input, so it skips itself when the port is taken.
 */
const fs = require('fs')

function udpPortBusy(port) {
	const hex = Number(port).toString(16).toUpperCase().padStart(4, '0')
	for (const f of ['/proc/net/udp', '/proc/net/udp6']) {
		let text
		try {
			text = fs.readFileSync(f, 'utf8')
		} catch {
			continue
		}
		for (const line of text.split('\n').slice(1)) {
			const local = line.trim().split(/\s+/)[1] || ''
			if (local.endsWith(':' + hex)) return true
		}
	}
	return false
}

module.exports = { udpPortBusy }
