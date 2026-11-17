/**
 * WebSocket connection of the RC game (WO-1074). Environment-injected (WebSocket class, clock, timers) so node tests
 * can drive it with a fake socket; the browser passes the real ones.
 *
 * - join on open (player or spectator), reconnect with backoff 0.5 → 8 s (reset after a `welcome`),
 * - `full` / `off` (or close code 4403) stop reconnecting and report the status,
 * - ping every 2 s (faster during the first seconds) → ClockSync,
 * - own state at most every SEND_INTERVAL_MS, and only when it changed or as a 1 s keepalive.
 */
import { ClockSync } from './interp.js'
import { decode, encode, joinMsg, pingMsg, readyMsg, SEND_INTERVAL_MS, KEEPALIVE_MS } from './protocol.js'

export const BACKOFF_MS = [500, 1000, 2000, 4000, 8000]
export const WS_PATH = '/api/game/rc/ws'
/** Close codes: 4403 = game disabled (contract); 4409 = kicked by the host (server rc-room.js, not in the contract text). */
export const OFF_CODE = 4403
/** Minimum spacing of item events (the server allows ≤ 10 box / ≤ 5 use per second). */
export const EVENT_GAP_MS = { box: 110, use: 210 }
export const KICK_CODE = 4409

/** ws(s)://host/api/game/rc/ws for a page location. */
export function wsUrlFor(loc) {
	const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:'
	return `${proto}//${loc.host}${WS_PATH}`
}

export class RcNet {
	/**
	 * @param {{ url: string, WebSocket: any, now: () => number, setTimeout: Function, clearTimeout: Function,
	 *   setInterval: Function, clearInterval: Function, onMessage?: (m: object) => void, onStatus?: (s: string) => void,
	 *   onBinary?: (data: ArrayBuffer | Blob) => void }} env
	 */
	constructor(env) {
		this.env = env
		this.clock = new ClockSync()
		this.status = 'idle' // idle | connecting | open | joined | full | off | kicked | closed
		this.closeCode = null
		this.ws = null
		this.attempt = 0
		this.join = null
		this.lastSent = -Infinity
		this.lastSentKey = ''
		this.pings = 0
		this._retry = null
		this._ping = null
		this._stopped = false
	}

	_set(s) {
		if (this.status === s) return
		this.status = s
		this.env.onStatus?.(s)
	}

	/** Start (or restart with new join details). */
	connect(name, color, spectator = false) {
		this.join = joinMsg(name, color, spectator)
		this._stopped = false
		this.attempt = 0
		this._open()
	}

	_open() {
		this._clearTimers()
		if (this.ws) {
			try {
				this.ws.onclose = null
				this.ws.close()
			} catch {
				/* ignore */
			}
		}
		this._set('connecting')
		let ws
		try {
			ws = new this.env.WebSocket(this.env.url)
		} catch {
			this._scheduleRetry()
			return
		}
		ws.binaryType = 'arraybuffer' // §2.6 wall pictures (onBinary also takes a Blob)
		this.ws = ws
		ws.onopen = () => {
			this._set('open')
			this.clock.reset() // WO-1106 B43: pre-sleep samples would keep server time off by the sleep length
			this._sendRaw(this.join)
			this.pings = 0
			this._sendPing()
			this._ping = this.env.setInterval(() => this._sendPing(), 500)
		}
		/* binary = a wall picture `[u8 n][role][JPEG]` → onBinary; never through decode (which would String() it) */
		ws.onmessage = (ev) => (typeof ev.data === 'string' ? this._onMessage(ev.data) : this.env.onBinary?.(ev.data))
		ws.onerror = () => {}
		ws.onclose = (ev) => {
			this._clearTimers()
			this.ws = null
			this.closeCode = ev ? ev.code : null
			const final = this._stopped || this.status === 'full' || this.status === 'off'
			if (ev && ev.code === OFF_CODE) this._set('off')
			else if (!final && ev && ev.code === KICK_CODE) this._set('kicked') // removed by the host: no auto-rejoin
			/* anything else (network drop, 4408 silent after a phone slept, 1013 busy …) → reconnect with backoff */
			if (this._stopped || this.status === 'full' || this.status === 'off' || this.status === 'kicked') return
			this._scheduleRetry()
		}
	}

	_scheduleRetry() {
		this._set('closed')
		const ms = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]
		this.attempt++
		this._retry = this.env.setTimeout(() => this._open(), ms)
	}

	_clearTimers() {
		if (this._retry != null) this.env.clearTimeout(this._retry)
		if (this._ping != null) this.env.clearInterval(this._ping)
		this._retry = null
		this._ping = null
	}

	_sendPing() {
		this.pings++
		/* 500 ms for the first 6 pings (quick clock lock), then every 2 s */
		if (this.pings > 6 && this.pings % 4 !== 0) return
		this._sendRaw(pingMsg(Math.round(this.env.now())))
	}

	_onMessage(data) {
		const m = decode(data)
		if (!m) return
		if (m.t === 'pong') {
			this.clock.sample(Number(m.c), m.s, this.env.now())
			return
		}
		if (m.t === 'welcome') {
			this.attempt = 0
			this._set('joined')
		} else if (m.t === 'full' || m.t === 'off') {
			this._stopped = true
			this._set(m.t)
		}
		this.env.onMessage?.(m)
	}

	_sendRaw(msg) {
		const ws = this.ws
		if (!ws || ws.readyState !== 1) return false
		try {
			ws.send(encode(msg))
			return true
		} catch {
			return false
		}
	}

	setReady(ready) {
		return this._sendRaw(readyMsg(ready))
	}

	/**
	 * Item events (`box`, `use`, `hit`): sent at once when joined, but never faster than the server's limits
	 * (≤ 10 `box` and ≤ 5 `use` per second per player). Returns false when dropped.
	 */
	sendEvent(msg) {
		if (this.status !== 'joined' || !msg) return false
		const gap = EVENT_GAP_MS[msg.t] || 0
		const now = this.env.now()
		this._evAt = this._evAt || {}
		if (gap && now - (this._evAt[msg.t] ?? -Infinity) < gap) return false
		if (!this._sendRaw(msg)) return false
		this._evAt[msg.t] = now
		return true
	}

	/** Throttled own-state send. @param {object} msg from stateMsg() */
	sendState(msg) {
		if (this.status !== 'joined') return false
		const now = this.env.now()
		if (now - this.lastSent < SEND_INTERVAL_MS) return false
		const key = encode(msg)
		if (key === this.lastSentKey && now - this.lastSent < KEEPALIVE_MS) return false
		if (!this._sendRaw(msg)) return false
		this.lastSent = now
		this.lastSentKey = key
		return true
	}

	serverNow() {
		return this.clock.now(this.env.now())
	}

	close() {
		this._stopped = true
		this._clearTimers()
		if (this.ws) {
			try {
				this.ws.onclose = null
				this.ws.close()
			} catch {
				/* ignore */
			}
		}
		this.ws = null
		this._set('idle')
	}
}
