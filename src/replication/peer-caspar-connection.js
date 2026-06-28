'use strict'

const { TcpClient } = require('../caspar/tcp-client')

/**
 * Leader → follower Caspar AMCP (send-only queue; responses drained and discarded).
 */
class PeerCasparConnection {
	/**
	 * @param {{ log?: Function }} [opts]
	 */
	constructor(opts = {}) {
		this._log = typeof opts.log === 'function' ? opts.log : () => {}
		/** @type {TcpClient|null} */
		this._tcp = null
		this._host = ''
		this._port = 5250
		this._sendQueue = Promise.resolve()
		this.connected = false
		this.lastError = ''
		this.commandsSent = 0
		this.lastSendAt = 0
		this._queueDepth = 0
		this.maxQueueDepth = 0
		this.correctionsSent = 0
		this._pendingJobs = 0
		this._maxPending = 128
		this._droppedBackpressure = 0
	}

	get queueDepth() {
		return this._queueDepth
	}

	get isConnected() {
		return !!(this._tcp && this._tcp.isConnected)
	}

	get endpoint() {
		return { host: this._host, port: this._port }
	}

	/**
	 * @param {string} host
	 * @param {number} port
	 */
	connect(host, port) {
		this.stop()
		this._host = String(host || '').trim()
		this._port = Math.max(1, parseInt(String(port ?? 5250), 10) || 5250)
		this._refusedLogged = false
		if (!this._host) return

		this._tcp = new TcpClient({
			host: this._host,
			port: this._port,
			initialBackoffMs: 2000,
			maxBackoffMs: 30000,
		})
		this._tcp.on('connected', () => {
			this.connected = true
			this.lastError = ''
			this._refusedLogged = false
			this._log('info', `[replication] peer Caspar AMCP connected ${this._host}:${this._port}`)
		})
		this._tcp.on('disconnected', () => {
			this.connected = false
		})
		this._tcp.on('error', (err) => {
			this.lastError = err?.message || String(err)
			const refused = /ECONNREFUSED/i.test(this.lastError)
			if (refused) {
				if (!this._refusedLogged) {
					this._refusedLogged = true
					this._log(
						'warn',
						`[replication] peer Caspar AMCP: ${this.lastError} (retrying until peer Caspar is up)`,
					)
				}
				return
			}
			this._log('warn', `[replication] peer Caspar AMCP: ${this.lastError}`)
		})
		this._tcp.on('data', () => {
			/* drain responses */
		})
		this._tcp.connect()
	}

	stop() {
		if (this._tcp) {
			this._tcp.disconnect()
			this._tcp = null
		}
		this.connected = false
		this._sendQueue = Promise.resolve()
		this._queueDepth = 0
		this._pendingJobs = 0
	}

	_bumpQueue() {
		this._pendingJobs += 1
		this._queueDepth = this._pendingJobs
		if (this._queueDepth > this.maxQueueDepth) this.maxQueueDepth = this._queueDepth
	}

	_dropQueue() {
		this._pendingJobs = Math.max(0, this._pendingJobs - 1)
		this._queueDepth = this._pendingJobs
	}

	_enqueue(job, opts = {}) {
		if (!opts.force && this._pendingJobs >= this._maxPending) {
			this._droppedBackpressure += 1
			this.lastError = 'peer Caspar send queue full'
			return false
		}
		this._bumpQueue()
		this._sendQueue = this._sendQueue
			.then(async () => {
				try {
					await job()
				} finally {
					this._dropQueue()
				}
			})
			.catch((e) => {
				this.lastError = e?.message || String(e)
				this._log('warn', `[replication] peer Caspar send: ${this.lastError}`)
			})
		return true
	}

	_writeRaw(payload) {
		if (!this._tcp || !this._tcp.isConnected) {
			throw new Error('peer Caspar not connected')
		}
		this._tcp.send(payload)
		this.commandsSent += 1
		this.lastSendAt = Date.now()
	}

	/**
	 * @param {string} cmd — single AMCP line without CRLF
	 */
	enqueueSend(cmd) {
		const trimmed = String(cmd || '').trim()
		if (!trimmed) return
		this._enqueue(async () => {
			this._writeRaw(`${trimmed}\r\n`)
		})
	}

	/**
	 * Playhead correction — bypasses backpressure cap (small volume).
	 * @param {string} cmd
	 */
	enqueueCorrection(cmd) {
		const trimmed = String(cmd || '').trim()
		if (!trimmed) return
		this._enqueue(
			async () => {
				this._writeRaw(`${trimmed}\r\n`)
				this.correctionsSent += 1
			},
			{ force: true },
		)
	}

	/**
	 * @param {string[]} lines — inner batch lines (no BEGIN/COMMIT)
	 */
	enqueueBatchLines(lines) {
		const clean = lines.map((l) => String(l).trim()).filter(Boolean)
		if (clean.length === 0) return
		const payload = ['BEGIN', ...clean, 'COMMIT'].join('\r\n') + '\r\n'
		this.enqueueRawPayload(payload)
	}

	/**
	 * @param {string} payload — full wire payload (may include BEGIN…COMMIT)
	 */
	enqueueRawPayload(payload) {
		const body = String(payload || '')
		if (!body.trim()) return
		this._enqueue(async () => {
			this._writeRaw(body.endsWith('\r\n') ? body : `${body}\r\n`)
		})
	}
}

module.exports = { PeerCasparConnection }
