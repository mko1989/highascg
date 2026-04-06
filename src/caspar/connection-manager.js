'use strict'

const { EventEmitter } = require('events')
const { TcpClient } = require('./tcp-client')
const { AmcpProtocol, rejectAllPendingAmcpCallbacks } = require('./amcp-protocol')
const { AmcpClient } = require('./amcp-client')

/**
 * @typedef {object} ConnectionStatusPayload
 * @property {boolean} connected
 * @property {string} host
 * @property {number} port
 * @property {number} [at] - ms epoch
 * @property {string} [versionLine] - last successful VERSION response line
 * @property {string} [healthError] - last VERSION failure while socket still up
 * @property {string} [error] - transient TCP error message (if any)
 */

/**
 * Owns {@link TcpClient}, shared AMCP context, {@link AmcpProtocol}, {@link AmcpClient}.
 * Emits `status` for WebSocket broadcast and `error` for TCP errors.
 */
class ConnectionManager extends EventEmitter {
	/**
	 * @param {{
	 *   host?: string,
	 *   port?: number,
	 *   config?: { amcp_batch?: boolean },
	 *   log?: (level: string, msg: string) => void,
	 *   healthIntervalMs?: number,
	 *   initialBackoffMs?: number,
	 *   maxBackoffMs?: number,
	 * }} [options]
	 */
	constructor(options = {}) {
		super()
		this._host = options.host ?? '127.0.0.1'
		this._port = options.port ?? 5250
		this._log = options.log || ((level, msg) => level === 'error' && console.error(msg))
		/** 0 = disable periodic VERSION (default; version still set once on connect + query cycle) */
		this._healthIntervalMs = options.healthIntervalMs ?? 0

		this._tcp = new TcpClient({
			host: this._host,
			port: this._port,
			initialBackoffMs: options.initialBackoffMs,
			maxBackoffMs: options.maxBackoffMs,
		})

		this._context = {
			socket: this._tcp,
			response_callback: {},
			_pendingResponseKey: undefined,
			_amcpBatchDrain: null,
			config: options.config || {},
			log: this._log,
		}

		this._protocol = new AmcpProtocol({
			log: this._log,
			context: this._context,
		})

		this._amcp = new AmcpClient(this._context)

		/** @type {ReturnType<typeof setInterval> | null} */
		this._healthTimer = null
		this._destroyed = false
		this._started = false

		this._onData = (line) => this._protocol.handleLine(line)
		this._onConnected = () => this._handleConnected()
		this._onDisconnected = () => this._handleDisconnected()
		this._onTcpError = (err) => this._handleTcpError(err)
	}

	get tcp() {
		return this._tcp
	}

	get amcp() {
		return this._amcp
	}

	get protocol() {
		return this._protocol
	}

	/** Shared with AMCP stack — attach app state here if needed */
	get context() {
		return this._context
	}

	get host() {
		return this._host
	}

	get port() {
		return this._port
	}

	_bindSocket() {
		this._tcp.on('data', this._onData)
		this._tcp.on('connected', this._onConnected)
		this._tcp.on('disconnected', this._onDisconnected)
		this._tcp.on('error', this._onTcpError)
	}

	_unbindSocket() {
		this._tcp.removeListener('data', this._onData)
		this._tcp.removeListener('connected', this._onConnected)
		this._tcp.removeListener('disconnected', this._onDisconnected)
		this._tcp.removeListener('error', this._onTcpError)
	}

	_handleConnected() {
		this._protocol.reset()
		/** @type {ConnectionStatusPayload} */
		const payload = { connected: true, host: this._host, port: this._port, at: Date.now() }
		this.emit('status', payload)
		this._startHealthTimer()
		this._runHealthCheck().catch(() => {})
	}

	_handleDisconnected() {
		this._clearHealthTimer()
		this.emit('status', { connected: false, host: this._host, port: this._port, at: Date.now() })
	}

	_handleTcpError(err) {
		this.emit('error', err)
		/** Do not use `this._tcp.isConnected` here — error often fires before `close`, while the socket still reports open. */
		this.emit('status', {
			connected: false,
			host: this._host,
			port: this._port,
			at: Date.now(),
			error: err?.message || String(err),
		})
	}

	_clearHealthTimer() {
		if (this._healthTimer) {
			clearInterval(this._healthTimer)
			this._healthTimer = null
		}
	}

	_startHealthTimer() {
		this._clearHealthTimer()
		if (!this._healthIntervalMs) return
		this._healthTimer = setInterval(() => {
			this._runHealthCheck().catch(() => {})
		}, this._healthIntervalMs)
	}

	async _runHealthCheck() {
		if (!this._tcp.isConnected) return
		try {
			const r = await this._amcp.version()
			const versionLine = typeof r.data === 'string' ? r.data : undefined
			this.emit('status', {
				connected: true,
				host: this._host,
				port: this._port,
				at: Date.now(),
				versionLine,
			})
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			this.emit('status', {
				connected: true,
				host: this._host,
				port: this._port,
				at: Date.now(),
				healthError: msg,
			})
		}
	}

	/** Attach listeners and connect TCP (auto-reconnects until {@link stop}) */
	start() {
		if (this._destroyed || this._started) return
		this._started = true
		this._bindSocket()
		this._tcp.connect(this._host, this._port)
	}

	/** Stop health timer, disconnect TCP, remove listeners */
	stop() {
		if (!this._started) return
		this._started = false
		this._clearHealthTimer()
		this._tcp.disconnect()
		this._unbindSocket()
	}

	/** Permanently tear down TCP (no reuse) */
	destroy() {
		if (this._destroyed) return
		this._destroyed = true
		this._clearHealthTimer()
		rejectAllPendingAmcpCallbacks(this._context)
		this._unbindSocket()
		this._tcp.destroy()
		this.removeAllListeners()
	}

	/**
	 * Update host/port and reconnect if already started.
	 * @param {string} host
	 * @param {number} port
	 */
	reconnect(host, port) {
		this._host = host || this._host
		this._port = port || this._port
		if (this._started) {
			this._tcp.disconnect()
			this._tcp.connect(this._host, this._port)
		} else {
			this._tcp.host = this._host
			this._tcp.port = this._port
		}
	}
}

module.exports = { ConnectionManager }
