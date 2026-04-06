'use strict'

const net = require('net')
const { EventEmitter } = require('events')

/**
 * Raw TCP client for CasparCG AMCP (replaces Companion TCPHelper).
 * Buffers incoming bytes and emits one `data` event per CRLF-delimited line (line without \r\n).
 *
 * Events: `connected`, `disconnected`, `error`, `data` (line: string)
 */
class TcpClient extends EventEmitter {
	/**
	 * @param {{ host?: string, port?: number, initialBackoffMs?: number, maxBackoffMs?: number }} [options]
	 */
	constructor(options = {}) {
		super()
		this.host = options.host ?? '127.0.0.1'
		this.port = options.port ?? 5250
		this._initialBackoffMs = options.initialBackoffMs ?? 1000
		this._maxBackoffMs = options.maxBackoffMs ?? 60000
		this._currentBackoffMs = this._initialBackoffMs

		/** @type {import('net').Socket | null} */
		this._socket = null
		this._receiveBuffer = ''
		/** @type {ReturnType<typeof setTimeout> | null} */
		this._reconnectTimer = null
		this._destroyed = false
		/** When true, close was intentional — no auto-reconnect */
		this._manualClose = false
	}

	get isConnected() {
		return !!(this._socket && this._socket.readyState === 'open')
	}

	/**
	 * @param {string} [host]
	 * @param {number} [port]
	 */
	connect(host, port) {
		if (this._destroyed) return
		if (host != null) this.host = host
		if (port != null) this.port = port
		this._manualClose = false
		this._clearReconnectTimer()
		this._currentBackoffMs = this._initialBackoffMs
		this._openSocket()
	}

	_openSocket() {
		if (this._destroyed) return
		this._destroySocketOnly()

		const socket = net.createConnection({ host: this.host, port: this.port })
		this._socket = socket

		socket.setKeepAlive(true, 15_000)

		socket.once('connect', () => {
			this._currentBackoffMs = this._initialBackoffMs
			this.emit('connected')
		})

		socket.on('data', (chunk) => {
			this._receiveBuffer += chunk.toString('utf8')
			let offset = 0
			let i = 0
			while ((i = this._receiveBuffer.indexOf('\r\n', offset)) !== -1) {
				const line = this._receiveBuffer.slice(offset, i)
				offset = i + 2
				this.emit('data', line)
			}
			this._receiveBuffer = this._receiveBuffer.slice(offset)
		})

		socket.on('error', (err) => {
			this.emit('error', err)
		})

		socket.on('close', () => {
			this._socket = null
			this._receiveBuffer = ''
			this.emit('disconnected')
			if (!this._manualClose && !this._destroyed) {
				this._scheduleReconnect()
			}
		})
	}

	_scheduleReconnect() {
		this._clearReconnectTimer()
		const delay = this._currentBackoffMs
		this._reconnectTimer = setTimeout(() => {
			this._reconnectTimer = null
			this._currentBackoffMs = Math.min(this._currentBackoffMs * 2, this._maxBackoffMs)
			this._openSocket()
		}, delay)
		if (this._reconnectTimer.unref) this._reconnectTimer.unref()
	}

	_clearReconnectTimer() {
		if (this._reconnectTimer) {
			clearTimeout(this._reconnectTimer)
			this._reconnectTimer = null
		}
	}

	_destroySocketOnly() {
		if (this._socket) {
			this._socket.removeAllListeners()
			this._socket.destroy()
			this._socket = null
		}
		this._receiveBuffer = ''
	}

	/**
	 * Send bytes to CasparCG. If `payload` is a string without trailing CRLF, `\r\n` is appended.
	 * @param {string | Buffer} payload
	 * @returns {boolean} From socket.write (buffer not full)
	 */
	send(payload) {
		if (!this.isConnected || !this._socket) {
			throw new Error('Not connected')
		}
		let buf
		if (Buffer.isBuffer(payload)) {
			buf = payload
		} else {
			const s = String(payload)
			buf = s.endsWith('\r\n') || s.endsWith('\n') ? Buffer.from(s, 'utf8') : Buffer.from(s + '\r\n', 'utf8')
		}
		return this._socket.write(buf)
	}

	/** Stop reconnecting and close the socket */
	disconnect() {
		this._manualClose = true
		this._clearReconnectTimer()
		const had = !!this._socket
		this._destroySocketOnly()
		if (had) this.emit('disconnected')
	}

	/** Permanently tear down — no further connect() */
	destroy() {
		this._destroyed = true
		this._manualClose = true
		this._clearReconnectTimer()
		const had = !!this._socket
		this._destroySocketOnly()
		if (had) this.emit('disconnected')
		this.removeAllListeners()
	}
}

module.exports = { TcpClient }
