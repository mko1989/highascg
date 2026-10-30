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

	/** sACN universes are 1..63999 (WO-845b: they were clamped to the Art-Net 0..15). */
	_universeRange() {
		return [1, 63999]
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

	/** Seam for tests (the `sacn` Receiver binds a real socket). */
	_createTransport(opts) {
		return new SacnReceiverImpl(opts)
	}

	/** Close the current transport and forget what it was bound to, so the next _ensureListening() rebinds. */
	_closeTransport() {
		const old = this._socket
		this._socket = null
		this._boundUniverse = null
		this._boundPort = null
		if (!old) return
		try {
			old.removeAllListeners('packet')
			old.on('error', () => {}) // a late socket error after close() must not throw
			old.close()
		} catch (_) {
			/* already closed */
		}
	}

	_ensureListening() {
		if (!this._effectiveListen()) return
		if (this._socket) {
			// WO-845b: the multicast membership is fixed at construction — a universe (or port) change
			// used to leave the old group joined and the new one never subscribed.
			if (this._boundUniverse === this._inputUniverse && this._boundPort === this._inputPort) return
			this.log(
				'info',
				`[sACN] Universe ${this._boundUniverse}:${this._boundPort} → ${this._inputUniverse}:${this._inputPort} — re-subscribing`
			)
			this._closeTransport()
		}

		try {
			const transport = this._createTransport({
				universes: [this._inputUniverse],
				port: this._inputPort,
				reuseAddr: true,
			})
			this._socket = transport
			this._boundUniverse = this._inputUniverse
			this._boundPort = this._inputPort

			transport.on('packet', (packet) => {
				this._bumpStat('udp')
				this._handleSacnPacket(packet)
			})

			transport.on('error', (err) => {
				this._bumpStat('errors')
				this._throttledDropLog('sacn-error', `[sACN] Error: ${err?.message || err}`)
				// A failed bind leaves a dead socket that would block every later retry.
				if (err?.syscall === 'bind' && this._socket === transport) {
					this._bindError = err?.message || String(err)
					this._closeTransport()
				}
			})

			this._bindError = null
			this.log('info', `[sACN] Receiver listening on universe ${this._inputUniverse}, port ${this._inputPort}`)
		} catch (err) {
			this._bumpStat('errors')
			this._bindError = err?.message || String(err)
			this._closeTransport()
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

		// Convert the sACN packet to a 0-255 byte buffer.
		// WO-845: `Packet.payload` of the sacn lib is PERCENT (0-100, `val / 2.55`, zero channels omitted) —
		// storing it as 0-255 made DMX 255 read 100 (opacity 0.39, enable never above the sticky threshold
		// so the border was always OFF). Prefer the raw bytes (`payloadAsBuffer`, parsed packets always
		// carry it); the percent object is converted back as a fallback.
		const buffer = Buffer.alloc(512, 0)
		const raw = Buffer.isBuffer(packet.payloadAsBuffer) ? packet.payloadAsBuffer : null
		if (raw) {
			raw.copy(buffer, 0, 0, Math.min(512, raw.length))
		} else {
			// sACN payload is { 1: percent, 2: percent, ... } where keys are 1-based channel numbers
			for (const [ch, pct] of Object.entries(packet.payload)) {
				const chNum = parseInt(ch, 10)
				if (chNum >= 1 && chNum <= 512) {
					buffer[chNum - 1] = Math.min(255, Math.max(0, Math.round(Number(pct) * 2.55)))
				}
			}
		}

		this.handleData(buffer)
	}
}

module.exports = { SacnReceiver }
