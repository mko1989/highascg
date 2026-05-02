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
const { amcpVerboseTrace } = require('./amcp-utils')

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
	 * AMCP first-token commands whose outbound debug lines are suppressed unless {@link amcpVerboseTrace}.
	 * High-volume scene/PIP traffic (MIXER/CG/PLAY…) otherwise floods the log at debug level.
	 */
	static QUIET_CMDS = new Set([
		'CLS',
		'TLS',
		'THUMBNAIL',
		'VERSION',
		'DIAG',
		'MIXER',
		'CG',
		'PLAY',
		'LOADBG',
		'LOAD',
		'STOP',
		'CLEAR',
		'PAUSE',
		'RESUME',
		'SWAP',
		'ADD',
		'REMOVE',
	])

	/** Default timeout for short replies (PLAY, VERSION, etc.). Env: HIGHASCG_AMCP_SEND_TIMEOUT_MS */
	static SEND_TIMEOUT_MS = 15_000

	/** Longer timeout for INFO CONFIG, CLS, TLS, channel INFO XML, thumbnails — Caspar can block seconds on I/O. Env: HIGHASCG_AMCP_LONG_RESPONSE_MS */
	static LONG_RESPONSE_TIMEOUT_MS = 120_000

	/**
	 * @param {string} trimmed
	 * @returns {number}
	 */
	static resolveSendTimeoutMs(trimmed) {
		const rawDef = process.env.HIGHASCG_AMCP_SEND_TIMEOUT_MS
		const rawLong = process.env.HIGHASCG_AMCP_LONG_RESPONSE_MS
		const def =
			rawDef === undefined || rawDef === ''
				? AmcpClient.SEND_TIMEOUT_MS
				: parseInt(String(rawDef), 10)
		const longT =
			rawLong === undefined || rawLong === ''
				? AmcpClient.LONG_RESPONSE_TIMEOUT_MS
				: parseInt(String(rawLong), 10)
		const n = Number.isFinite(def) && def > 0 ? def : AmcpClient.SEND_TIMEOUT_MS
		const longN = Number.isFinite(longT) && longT > 0 ? longT : AmcpClient.LONG_RESPONSE_TIMEOUT_MS
		const u = trimmed.toUpperCase()
		if (
			u.startsWith('INFO ') ||
			u.startsWith('CLS') ||
			u.startsWith('TLS') ||
			u.startsWith('THUMBNAIL') ||
			u.startsWith('CINF') ||
			u.startsWith('FLS')
		) {
			return longN
		}
		return n
	}

	/**
	 * Shared send body for {@link #_send} and {@link #_sendAfter}.
	 * @param {string} cmd
	 * @param {string} [responseKey]
	 * @returns {{ p: Promise<{ ok: boolean, data?: string|string[] }>, execute: () => Promise<{ ok: boolean, data?: string|string[] }> }}
	 */
	_sendPrepare(cmd, responseKey) {
		const self = this._context
		const trimmed = cmd.trim()
		const key = (responseKey || trimmed.split(/\s+/)[0]).toUpperCase()
		const timeoutMs = AmcpClient.resolveSendTimeoutMs(trimmed)

		let resolveP, rejectP, settled = false
		/** @type {ReturnType<typeof setTimeout> | null} */
		let timeoutHandle = null

		const cb = (a, b) => {
			if (settled) return
			settled = true
			if (timeoutHandle) {
				clearTimeout(timeoutHandle)
				timeoutHandle = null
			}
			if (a instanceof Error) return rejectP(a)
			const data = b !== undefined ? b : a
			resolveP({ ok: true, data })
		}

		const p = new Promise((resolve, reject) => {
			resolveP = resolve
			rejectP = reject
			if (self.response_callback[key] === undefined) self.response_callback[key] = []
			self.response_callback[key].push(cb)
		})

		const execute = () => {
			try {
				if (settled) return p
				if (!self.socket || !self.socket.isConnected) {
					throw new Error('Not connected')
				}
				self._pendingResponseKey = key
				if (typeof self.log === 'function' && (amcpVerboseTrace() || !AmcpClient.QUIET_CMDS.has(key))) {
					self.log('debug', `AMCP → ${trimmed}`)
				}
				self.socket.send(trimmed + '\r\n')

				timeoutHandle = setTimeout(() => {
					if (settled) return
					settled = true
					timeoutHandle = null
					const arr = self.response_callback[key]
					if (arr) {
						const idx = arr.indexOf(cb)
						if (idx !== -1) arr.splice(idx, 1)
					}
					if (self._pendingResponseKey === key) self._pendingResponseKey = undefined
					try {
						if (typeof self._resetAmcpProtocol === 'function') self._resetAmcpProtocol()
					} catch (_) {
						/* non-fatal */
					}
					if (typeof self.log === 'function') {
						const isVersion = key === 'VERSION' || trimmed.toUpperCase().startsWith('VERSION')
						const hint = isVersion
							? ' — Caspar did not reply in time; AMCP is often blocked by a producer/GPU/thumbnail. Check casparcg-server log, restart Caspar if stuck. Optional env: HIGHASCG_AMCP_SEND_TIMEOUT_MS, HIGHASCG_AMCP_HEALTH_MS=0 (disable periodic VERSION).'
							: ''
						self.log('warn', `AMCP response timeout (${timeoutMs}ms): ${trimmed}${hint}`)
					}
					rejectP(new Error(`AMCP response timeout: ${trimmed}`))
				}, timeoutMs)

				return p
			} catch (e) {
				const arr = self.response_callback[key]
				if (arr) {
					const idx = arr.indexOf(cb)
					if (idx !== -1) arr.splice(idx, 1)
				}
				if (timeoutHandle) {
					clearTimeout(timeoutHandle)
					timeoutHandle = null
				}
				settled = true
				const err = e instanceof Error ? e : new Error(String(e))
				rejectP(err)
				throw err
			}
		}

		return { p, execute }
	}

	/**
	 * Send after `prevPromise` settles, without appending to `_amcpSendQueue` behind the pending tail.
	 * {@link #_send} always does `_amcpSendQueue = _amcpSendQueue.then(execute)`; calling `_send` from inside
	 * another `_amcpSendQueue` job deadlocks (inner send never runs). Used by AMCP batch pre-flush (mixer COMMIT).
	 * @param {Promise<unknown>} prevPromise
	 * @param {string} cmd
	 * @param {string} [responseKey]
	 * @returns {Promise<{ ok: boolean, data?: string|string[] }>}
	 */
	_sendAfter(prevPromise, cmd, responseKey) {
		if (this.isOffline) {
			return prevPromise.then(() => this._simulated.send(cmd))
		}
		const self = this._context
		if (!self.socket || !self.socket.isConnected) {
			return Promise.reject(new Error('Not connected'))
		}
		const { p, execute } = this._sendPrepare(cmd, responseKey)
		return prevPromise.then(execute)
	}

	/**
	 * Send raw AMCP command and return Promise.
	 * @param {string} cmd - Full AMCP command
	 * @param {string} [responseKey] - Key for callback queue. Default: first word of cmd.
	 * @returns {Promise<{ ok: boolean, data?: string|string[] }>}
	 */
	_send(cmd, responseKey) {
		const self = this._context

		if (this.isOffline) {
			return this._simulated.send(cmd)
		}

		if (!self.socket || !self.socket.isConnected) {
			return Promise.reject(new Error('Not connected'))
		}

		const { p, execute } = this._sendPrepare(cmd, responseKey)

		self._amcpSendQueue = (self._amcpSendQueue || Promise.resolve()).then(execute).catch(() => {})
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
	 * @param {{ skipMixerPreCommit?: boolean }} [opts]
	 */
	batchSend(commandLines, opts) {
		return this.batch.batchSend(commandLines, opts)
	}

	/**
	 * {@link AmcpBatch#batchSendChunked} — AMCP lines split per `resolveMaxBatchCommands` (see `amcp-batch.js`).
	 * @param {string[]} commandLines
	 * @param {{ skipMixerPreCommit?: boolean }} [opts]
	 */
	batchSendChunked(commandLines, opts) {
		return this.batch.batchSendChunked(commandLines, opts)
	}
}

module.exports = { AmcpClient }
