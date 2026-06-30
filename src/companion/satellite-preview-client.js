'use strict'

const net = require('net')
const { EventEmitter } = require('events')
const { parseSatelliteLine, formatSatelliteLine } = require('./satellite-protocol')
const { resolveCompanionConfig, locationKey, subIdForLocation, parseSubId } = require('./companion-config')
const { writePreviewJpeg, decodeSubStateText } = require('./button-preview-cache')

const PING_MS = 2000
const RECONNECT_MS = 3000

class SatellitePreviewClient extends EventEmitter {
	constructor() {
		super()
		/** @type {import('net').Socket | null} */
		this._socket = null
		this._rxBuf = ''
		this._connected = false
		this._subscriptionsSupported = false
		this._connecting = false
		/** @type {object | null} */
		this._config = null
		/** @type {Map<string, { count: number, page: number, row: number, column: number }>} */
		this._refs = new Map()
		/** @type {Map<string, Set<string>>} */
		this._sessions = new Map()
		/** @type {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>} */
		this._waitFirst = new Map()
		this._pingTimer = null
		this._reconnectTimer = null
		this._intentionalClose = false
	}

	getStatus() {
		const cfg = this._config
		let reason = null
		let hint = null
		if (!cfg?.satelliteEnabled) {
			reason = 'satellite_disabled'
			hint = 'Enable Satellite preview in HighAsCG Settings → Companion.'
		} else if (!this._connected) {
			reason = 'satellite_not_connected'
			hint = `Cannot reach Companion Satellite at ${cfg.satelliteHost}:${cfg.satellitePort} (TCP). Check Companion → Settings → Satellite is enabled.`
		} else if (!this._subscriptionsSupported) {
			reason = 'subscriptions_disabled'
			hint =
				'In Companion Settings, enable **Button Subscriptions API** (Satellite server alone is not enough). HighAsCG uses ADD-SUB for button previews — same API as the Elgato app.'
		}
		return {
			ok: true,
			previewAvailable: !!(cfg?.satelliteEnabled && this._connected && this._subscriptionsSupported),
			satelliteConnected: this._connected,
			subscriptionsSupported: this._subscriptionsSupported,
			subscriptions: this._refs.size,
			satelliteHost: cfg?.satelliteHost,
			satellitePort: cfg?.satellitePort,
			reason,
			hint,
		}
	}

	/**
	 * @param {object} config — ctx.config
	 */
	configure(config) {
		const next = resolveCompanionConfig(config)
		const changed =
			!this._config ||
			next.satelliteHost !== this._config.satelliteHost ||
			next.satellitePort !== this._config.satellitePort ||
			next.satelliteEnabled !== this._config.satelliteEnabled
		this._config = next
		if (changed && this._socket) {
			this._closeSocket(true)
			if (next.satelliteEnabled && this._refs.size > 0) void this._ensureConnected()
		}
	}

	/**
	 * @param {object} config
	 * @param {number} page
	 * @param {number} row
	 * @param {number} column
	 * @param {{ waitMs?: number }} [opts]
	 */
	async ensureSubscribed(config, page, row, column, opts) {
		const cfg = resolveCompanionConfig(config)
		if (!cfg.satelliteEnabled) return { ok: false, reason: 'satellite_disabled' }
		this.configure(config)
		const key = locationKey(page, row, column)
		const ref = this._refs.get(key)
		if (ref) {
			ref.count += 1
		} else {
			this._refs.set(key, { count: 1, page, row, column })
			const ok = await this._ensureConnected()
			if (!ok || !this._subscriptionsSupported) {
				this._refs.delete(key)
				const cfgNow = this._config || cfg
				let reason = 'satellite_unavailable'
				if (!cfgNow?.satelliteEnabled) reason = 'satellite_disabled'
				else if (!this._connected) reason = 'satellite_not_connected'
				else if (!this._subscriptionsSupported) reason = 'subscriptions_disabled'
				return { ok: false, reason, hint: this.getStatus().hint }
			}
			this._sendAddSub(cfg, page, row, column)
		}
		const waitMs = opts?.waitMs ?? 0
		if (waitMs > 0) {
			await this._waitForPreview(key, waitMs)
		}
		return { ok: true }
	}

