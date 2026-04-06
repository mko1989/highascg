'use strict'

const { EventEmitter } = require('events')

class AmcpSimulated extends EventEmitter {
	constructor(client) {
		super()
		this.client = client
	}

	get isConnected() {
		return true // Always "connected" in simulation
	}

	/**
	 * Simulated send always returns success (202 OK style)
	 */
	send(cmd) {
		console.log(`[AMCP SIM] Executing: ${cmd.trim()}`)
		const first = (cmd.trim().match(/^(\S+)/) || [])[1].toUpperCase()

		// Return dummy data for common query commands
		if (first === 'VERSION') return Promise.resolve({ ok: true, data: '2.4.0 (Simulated)' })
		if (first === 'INFO') return Promise.resolve({ ok: true, data: '' })
		if (first === 'CLS') return Promise.resolve({ ok: true, data: [] })
		if (first === 'TLS') return Promise.resolve({ ok: true, data: [] })
		if (first === 'DATA' && cmd.includes('LIST')) return Promise.resolve({ ok: true, data: [] })

		return Promise.resolve({ ok: true, data: '202 OK' })
	}
}

module.exports = { AmcpSimulated }
