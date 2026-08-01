'use strict'

const osc = require('osc')
const { OscState } = require('./osc-state')
const { createFloatEndianNormalizer } = require('./osc-float-endian')

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
		/** @type {{ received: number, lastAt: number | null }} */
		this._stats = { received: 0, lastAt: null }
		/**
		 * First 40 distinct addresses seen, then frozen (WO-401 F1: the old last-40 ring did a
		 * 40-string `includes` scan per message — ~1.2 % of a core at the measured 18.6k msg/s,
		 * for a diagnostics-only field). Once saturated the hot path is two integer ops.
		 * @type {Set<string>}
		 */
		this._sampleAddresses = new Set()
	}

	_record(addr) {
		this._stats.received++
		this._stats.lastAt = Date.now()
		if (!addr) return
		if (this._sampleAddresses.size < 40) this._sampleAddresses.add(addr)
	}

	/** @returns {{ received: number, lastAt: number | null, sampleAddresses: string[], floatByteOrder: string }} */
	getStats() {
		return {
			received: this._stats.received,
			lastAt: this._stats.lastAt,
			sampleAddresses: [...this._sampleAddresses],
			floatByteOrder: this._endian ? this._endian.getMode() : 'auto',
		}
	}

	start() {
		if (!this._config.enabled) return
		const udpPort = new osc.UDPPort({
			localAddress: this._config.listenAddress,
			localPort: this._config.listenPort,
		})
		this._port = udpPort

		// Fix the 2.6-dev binary's little-endian OSC floats BEFORE osc.js parses them: the port's
		// "raw" event fires synchronously on the exact byte array readPacket then decodes (see
		// node_modules/osc/src/osc-transports.js decodeOSC), so an in-place swap here corrects
		// every downstream 'message'/'bundle' value. See src/osc/osc-float-endian.js.
		const endian = createFloatEndianNormalizer(this._config.floatByteOrder || 'auto', this._log)
		this._endian = endian
		udpPort.on('raw', (data) => endian.normalize(data))

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
