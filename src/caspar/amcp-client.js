'use strict'

const { EventEmitter } = require('events')
const { AmcpBasic } = require('./amcp-basic')
const { AmcpMixer } = require('./amcp-mixer')
const { AmcpCg } = require('./amcp-cg')
const { AmcpData } = require('./amcp-data')
const { AmcpQuery } = require('./amcp-query')
const { AmcpThumbnail } = require('./amcp-thumbnail')
const { AmcpBatch } = require('./amcp-batch')
const { AmcpSimulated } = require('./amcp-simulated')
const amcpClientStatic = require('./amcp-client-static')
const amcpClientTransport = require('./amcp-client-transport')
const amcpClientCommands = require('./amcp-client-commands')

class AmcpClient extends EventEmitter {
	/**
	 * @param {import('./amcp-protocol').AmcpConnectionContext} connection
	 */
	constructor(connection) {
		super()
		this._context = connection
		if (this._context._amcpSendQueue === undefined) {
			this._context._amcpSendQueue = Promise.resolve()
		}

		this.basic = new AmcpBasic(this)
		this.mixer = new AmcpMixer(this)
		this.cg = new AmcpCg(this)
		this.data = new AmcpData(this)
		this.query = new AmcpQuery(this)
		this.thumb = new AmcpThumbnail(this)
		this.batch = new AmcpBatch(this)
		this._simulated = new AmcpSimulated(this)
	}

	get isOffline() {
		return !!this._context.config?.offline_mode
	}

	get isConnected() {
		if (this.isOffline) return true
		return !!(this._context.socket && this._context.socket.isConnected)
	}
}

AmcpClient.QUIET_CMDS = amcpClientStatic.QUIET_CMDS
AmcpClient.SEND_TIMEOUT_MS = amcpClientStatic.SEND_TIMEOUT_MS
AmcpClient.LONG_RESPONSE_TIMEOUT_MS = amcpClientStatic.LONG_RESPONSE_TIMEOUT_MS
AmcpClient.resolveSendTimeoutMs = amcpClientStatic.resolveSendTimeoutMs

Object.assign(AmcpClient.prototype, amcpClientTransport, amcpClientCommands)

module.exports = { AmcpClient }
