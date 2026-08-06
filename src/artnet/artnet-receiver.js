'use strict'

const { PATCH_CHANNEL_COUNT, DMX_HYST } = require('./artnet-constants')
const { bindUdpSocket, ensureSocketListening } = require('./artnet-udp')
const { DmxBorderReceiverBase } = require('./dmx-border-receiver-base')

class ArtnetReceiver extends DmxBorderReceiverBase {
	constructor(appCtx) {
		super(appCtx)
		this._stats.artdmx = 0
	}

	static PATCH_CHANNEL_COUNT = PATCH_CHANNEL_COUNT
	static DMX_HYST = DMX_HYST

	_tag() {
		return '[ArtNet]'
	}

	_protocolName() {
		return 'Art-Net'
	}

	_defaultPort() {
		return 6454
	}

	_statsHead(s) {
		return `rx udp=${s.udp} artdmx=${s.artdmx}`
	}

	_applyInitOverrides(resolved, options) {
		if (options.universe != null) resolved.universe = options.universe
		if (options.subnet != null) resolved.subnet = options.subnet
		if (options.net != null) resolved.net = options.net
		if (options.startChannel != null) resolved.startChannel = options.startChannel
		if (options.screenIndex != null) resolved.screenIndex = options.screenIndex
	}

	/* Art-Net binds unconditionally at init (packets are dropped in onUdpMessage while listen
	 * is off); reconfigure re-binds lazily via ensureSocketListening. */
	_initTransport() {
		bindUdpSocket(this)
	}

	_ensureListening() {
		ensureSocketListening(this)
	}
}

module.exports = { ArtnetReceiver }
