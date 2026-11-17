/**
 * WebSocket connection of Stage Salad (WO-1089 §9). COPY-ADAPTED from the Skirmish socket (modules/toy-skirmish/client/
 * net.js), which is bound to its own path and messages. Environment-injected (WebSocket class, clock, timers) so node
 * tests can drive it with a fake socket.
 *
 * - join on open (player or spectator), reconnect with backoff 0.5 → 8 s (reset after a `welcome`),
 * - `full` / `off` (or close code 4403) stop reconnecting; 4409 = kicked by the host (no auto-rejoin),
 * - ping every 0.5 s for the first pings, then every 2 s → the kit's ClockSync (server time for flights, timers),
 * - `aim` at most every AIM_INTERVAL_MS and only when it changed (a final p 0 always goes out), `fire` at once.
 */
import { ClockSync } from './kit/interp.js'
import { decode, encode, joinMsg, pingMsg, aimMsg, AIM_INTERVAL_MS } from './protocol.js'

export const BACKOFF_MS = [500, 1000, 2000, 4000, 8000]
export const WS_PATH = '/api/game/salad/ws'
export const OFF_CODE = 4403
export const KICK_CODE = 4409
/** WO-1106 B34: this seat went on on another page (the same resume token): no auto-rejoin — the page offers "Play here". */
export const REPLACED_CODE = 4410

/** ws(s)://host/api/game/salad/ws for a page location (also under /instance/<id>/ when the page is). */
export function wsUrlFor(loc) {
	const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:'
	const m = /^(\/instance\/[\w-]+)\//.exec(loc.pathname || '')
	return `${proto}//${loc.host}${m ? m[1] : ''}${WS_PATH}`
}

export class SaladNet {
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
		this.aimAt = -Infinity
		this.aimKey = ''
		this.aimPending = null
		this.pings = 0
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
			this.clock.reset() // WO-1106 "soft affect" row (as RC B43): pre-sleep samples would keep server time off by the sleep length
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

	/** A shot: at once while joined. */
	sendFire(msg) {
		if (this.status !== 'joined' || !msg || msg.t !== 'fire') return false
		return this._sendRaw(msg)
	}

	/**
	 * The band's stretch: at most every AIM_INTERVAL_MS, only when it changed. A release (pull 0) is never lost: when
	 * throttled it is kept and flushed by the next call (`flushAim()` each frame).
	 */
	sendAim(yaw, pitch, pull) {
		if (this.status !== 'joined') return false
		const msg = aimMsg(yaw, pitch, pull)
		const key = encode(msg)
		if (key === this.aimKey) {
			this.aimPending = null
			return false
		}
		const now = this.env.now()
		if (now - this.aimAt < AIM_INTERVAL_MS) {
			this.aimPending = msg
			return false
		}
		if (!this._sendRaw(msg)) return false
		this.aimAt = now
		this.aimKey = key
		this.aimPending = null
		return true
	}

	/** Send a throttled-away last aim once its interval is over. */
	flushAim() {
		const m = this.aimPending
		if (!m || this.status !== 'joined' || this.env.now() - this.aimAt < AIM_INTERVAL_MS) return false
		this.aimPending = null
		if (!this._sendRaw(m)) return false
		this.aimAt = this.env.now()
		this.aimKey = encode(m)
		return true
	}

	serverNow() {
		return this.clock.now(this.env.now())
	}

	get synced() {
		return this.clock.samples.length > 0
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