	releaseSubscribed(page, row, column) {
		const key = locationKey(page, row, column)
		const ref = this._refs.get(key)
		if (!ref) return
		ref.count -= 1
		if (ref.count <= 0) {
			this._refs.delete(key)
			if (this._connected && this._subscriptionsSupported) {
				this._send(formatSatelliteLine('REMOVE-SUB', { SUBID: subIdForLocation(page, row, column) }))
			}
			if (this._refs.size === 0) this._closeSocket(true)
		}
	}

	/**
	 * @param {object} config
	 * @param {string} sessionId
	 * @param {number} page
	 * @param {{ rowMin?: number, rowMax?: number, colMin?: number, colMax?: number }} [grid]
	 */
	async subscribePageSession(config, sessionId, page, grid) {
		const cfg = resolveCompanionConfig(config)
		if (!cfg.satelliteEnabled) return { ok: false, reason: 'satellite_disabled' }
		this.configure(config)
		const size = cfg.pickerGridSize
		const rowMin = grid?.rowMin ?? 0
		const rowMax = grid?.rowMax ?? size - 1
		const colMin = grid?.colMin ?? 0
		const colMax = grid?.colMax ?? size - 1
		const keys = new Set()
		const coords = []
		for (let r = rowMin; r <= rowMax; r++) {
			for (let c = colMin; c <= colMax; c++) {
				coords.push({ row: r, column: c })
				keys.add(locationKey(page, r, c))
			}
		}
		const BATCH = 16
		for (let i = 0; i < coords.length; i += BATCH) {
			const chunk = coords.slice(i, i + BATCH)
			const results = await Promise.all(
				chunk.map(({ row, column }) => this.ensureSubscribed(config, page, row, column)),
			)
			const failed = results.find((r) => !r.ok)
			if (failed) return failed
		}
		this._sessions.set(sessionId, keys)
		return { ok: true, page, cells: keys.size }
	}

	unsubscribePageSession(sessionId) {
		const keys = this._sessions.get(sessionId)
		if (!keys) return
		for (const key of keys) {
			const [page, row, column] = key.split('/').map((x) => parseInt(x, 10))
			this.releaseSubscribed(page, row, column)
		}
		this._sessions.delete(sessionId)
	}

