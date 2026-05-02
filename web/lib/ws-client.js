/**
 * WebSocket client for CasparCG module real-time state.
 * Connects to /api/ws or /ws, receives state + change events.
 * @see main_plan.md Prompt 11
 */

export class WsClient {
	constructor(options = {}) {
		this.url = options.url || getWsUrl()
		this.reconnectInterval = options.reconnectInterval ?? 3000
		this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10
		this.ws = null
		this.reconnectAttempts = 0
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

	sendAmcp(cmd) {
		return new Promise((resolve) => {
			const id = Date.now() + '-' + Math.random().toString(36).slice(2)
			let unsub
			const handler = (msg) => {
				if (msg.type === 'amcp_result' && msg.id === id) {
					if (unsub) unsub()
					resolve(msg.data)
				}
			}
			unsub = this.on('message', handler)
			this._send({ type: 'amcp', cmd, id })
		})
	}

	/**
	 * Structured AMCP over WS (same fields as REST POST bodies). See WO-07 T5 / `ws-amcp-dispatch.js`.
	 * @param {Record<string, unknown>} payload — e.g. `{ type: 'play', channel: 1, layer: 10, clip: 'CLIP' }`
	 * @returns {Promise<unknown>}
	 */
	sendAmcpStructured(payload) {
		return new Promise((resolve) => {
			const id = Date.now() + '-' + Math.random().toString(36).slice(2)
			let unsub
			const handler = (msg) => {
				if (msg.type === 'amcp_result' && msg.id === id) {
					if (unsub) unsub()
					resolve(msg.data)
				}
			}
			unsub = this.on('message', handler)
			this._send({ ...payload, id })
		})
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
		if (this.reconnectAttempts >= this.maxReconnectAttempts) return
		this.reconnectAttempts++
		setTimeout(() => this._connect(), this.reconnectInterval)
	}

	close() {
		this.maxReconnectAttempts = 0
		if (this.ws) {
			this.ws.close()
			this.ws = null
		}
	}

	get connected() {
		return this.ws && this.ws.readyState === WebSocket.OPEN
	}
}

/**
 * WebSocket URL for live state + OSC + AMCP bridge. Uses the same `/instance/ID`
 * prefix as `getApiBase()` in `api-client.js` so Companion-hosted SPAs connect correctly.
 * @returns {string} e.g. `ws://host:8080/api/ws` or `ws://host:8080/instance/xyz/api/ws`
 */
export function getWsUrl() {
	const base = location.origin.replace(/^http/, 'ws')
	const pathPrefix = (() => {
		const p = location.pathname.replace(/\/$/, '') || '/'
		const m = p.match(/^(\/instance\/[^/]+)/)
		return m ? m[1] : ''
	})()
	return base + pathPrefix + '/api/ws'
}
