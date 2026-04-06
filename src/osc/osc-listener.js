'use strict'

const osc = require('osc')
const { OscState } = require('./osc-state')

/**
 * UDP OSC receiver → {@link OscState}.
 */
class OscListener {
	/**
	 * @param {Record<string, unknown>} config - normalized osc block from {@link normalizeOscConfig}
	 * @param {(level: string, msg: string) => void} log
	 * @param {InstanceType<typeof OscState>} oscState
	 */
	constructor(config, log, oscState) {
		this._config = config
		this._log = log
		this._oscState = oscState
		/** @type {import('osc').UDPPort | null} */
		this._port = null
		/** @type {{ received: number, lastAt: number | null, sampleAddresses: string[] }} */
		this._stats = { received: 0, lastAt: null, sampleAddresses: [] }
	}

	_record(addr) {
		this._stats.received++
		this._stats.lastAt = Date.now()
		if (!addr) return
		const s = this._stats.sampleAddresses
		if (!s.includes(addr)) {
			s.push(addr)
			if (s.length > 40) s.shift()
		}
	}

	/** @returns {{ received: number, lastAt: number | null, sampleAddresses: string[] }} */
	getStats() {
		return {
			received: this._stats.received,
			lastAt: this._stats.lastAt,
			sampleAddresses: [...this._stats.sampleAddresses],
		}
	}

	start() {
		if (!this._config.enabled) return
		const udpPort = new osc.UDPPort({
			localAddress: this._config.listenAddress,
			localPort: this._config.listenPort,
		})
		this._port = udpPort

		udpPort.on('message', (packet) => {
			try {
				if (packet && packet.address) {
					this._record(packet.address)
					this._oscState.handleOscMessage(packet)
				}
			} catch (e) {
				this._log('debug', 'OSC handle error: ' + (e?.message || e))
			}
		})

		udpPort.on('bundle', (bundle) => {
			try {
				if (bundle.packets) {
					for (const p of bundle.packets) {
						if (p.address) {
							this._record(p.address)
							this._oscState.handleOscMessage(p)
						}
					}
				}
			} catch (e) {
				this._log('debug', 'OSC bundle error: ' + (e?.message || e))
			}
		})

		udpPort.on('error', (err) => {
			this._log('warn', 'OSC UDP: ' + (err?.message || err))
		})

		udpPort.open()
		this._log('info', `[OSC] UDP listening on ${this._config.listenAddress}:${this._config.listenPort}`)
	}

	stop() {
		if (this._port) {
			try {
				this._port.close()
			} catch (_) {}
			this._port = null
		}
	}
}

module.exports = { OscListener }
