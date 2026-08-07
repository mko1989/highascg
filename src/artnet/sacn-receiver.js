'use strict'

const { Receiver: SacnReceiverImpl } = require('sacn')
const { PATCH_CHANNEL_COUNT } = require('./artnet-constants')
const { DmxBorderReceiverBase } = require('./dmx-border-receiver-base')

class SacnReceiver extends DmxBorderReceiverBase {
	constructor(appCtx) {
		super(appCtx)
		this._stats.dmx = 0
	}

	static PATCH_CHANNEL_COUNT = PATCH_CHANNEL_COUNT

	_tag() {
		return '[sACN]'
	}

	_protocolName() {
		return 'sACN'
	}

	_defaultPort() {
		return 5568
	}

	_statsHead(s) {
		return `rx dmx=${s.dmx}`
	}

	_applyInitOverrides(resolved, options) {
		if (options.universe != null) resolved.universe = options.universe
		if (options.startChannel != null) resolved.startChannel = options.startChannel
		if (options.screenIndex != null) resolved.screenIndex = options.screenIndex
	}

	/* Unlike Art-Net (unconditional first bind), sACN only opens its receiver while listen is
	 * effectively on — both init and reconfigure go through the same lazy path. */
	_initTransport() {
		this._ensureListening()
	}

	_ensureListening() {
		if (!this._effectiveListen()) return
		if (this._socket) return

		try {
			this._socket = new SacnReceiverImpl({
				universes: [this._inputUniverse],
				port: this._inputPort,
				reuseAddr: true,
			})

			this._socket.on('packet', (packet) => {
				this._bumpStat('udp')
				this._handleSacnPacket(packet)
			})

			this._socket.on('error', (err) => {
				this._bumpStat('errors')
				this._throttledDropLog('sacn-error', `[sACN] Error: ${err?.message || err}`)
			})

			this.log('info', `[sACN] Receiver listening on universe ${this._inputUniverse}, port ${this._inputPort}`)
		} catch (err) {
			this._bumpStat('errors')
			this.log('error', `[sACN] Failed to initialize receiver: ${err?.message || err}`)
		}
	}

	_handleSacnPacket(packet) {
		if (!packet || !packet.payload) return
		if (packet.universe !== this._inputUniverse) {
			this._bumpStat('wrongUniverse')
			return
		}

		this._bumpStat('dmx')

		// Convert sACN payload object to a byte buffer
		// sACN payload is { 1: value, 2: value, ... } where keys are 1-based channel numbers
		const buffer = Buffer.alloc(512, 0)
		for (const [ch, val] of Object.entries(packet.payload)) {
			const chNum = parseInt(ch, 10)
			if (chNum >= 1 && chNum <= 512) {
				buffer[chNum - 1] = Math.min(255, Math.max(0, Math.round(val)))
			}
		}

		this.handleData(buffer)
	}
}

module.exports = { SacnReceiver }
