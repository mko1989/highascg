'use strict'

const dmxnet = require('dmxnet')
const sacn = require('sacn')

class DmxOutput {
	constructor(logger) {
		this.log = logger
		this.artnet = null
		this.sacnSenders = new Map() // Key: universe:destination
		this.artnetSenders = new Map() // Key: universe:destination
	}

	initArtNet(options = {}) {
		if (this.artnet) return
		this.artnet = new dmxnet.dmxnet({
			log: { level: 'error' },
			...options
		})
	}

	/**
	 * @param {Object} fixture 
	 * @param {number[]} data 
	 */
	send(fixture, data) {
		const { universe, destination, protocol, startChannel } = fixture
		// Art-Net (dmxnet): cache key must match clamped universe 0–15
		const u = Number(universe)
		const artNetUni = Number.isFinite(u) ? Math.max(0, Math.min(15, Math.floor(u))) : 0
		const key =
			protocol === 'sacn'
				? `${universe}:${destination || 'broadcast'}`
				: `${artNetUni}:${destination || 'broadcast'}`

		if (protocol === 'sacn') {
			this._sendSacn(key, universe, destination, startChannel, data)
		} else {
			this._sendArtNet(key, artNetUni, destination, startChannel, data)
		}
	}

	_sendArtNet(key, universe, destination, startChannel, data) {
		if (!this.artnet) this.initArtNet()

		const start = Math.max(1, Math.min(512, Number(startChannel) || 1))

		let sender = this.artnetSenders.get(key)
		if (!sender) {
			try {
				sender = this.artnet.newSender({
					ip: destination || '255.255.255.255',
					universe,
					net: 0,
					subnet: 0,
				})
				this.artnetSenders.set(key, sender)
			} catch (e) {
				this.log('error', `[DMX] Art-Net sender failed: ${e?.message || e}`)
				throw e
			}
		}

		// ArtNet index is 0-based in dmxnet; channels are 0–511
		for (let i = 0; i < data.length; i++) {
			const ch = start - 1 + i
			if (ch < 0 || ch > 511) continue
			sender.setChannel(ch, Math.max(0, Math.min(255, Math.round(data[i]))))
		}
	}

	_sendSacn(key, universe, destination, startChannel, data) {
		const start = Math.max(1, Math.min(512, Number(startChannel) || 1))

		let sender = this.sacnSenders.get(key)
		if (!sender) {
			sender = new sacn.Sender({
				universe: Number(universe) || 1,
				destination: destination // if null, it uses multicast
			})
			this.sacnSenders.set(key, sender)
		}

		const dmxPayload = {}
		for (let i = 0; i < data.length; i++) {
			const addr = start + i
			if (addr > 512) break
			dmxPayload[addr] = Math.max(0, Math.min(255, Math.round(data[i])))
		}
		sender.send({ payload: dmxPayload })
	}

	stop() {
		for (const sender of this.sacnSenders.values()) {
			// sacn package might not have explicit stop if it's just UDP
		}
		this.sacnSenders.clear()
		
		// dmxnet cleanup
		this.artnetSenders.clear()
		// no explicit stop for dmxnet object usually
	}
}

module.exports = { DmxOutput }
