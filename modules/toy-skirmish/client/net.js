/**
 * WebSocket connection of Stage Skirmish (WO-1081 §7). COPY-ADAPTED from the kit's net.js (modules/rc-game/client/
 * net.js): that file is bound to the RC socket path and the RC protocol (ready / box / use), so it cannot be reused
 * unchanged. Environment-injected (WebSocket class, clock, timers) so node tests can drive it with a fake socket.
 *
 * - join on open (player or spectator), reconnect with backoff 0.5 → 8 s (reset after a `welcome`),
 * - `full` / `off` (or close code 4403) stop reconnecting; 4409 = kicked by the host (no auto-rejoin),
 * - ping every 0.5 s for the first pings, then every 2 s → the kit's ClockSync (server time for rockets, timers),
 * - own state at most every SEND_INTERVAL_MS, only when it changed or as a 1 s keepalive,
 * - events (`fire`, `hit`, `boom`, `pick`) go out at once while joined; `pick` per pickup id at most every 400 ms.
 */
import { ClockSync } from './kit/interp.js'
import { decode, encode, joinMsg, pingMsg, SEND_INTERVAL_MS, KEEPALIVE_MS } from './protocol.js'

export const BACKOFF_MS = [500, 1000, 2000, 4000, 8000]
export const WS_PATH = '/api/game/sk/ws'
export const OFF_CODE = 4403
export const KICK_CODE = 4409
/** WO-1106 B34: this seat went on on another page (the same resume token): no auto-rejoin — the page offers "Play here". */
export const REPLACED_CODE = 4410
export const PICK_GAP_MS = 400

/** ws(s)://host/api/game/sk/ws for a page location (also under /instance/<id>/ when the page is). */
export function wsUrlFor(loc) {
	const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:'
	const m = /^(\/instance\/[\w-]+)\//.exec(loc.pathname || '')
	return `${proto}//${loc.host}${m ? m[1] : ''}${WS_PATH}`
}

export class SkNet {
	/**
	 * @param {{ url: string, WebSocket: any, now: () => number, setTimeout: Function, clearTimeout: Function,
	 *   setInterval: Function, clearInterval: Function, onMessage?: (m: object) => void, onStatus?: (s: string) => void,
	 *   onBinary?: (data: ArrayBuffer | Blob) => void, resume?: { get: () => string|null, set: (v: string|null) => void } }} env
	 *   resume: where the resume token lives (WO-1106 B34; the page: sessionStorage — a reload of this tab resumes, a new
	 *   tab is a new player)
	 */
	constructor(env) {
		this.env = env
		this.token = readToken(env) // WO-1106 B34: the welcome's resume token, sent back in the next join
		this.clock = new ClockSync()
		this.status = 'idle' // idle | connecting | open | joined | full | off | kicked | replaced | closed
		this.closeCode = null
		this.ws = null
		this.attempt = 0
		this.join = null
		this.lastSent = -Infinity
		this.lastSentKey = ''
		this.pings = 0
		this.pickAt = new Map()
		this._retry = null
		this._ping = null
		this._stopped = false
	}

	_set(st) {
		if (this.status === st) return
		this.status = st
		this.env.onStatus?.(st)
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
		this._drop()
		this._set('connecting')
		let ws
		try {
			ws = new this.env.WebSocket(this.env.url)
		} catch {
			this._scheduleRetry()
			return
		}
		ws.binaryType = 'arraybuffer' // RC §2.6 wall pictures
		this.ws = ws
		ws.onopen = () => {
			this._set('open')
			this._sendRaw(this.token && !this.join.spectator ? { ...this.join, resume: this.token } : this.join)
			this.pings = 0
			this._sendPing()
			this._ping = this.env.setInterval(() => this._sendPing(), 500)
		}
		ws.onmessage = (ev) => (typeof ev.data === 'string' ? this._onMessage(ev.data) : this.env.onBinary?.(ev.data))
		ws.onerror = () => {}
		ws.onclose = (ev) => {
			this._clearTimers()
			this.ws = null
			this.closeCode = ev ? ev.code : null
			const final = this._stopped || this.status === 'full' || this.status === 'off'
			if (ev && ev.code === OFF_CODE) this._set('off')
			else if (!final && ev && ev.code === KICK_CODE) this._set('kicked'), this.forget()
			else if (!final && ev && ev.code === REPLACED_CODE) this._set('replaced') // WO-1106 B34: resumed on another page
			if (this._stopped || this.status === 'full' || this.status === 'off' || this.status === 'kicked' || this.status === 'replaced') return
			this._scheduleRetry()
		}
	}

	_drop() {
		if (!this.ws) return
		try {
			this.ws.onclose = null
			this.ws.close()
		} catch {
			/* ignore */
		}
		this.ws = null
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
			if (typeof m.resume === 'string') this._keep(m.resume)
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

	/** Any message (the kit's stage-fx uses it for `video`). */
	send(msg) {
		return this._sendRaw(msg)
	}

	/** fire / hit / boom / pick: at once while joined (a pickup id at most every PICK_GAP_MS). */
	sendEvent(msg) {
		if (this.status !== 'joined' || !msg) return false
		if (msg.t === 'pick') {
			const now = this.env.now()
			if (now - (this.pickAt.get(msg.id) ?? -Infinity) < PICK_GAP_MS) return false
			if (!this._sendRaw(msg)) return false
			this.pickAt.set(msg.id, now)
			return true
		}
		return this._sendRaw(msg)
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

	/** WO-1106 B34: keep the welcome's resume token (memory + the page's store). */
	_keep(token) {
		this.token = token
		try {
			this.env.resume?.set(token)
		} catch {
			/* storage blocked: memory only */
		}
	}

	/** WO-1106 B34: the next join is a new player (kicked; the page's "change name" rejoin). */
	forget() {
		this.token = null
		try {
			this.env.resume?.set(null)
		} catch {
			/* ignore */
		}
	}

	close() {
		this._stopped = true
		this._clearTimers()
		this._drop()
		this._set('idle')
	}
}

/** WO-1106 B34: the stored resume token, or null (blocked storage, junk). */
function readToken(env) {
	try {
		const v = env.resume?.get()
		return typeof v === 'string' && /^[1-9]\d{0,8}\.[A-Za-z0-9_-]{22}$/.test(v) ? v : null
	} catch {
		return null
	}
}
