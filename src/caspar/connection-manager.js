'use strict'

const { EventEmitter } = require('events')
const { TcpClient } = require('./tcp-client')
const { AmcpProtocol, rejectAllPendingAmcpCallbacks } = require('./amcp-protocol')
const { AmcpClient } = require('./amcp-client')
const { CasparCG } = require('casparcg-connection')
const { AmcpConnectionAdapter } = require('./amcp-connection-adapter')

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
		/** Periodic VERSION liveness probe (ms); default 5000 = 5 sec; 0 = opt-out (disabled) */
		this._healthIntervalMs = options.healthIntervalMs ?? 5000
		/**
		 * Delay before the first `VERSION` after TCP connect (ms). Caspar often will not answer
		 * `VERSION` for ~1s while the AMCP session settles after disconnect/reconnect (e.g. systemd restart).
		 * 0 = previous behavior (immediate). Env: HIGHASCG_AMCP_CONNECT_SETTLE_MS (see index.js).
		 */
		this._healthConnectDelayMs =
			typeof options.healthConnectDelayMs === 'number' &&
			Number.isFinite(options.healthConnectDelayMs) &&
			options.healthConnectDelayMs >= 0
				? options.healthConnectDelayMs
				: 600

		this._tcp = new TcpClient({
			host: this._host,
			port: this._port,
			initialBackoffMs: options.initialBackoffMs,
			maxBackoffMs: options.maxBackoffMs,
		})

		const useLegacy = process.env.HIGHASCG_AMCP_LEGACY_TRANSPORT === '1'
		this._useLegacy = useLegacy

		if (!useLegacy) {
			this._ccg = new CasparCG({
				host: this._host,
				port: this._port,
				autoConnect: false,
			})
			this._adapter = new AmcpConnectionAdapter(this._ccg, { log: this._log })
			this._instrumentLibraryPlainAmcpSocket()
		}

		this._context = {
			socket: useLegacy ? this._tcp : this._adapter,
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

		/** After a send timeout, reset parser so late/partial multiline data cannot desync the next command. */
		this._context._resetAmcpProtocol = () => {
			if (this._protocol) this._protocol.reset()
		}

		/** @type {ReturnType<typeof setInterval> | null} */
		this._healthTimer = null
		this._destroyed = false
		this._started = false

		this._onData = (line) => {
			if (this._context._amcpBatchDrain) {
				this._context._amcpBatchDrain.onLine(line)
				return // intercepted
			}
			if (this._protocol) this._protocol.handleLine(line)
		}

		this._rawCcgBuffer = ''

		this._onConnected = () => this._handleConnected()
		this._onDisconnected = () => this._handleDisconnected()
		this._onTcpError = (err) => this._handleTcpError(err)
	}

	get tcp() {
		return this._tcp
	}

	/** True when AMCP transport can send (library `CasparCG.connected` or legacy {@link TcpClient}). */
	get isConnected() {
		if (this._destroyed || !this._started) return false
		if (this._useLegacy) return !!(this._tcp && this._tcp.isConnected)
		return !!(this._ccg && this._ccg.connected)
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

	/**
	 * Feed CRLF-delimited AMCP lines into {@link AmcpProtocol} or an active batch drain.
	 * @param {string | Buffer} chunk
	 */
	_feedPlainAmcpSocketData(chunk) {
		this._rawCcgBuffer += chunk.toString('utf-8')
		const newLines = this._rawCcgBuffer.split('\r\n')
		this._rawCcgBuffer = newLines.pop() || ''
		for (const line of newLines) {
			// Empty line terminates OKMULTIDATA (e.g. CLS); must not skip (legacy TcpClient emits it).
			if (this._context._amcpBatchDrain) {
				this._context._amcpBatchDrain.onLine(line)
			} else if (this._protocol) {
				this._protocol.handleLine(line)
			}
		}
	}

	/**
	 * Replace the library's REQ/RES parser so every TCP `data` chunk is handled by
	 * {@link AmcpProtocol}. Re-applied after each library `_setupSocket()` (reconnect).
	 */
	_instrumentLibraryPlainAmcpSocket() {
		if (this._useLegacy || !this._ccg?._connection) return
		const conn = this._ccg._connection
		if (conn._highascgPlainAmcpPatched) return
		conn._highascgPlainAmcpPatched = true
		const self = this
		// WO-845: casparcg-connection re-arms its own 5 s reconnect on every socket `close`, and the
		// library has no "stay down" switch — so stop()/destroy() could not stop the auto-reconnect and
		// the socket silently came back (then start() saw `connected` already true and never ran
		// _handleConnected). Veto the re-arm while this manager is stopped/destroyed.
		const origTrigger = conn._triggerReconnect.bind(conn)
		conn._triggerReconnect = function patchedTriggerReconnect() {
			if (!self._started || self._destroyed) return
			origTrigger()
		}
		const origSetup = conn._setupSocket.bind(conn)
		conn._setupSocket = function patchedSetupSocket() {
			origSetup()
			self._patchLibraryProcessIncomingData()
		}
		this._patchLibraryProcessIncomingData()
	}

	_patchLibraryProcessIncomingData() {
		if (this._useLegacy || !this._ccg?._connection) return
		const conn = this._ccg._connection
		if (!conn._highascgOrigProcessIncomingData) {
			conn._highascgOrigProcessIncomingData = conn._processIncomingData.bind(conn)
		}
		const orig = conn._highascgOrigProcessIncomingData
		const self = this
		conn._processIncomingData = function patchedProcessIncomingData(data) {
			try {
				orig(data)
			} catch (e) {
				self._log('error', 'Library AMCP parse: ' + (e?.message || e))
			}
			self._feedPlainAmcpSocketData(data)
		}
	}

	_bindSocket() {
		if (this._useLegacy) {
			this._tcp.on('data', this._onData)
			this._tcp.on('connected', this._onConnected)
			this._tcp.on('disconnected', this._onDisconnected)
			this._tcp.on('error', this._onTcpError)
		} else {
			this._ccg.on('connect', this._onConnected)
			this._ccg.on('disconnect', this._onDisconnected)
			this._ccg.on('error', this._onTcpError)
		}
	}

	_unbindSocket() {
		if (this._useLegacy) {
			this._tcp.removeListener('data', this._onData)
			this._tcp.removeListener('connected', this._onConnected)
			this._tcp.removeListener('disconnected', this._onDisconnected)
			this._tcp.removeListener('error', this._onTcpError)
		} else {
			this._ccg.removeListener('connect', this._onConnected)
			this._ccg.removeListener('disconnect', this._onDisconnected)
			this._ccg.removeListener('error', this._onTcpError)
		}
	}

	async _handleConnected() {
		if (this._protocol) this._protocol.reset()
		if (!this._useLegacy) this._patchLibraryProcessIncomingData()
		this._startHealthTimer()
		const d = this._healthConnectDelayMs
		if (d > 0) await new Promise((r) => setTimeout(r, d))
		let connected = true
		let versionLine
		let healthError
		if (this._useLegacy) {
			connected = !!(this._tcp && this._tcp.isConnected)
		} else if (this._amcp) {
			try {
				const r = await this._amcp.version()
				versionLine =
					typeof r.data === 'string'
						? r.data
						: Array.isArray(r.data)
							? r.data.join('\n')
							: undefined
			} catch (e) {
				connected = false
				healthError = e instanceof Error ? e.message : String(e)
				this._log('warn', `AMCP connect probe failed: ${healthError}`)
			}
		}
		/** @type {ConnectionStatusPayload} */
		const payload = { connected, host: this._host, port: this._port, at: Date.now(), versionLine, healthError }
		this.emit('status', payload)
		if (connected && !this._healthIntervalMs) {
			this._runHealthCheck().catch(() => {})
		}
	}

	_handleDisconnected() {
		this._clearHealthTimer()
		this._rawCcgBuffer = ''
		rejectAllPendingAmcpCallbacks(this._context)
		if (this._protocol) this._protocol.reset()
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
		const isConn = this._useLegacy ? this._tcp.isConnected : this._ccg.connected
		if (!isConn) return
		try {
			const r = await this._amcp.version()
			const versionLine =
				typeof r.data === 'string'
					? r.data
					: Array.isArray(r.data)
						? r.data.join('\n')
						: undefined
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

	/**
	 * WO-845: kill the library's socket + pending reconnect timer outright. `_ccg.disconnect()` only
	 * half-closes (`socket.end()`), and its `close` handler re-arms a 5 s reconnect.
	 */
	_haltLibraryConnection() {
		const conn = this._ccg?._connection
		if (!conn) return
		if (conn._reconnectTimeout) {
			clearTimeout(conn._reconnectTimeout)
			conn._reconnectTimeout = undefined
		}
		try {
			if (conn._socket && !conn._socket.destroyed) conn._socket.destroy()
		} catch (_) {
			/* non-fatal */
		}
	}

	/**
	 * WO-845: forget the previous connection's in-flight state (the library's own 'disconnect' is async
	 * and, after stop()/reconnect(), no longer reaches {@link _handleDisconnected}).
	 */
	_dropConnectionState() {
		this._rawCcgBuffer = ''
		rejectAllPendingAmcpCallbacks(this._context)
		if (this._protocol) this._protocol.reset()
	}

	/** Attach listeners and connect TCP (auto-reconnects until {@link stop}) */
	start() {
		if (this._destroyed || this._started) return
		this._started = true
		this._bindSocket()
		if (this._useLegacy) this._tcp.connect(this._host, this._port)
		else {
			// WO-845: a library that still believes it is connected would emit no 'connect' for the new
			// socket, so _handleConnected (status + health timer) would never run. Make the flag honest.
			if (this._ccg._connection._connected) this._ccg._connection._connected = false
			this._ccg.connect(this._host, this._port)
		}
	}

	/** Stop health timer, disconnect TCP, remove listeners */
	stop() {
		if (!this._started) return
		this._started = false
		this._clearHealthTimer()
		if (this._useLegacy) this._tcp.disconnect()
		else {
			this._ccg.disconnect()
			this._haltLibraryConnection()
			// The library's 'disconnect' fires after we unbind below, so settle waiters ourselves.
			if (this._ccg._connection) this._ccg._connection._connected = false
			this._dropConnectionState()
		}
		this._unbindSocket()
	}

	/** Permanently tear down TCP (no reuse) */
	destroy() {
		if (this._destroyed) return
		this._destroyed = true
		this._clearHealthTimer()
		rejectAllPendingAmcpCallbacks(this._context)
		this._unbindSocket()
		if (this._useLegacy) this._tcp.destroy()
		else {
			// WO-845: CasparCG.discard() is the AMCP DISCARD command, NOT BasicCasparCGAPI.discard() — the
			// old call left the socket open and the library's timeout interval running.
			this._haltLibraryConnection()
			clearInterval(this._ccg._timeoutTimer)
		}
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
			if (this._useLegacy) {
				this._tcp.disconnect()
				this._tcp.connect(this._host, this._port)
			} else {
				// WO-845: changeConnection destroys the old socket with its listeners removed → no 'disconnect',
				// so waiters ran out their timeout and no 'connect' fired for the new socket.
				this._dropConnectionState()
				if (this._ccg._connection._connected) this._ccg._connection._connected = false
				this._ccg.connect(this._host, this._port)
			}
		} else {
			if (this._useLegacy) {
				this._tcp.host = this._host
				this._tcp.port = this._port
			} else {
				// WO-845: the `host`/`port` setters call changeConnection → open a socket on a manager that was
				// never started (and in offline mode). Only record the target; start() connects.
				this._ccg._host = this._host
				this._ccg._port = this._port
				this._ccg._connection.host = this._host
				this._ccg._connection.port = this._port
			}
		}
	}
}

module.exports = { ConnectionManager }
