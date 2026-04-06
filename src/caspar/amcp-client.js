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

	/**
	 * Send raw AMCP command and return Promise.
	 * @param {string} cmd - Full AMCP command
	 * @param {string} [responseKey] - Key for callback queue. Default: first word of cmd.
	 * @returns {Promise<{ ok: boolean, data?: string|string[] }>}
	 */
	_send(cmd, responseKey) {
		const self = this._context
		const key = (responseKey || cmd.trim().split(/\s+/)[0]).toUpperCase()

		if (this.isOffline) {
			return this._simulated.send(cmd)
		}

		if (!self.socket || !self.socket.isConnected) {
			return Promise.reject(new Error('Not connected'))
		}
		let rejectP
		const p = new Promise((resolve, reject) => {
			rejectP = reject
			if (self.response_callback[key] === undefined) self.response_callback[key] = []
			self.response_callback[key].push((a, b) => {
				if (a instanceof Error) return reject(a)
				const data = b !== undefined ? b : a
				resolve({ ok: true, data })
			})
		})
		self._amcpSendQueue = (self._amcpSendQueue || Promise.resolve())
			.then(() => {
				try {
					self._pendingResponseKey = key
					self.socket.send(cmd.trim() + '\r\n')
					return p
				} catch (e) {
					const err = e instanceof Error ? e : new Error(String(e))
					rejectP(err)
					throw err
				}
			})
			.catch(() => {})
		return p
	}

	// === Flat Convenience Aliases === //

	play(channel, layer, clip, opts) {
		return this.basic.play(channel, layer, clip, opts)
	}

	loadbg(channel, layer, clip, opts) {
		return this.basic.loadbg(channel, layer, clip, opts)
	}

	pause(channel, layer) {
		return this.basic.pause(channel, layer)
	}

	resume(channel, layer) {
		return this.basic.resume(channel, layer)
	}

	stop(channel, layer) {
		return this.basic.stop(channel, layer)
	}

	clear(channel, layer) {
		return this.basic.clear(channel, layer)
	}
	
	mixerFill(...args) {
		return this.mixer.mixerFill(...args)
	}

	mixerCommit(...args) {
		return this.mixer.mixerCommit(...args)
	}

	mixerOpacity(...args) {
		return this.mixer.mixerOpacity(...args)
	}

	mixerVolume(...args) {
		return this.mixer.mixerVolume(...args)
	}

	mixerClear(...args) {
		return this.mixer.mixerClear(...args)
	}

	cgAdd(...args) {
		return this.cg.cgAdd(...args)
	}

	cgUpdate(...args) {
		return this.cg.cgUpdate(...args)
	}

	cgPlay(...args) {
		return this.cg.cgPlay(...args)
	}

	cgStop(...args) {
		return this.cg.cgStop(...args)
	}

	cgNext(...args) {
		return this.cg.cgNext(...args)
	}

	cgRemove(...args) {
		return this.cg.cgRemove(...args)
	}

	version(component) {
		return this.query.version(component)
	}

	info(channel, layer) {
		return this.query.info(channel, layer)
	}

	diag() {
		return this.query.diag()
	}

	bye() {
		return this.query.bye()
	}

	thumbnailList(subDir) {
		return this.thumb.thumbnailList(subDir)
	}

	thumbnailRetrieve(filename) {
		return this.thumb.thumbnailRetrieve(filename)
	}

	thumbnailGenerate(filename) {
		return this.thumb.thumbnailGenerate(filename)
	}

	thumbnailGenerateAll() {
		return this.thumb.thumbnailGenerateAll()
	}

	raw(cmd) {
		const first = (cmd.trim().match(/^(\S+)/) || [])[1]
		return this._send(cmd, first)
	}

	/**
	 * BEGIN…COMMIT batch or sequential raw lines (see {@link AmcpBatch#batchSend}).
	 * @param {string[]} commandLines
	 * @param {{ force?: boolean }} [opts]
	 */
	batchSend(commandLines, opts) {
		return this.batch.batchSend(commandLines, opts)
	}
}

module.exports = { AmcpClient }
