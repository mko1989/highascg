/**
 * WebSocket client for CasparCG module real-time state.
 * Connects to /api/ws or /ws, receives state + change events.
 * @see main_plan.md Prompt 11
 */

import { getWsUrl } from './api-origin.js'

export { getWsUrl } from './api-origin.js'

/**
 * Exponential backoff with jitter for reconnect scheduling (WO-104).
 * @param {number} attempt 1-based reconnect attempt
 * @param {{ baseInterval?: number, maxInterval?: number, jitterMax?: number }} [opts]
 */
export function computeWsReconnectDelay(attempt, opts = {}) {
	const baseInterval = opts.baseInterval ?? 1000
	const maxInterval = opts.maxInterval ?? 30000
	const jitterMax = opts.jitterMax ?? 1000
	const n = Math.max(1, attempt)
	const exp = Math.min(maxInterval, baseInterval * 2 ** Math.min(n - 1, 5))
	const jitter = Math.floor(Math.random() * Math.min(jitterMax, exp * 0.2))
	return exp + jitter
}

export class WsClient {
	constructor(options = {}) {
		this.url = options.url || getWsUrl()
		this.reconnectInterval = options.reconnectInterval ?? 1000
		this.maxReconnectInterval = options.maxReconnectInterval ?? 30000
		this.maxReconnectAttempts = options.maxReconnectAttempts ?? Infinity
		this.amcpTimeoutMs = options.amcpTimeoutMs ?? 10000
		this.ws = null
		this.reconnectAttempts = 0
		this._reconnectTimer = null
		this._stopped = false
		this.listeners = new Map()
		this._connect()
	}

	on(event, fn) {
		if (!this.listeners.has(event)) this.listeners.set(event, [])
		this.listeners.get(event).push(fn)
		return () => {
			const fns = this.listeners.get(event)
			if (fns) {
				const i = fns.indexOf(fn)
				if (i >= 0) fns.splice(i, 1)
			}
		}
	}

	emit(event, data) {
		const fns = this.listeners.get(event)
		if (fns) fns.forEach((fn) => fn(data))
	}

	_send(obj) {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(obj))
		}
	}

	send(obj) {
		this._send(obj)
	}

	_waitAmcpResult(id, timeoutMs = this.amcpTimeoutMs) {
		return new Promise((resolve, reject) => {
			let unsub = null
			let timer = null
			const cleanup = () => {
				if (unsub) {
					unsub()
					unsub = null
				}
				if (timer) {
					clearTimeout(timer)
					timer = null
				}
			}
			const handler = (msg) => {
				if (msg.type === 'amcp_result' && msg.id === id) {
					cleanup()
					resolve(msg.data)
				}
			}
			unsub = this.on('message', handler)
			timer = setTimeout(() => {
				cleanup()
				reject(new Error(`AMCP timeout after ${timeoutMs}ms`))
			}, timeoutMs)
		})
	}

	sendAmcp(cmd) {
		const id = Date.now() + '-' + Math.random().toString(36).slice(2)
		this._send({ type: 'amcp', cmd, id })
		return this._waitAmcpResult(id)
	}

	/**
	 * Structured AMCP over WS (same fields as REST POST bodies). See WO-07 T5 / `ws-amcp-dispatch.js`.
	 * @param {Record<string, unknown>} payload — e.g. `{ type: 'play', channel: 1, layer: 10, clip: 'CLIP' }`
	 * @returns {Promise<unknown>}
	 */
	sendAmcpStructured(payload) {
		const id = Date.now() + '-' + Math.random().toString(36).slice(2)
		this._send({ ...payload, id })
		return this._waitAmcpResult(id)
	}

	_connect() {
		try {
			this.ws = new WebSocket(this.url)
		} catch (e) {
			this.emit('error', e)
			this._reconnect()
			return
		}

		this.ws.onopen = () => {
			this.reconnectAttempts = 0
			this.emit('connect')
		}

		this.ws.onmessage = async (ev) => {
			try {
				let text = ''
				const d = ev.data
				if (typeof d === 'string') text = d
				else if (d instanceof Blob) text = await d.text()
				else if (d instanceof ArrayBuffer) text = new TextDecoder().decode(d)
				else return
				const t = text.trim()
				if (!t || (t[0] !== '{' && t[0] !== '[')) return
				const msg = JSON.parse(t)
				this.emit('message', msg)
				if (msg.type) {
					// Avoid colliding with transport `error` (this.emit('error', err) from ws.onerror).
					if (msg.type === 'error') this.emit('server_error', msg.data)
					else this.emit(msg.type, msg.data)
				}
			} catch (e) {
				console.warn('[WsClient] bad WebSocket message (proxy must support WS upgrade):', e?.message || e)
			}
		}

		this.ws.onclose = () => {
			this.emit('disconnect')
			this._reconnect()
		}

		this.ws.onerror = (err) => this.emit('error', err)
	}

	_reconnect() {
		if (this._stopped) return
		if (Number.isFinite(this.maxReconnectAttempts) && this.reconnectAttempts >= this.maxReconnectAttempts) return
		this.reconnectAttempts++
		const delay = computeWsReconnectDelay(this.reconnectAttempts, {
			baseInterval: this.reconnectInterval,
			maxInterval: this.maxReconnectInterval,
		})
		if (this._reconnectTimer) clearTimeout(this._reconnectTimer)
		this._reconnectTimer = setTimeout(() => {
			this._reconnectTimer = null
			this._connect()
		}, delay)
	}

	close() {
		this._stopped = true
		if (this._reconnectTimer) {
			clearTimeout(this._reconnectTimer)
			this._reconnectTimer = null
		}
		if (this.ws) {
			this.ws.close()
			this.ws = null
		}
	}

	/** Force a fresh connection (e.g. after login sets session cookie). */
	reconnectNow() {
		this._stopped = false
		this.reconnectAttempts = 0
		if (this._reconnectTimer) {
			clearTimeout(this._reconnectTimer)
			this._reconnectTimer = null
		}
		if (this.ws) {
			try {
				this.ws.close()
			} catch {
				/* ignore */
			}
			this.ws = null
		}
		this._connect()
	}

	get connected() {
		return this.ws && this.ws.readyState === WebSocket.OPEN
	}
}