	_waitForPreview(key, waitMs) {
		const { readPreviewJpeg } = require('./button-preview-cache')
		const parts = key.split('/').map((x) => parseInt(x, 10))
		if (readPreviewJpeg(parts[0], parts[1], parts[2])) return Promise.resolve()
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this._waitFirst.delete(key)
				resolve()
			}, waitMs)
			this._waitFirst.set(key, { resolve, timer })
		})
	}

	async _ensureConnected() {
		if (!this._config?.satelliteEnabled) return false
		if (this._connected) return true
		if (this._connecting) {
			await this._waitReady(5000)
			return this._connected
		}
		this._connecting = true
		this._intentionalClose = false
		await new Promise((resolve) => {
			const socket = net.connect(
				{ host: this._config.satelliteHost, port: this._config.satellitePort },
				() => resolve(),
			)
			socket.setEncoding('utf8')
			socket.on('data', (chunk) => this._onData(chunk))
			socket.on('close', () => this._onClose())
			socket.on('error', () => {
				this._connecting = false
				resolve()
			})
			socket.setTimeout(5000, () => {
				socket.destroy()
				resolve()
			})
			this._socket = socket
		})
		this._connecting = false
		if (!this._connected) await this._waitReady(3000)
		return this._connected
	}

	_waitReady(ms) {
		if (this._connected) return Promise.resolve(true)
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.off('ready', onReady)
				resolve(false)
			}, ms)
			const onReady = () => {
				clearTimeout(timer)
				this.off('ready', onReady)
				resolve(true)
			}
			this.once('ready', onReady)
		})
	}

	_onData(chunk) {
		this._rxBuf += chunk
		let idx
		while ((idx = this._rxBuf.indexOf('\n')) !== -1) {
			const line = this._rxBuf.slice(0, idx).replace(/\r$/, '')
			this._rxBuf = this._rxBuf.slice(idx + 1)
			this._handleLine(line)
		}
	}

	_handleLine(line) {
		const parsed = parseSatelliteLine(line)
		if (!parsed) return
		const { command, args } = parsed

		if (command === 'BEGIN') {
			this._connected = true
			this._startPing()
			this.emit('ready')
			return
		}
		if (command === 'CAPS') {
			this._subscriptionsSupported = args.SUBSCRIPTIONS === '1' || args.SUBSCRIPTIONS === 'true'
			this._resubscribeAll()
			return
		}
		if (command === 'PING') {
			const payload = line.slice(line.indexOf(' ') + 1)
			this._send(`PONG ${payload}\n`)
			return
		}
		if (command === 'SUB-STATE') {
			this._handleSubState(args)
			return
		}
		if (command === 'ADD-SUB' && args.ERROR) {
			this.emit('warn', args.MESSAGE || 'ADD-SUB failed')
		}
	}

	_handleSubState(args) {
		const loc = parseSubId(args.SUBID)
		if (!loc) return
		const { page, row, column } = loc
		const key = locationKey(page, row, column)
		const text = decodeSubStateText(args.TEXT)
		const bitmapB64 = args.BITMAP
		let meta = { text, mtimeMs: Date.now(), width: 0, height: 0 }

		if (bitmapB64) {
			const rgb = Buffer.from(String(bitmapB64), 'base64')
			const size = this._config?.previewBitmapSize || 72
			const side = Math.round(Math.sqrt(rgb.length / 3)) || size
			const w = side
			const h = Math.max(1, Math.round(rgb.length / (w * 3)))
			try {
				meta = writePreviewJpeg(page, row, column, rgb, w, h, { text })
			} catch (e) {
				this.emit('warn', `preview cache write failed: ${e.message}`)
			}
		}

		const pending = this._waitFirst.get(key)
		if (pending) {
			clearTimeout(pending.timer)
			pending.resolve()
			this._waitFirst.delete(key)
		}

		this.emit('preview', {
			page,
			row,
			column,
			text,
			mtimeMs: meta.mtimeMs,
			url: require('./button-preview-cache').previewUrl(page, row, column),
		})
	}

	_resubscribeAll() {
		if (!this._connected || !this._subscriptionsSupported || !this._config) return
		for (const ref of this._refs.values()) {
			this._sendAddSub(this._config, ref.page, ref.row, ref.column)
		}
	}

	_sendAddSub(cfg, page, row, column) {
		this._send(
			formatSatelliteLine('ADD-SUB', {
				SUBID: subIdForLocation(page, row, column),
				LOCATION: `${page}/${row}/${column}`,
				BITMAP: cfg.previewBitmapSize,
				COLORS: 'hex',
				TEXT: 'true',
				TEXT_STYLE: 'true',
			}),
		)
	}

	_startPing() {
		this._stopPing()
		this._pingTimer = setInterval(() => {
			if (this._socket?.writable) this._send('PING highascg\n')
		}, PING_MS)
	}

	_stopPing() {
		if (this._pingTimer) {
			clearInterval(this._pingTimer)
			this._pingTimer = null
		}
	}

	_send(data) {
		try {
			if (this._socket?.writable) this._socket.write(data)
		} catch {
			/* ignore */
		}
	}

	/** Test / shutdown helper — release all subscriptions and close socket. */
	shutdown() {
		this._refs.clear()
		this._sessions.clear()
		for (const pending of this._waitFirst.values()) {
			clearTimeout(pending.timer)
			pending.resolve()
		}
		this._waitFirst.clear()
		this._closeSocket(true)
	}

	_onClose() {
		this._connected = false
		this._subscriptionsSupported = false
		this._socket = null
		this._stopPing()
		if (!this._intentionalClose && this._refs.size > 0) {
			if (!this._reconnectTimer) {
				this._reconnectTimer = setTimeout(() => {
					this._reconnectTimer = null
					void this._ensureConnected()
				}, RECONNECT_MS)
			}
		}
	}

	_closeSocket(intentional) {
		this._intentionalClose = intentional
		this._stopPing()
		if (this._reconnectTimer) {
			clearTimeout(this._reconnectTimer)
			this._reconnectTimer = null
		}
		if (this._socket) {
			try {
				this._socket.destroy()
			} catch {
				/* ignore */
			}
		}
		this._socket = null
		this._connected = false
	}
}

let _singleton = null

function getSatellitePreviewClient() {
	if (!_singleton) _singleton = new SatellitePreviewClient()
	return _singleton
}

module.exports = { SatellitePreviewClient, getSatellitePreviewClient }
