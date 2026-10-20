'use strict'

/**
 * WO-616 T11 — follow engine: tracking hub markers → moving-head pan / tilt (follow-ik) → Art-Net (artdmx),
 * server-side so the rig keeps following with no client open.
 *
 *   44 Hz tick. Per fixture: its marker live → aim at (x, y, z + aim_z); stale or missing → HOLD the last aim
 *   (the hub's 1 s rule); never aimed → pan / tilt centre. Unreachable inside the ranges → hold.
 *   One packet per (destination, universe) when its bytes change, else a 1 s refresh (nodes time out).
 *   Master off (`project.fixtures.output.enabled` false, the default) → nothing is transmitted; a fixture with a
 *   problem (bad destination, overlap, past 512, loops into this box's own Art-Net input) is never written.
 * The universe belongs to this engine: channels no fixture writes go out as 0.
 * WO-624 E3: hold(id, pan, tilt) parks a head at a jogged aim (calibration, state 'calibrating') ahead of its
 * marker until release(id), a re-patch without it, or HOLD_TTL_MS without a refresh (a vanished client never
 * leaves a head parked).
 * WO-632 read-through (`output.through`, Art-Net backup): each universe starts as the console's frame (input
 * port-address = universe + offset, from `consoleFrames`) instead of zeros, and a head's pan / tilt / fixed
 * channels fade between the console (weight 0) and tracking (1) over fade_s — tracking = following a marker
 * with status > 0, or a calibration hold.
 */

const { encodeArtDmx } = require('./artdmx')
const { normalizePatch, parseFixed } = require('./follow-patch')
const { aim, writeFixture } = require('./follow-ik')
const { consoleAim, blendFixture } = require('./follow-through')

const TICK_MS = Math.round(1000 / 44)
const REFRESH_MS = 1000
const HOLD_TTL_MS = 10 * 60 * 1000

class FollowEngine {
	/**
	 * @param {{ hub: { list(now?): object[], now(): number }, send: (to, packet) => void,
	 *           isSelfLoop?: (to, universe) => boolean, reachesSelf?: (to) => boolean, now?: () => number,
	 *           consoleFrames?: { frame(pa: number, now?: number): Uint8Array | null } }} deps
	 */
	constructor({ hub, send, isSelfLoop, reachesSelf, now, consoleFrames } = {}) {
		this.hub = hub
		this.consoleFrames = consoleFrames || null
		this.through = { enabled: false, offset: 0, fade_s: 1 }
		this._w = new Map() // fixture id → read-through weight 0 (console) … 1 (tracking)
		this._lastTick = 0
		this._send = send
		this._isSelfLoop = typeof isSelfLoop === 'function' ? isSelfLoop : () => false
		this._reachesSelf = typeof reachesSelf === 'function' ? reachesSelf : () => false // lands on this box's :6454
		this.now = typeof now === 'function' ? now : () => Date.now()
		this.enabled = false
		this.protocol = 'psn' // WO-631: Art-Net goes out only while the output is the 'artnet' backup
		this.fixtures = []
		this._aim = new Map() // fixture id → { pan, tilt, state }
		this._hold = new Map() // fixture id → { pan, tilt, until } (WO-624 E3 calibration jog)
		this._uni = new Map() // "host:port|universe" → { to, universe, buf, last: Buffer|null, at, seq, packets }
		this._timer = null
	}

	/** project.fixtures slice → patch (keeps each fixture's last aim, so a re-patch does not snap heads). */
	configure(slice) {
		const p = normalizePatch(slice)
		const reads = new Set(p.through.enabled ? p.fixtures.map((f) => f.universe + p.through.offset) : [])
		for (const fx of p.fixtures) {
			if (!fx.problem && fx.to && this._isSelfLoop(fx.to, fx.universe)) {
				fx.problem = `would loop into this box's Art-Net input (universe ${fx.universe})`
			}
			if (!fx.problem && fx.to && reads.has(fx.universe) && this._reachesSelf(fx.to)) {
				fx.problem = `read-through would read its own output (universe ${fx.universe}) — set an input offset`
			}
			fx.fixedList = parseFixed(fx.fixed)
		}
		const wasOn = this.enabled
		this.enabled = p.enabled
		this.protocol = p.protocol
		this.psn = p.psn
		this.through = p.through
		this.fixtures = p.fixtures
		const live = new Set(p.fixtures.map((f) => f.id))
		for (const id of [...this._aim.keys()]) if (!live.has(id)) this._aim.delete(id)
		for (const id of [...this._hold.keys()]) if (!live.has(id)) this._hold.delete(id)
		const keys = new Set(p.fixtures.filter((f) => f.to && !f.problem && f.enabled).map((f) => this._key(f)))
		for (const k of [...this._uni.keys()]) if (!keys.has(k)) this._uni.delete(k)
		if (this.enabled !== wasOn) for (const u of this._uni.values()) u.last = null // send at once
	}

	/** Park fixture `id` at pan / tilt (commanded degrees, clamped to its ranges). → the held aim, or null. */
	hold(id, pan, tilt) {
		const fx = this.fixtures.find((f) => f.id === id)
		if (!fx) return null
		const clamp = (v, range) => Math.max(-range / 2, Math.min(range / 2, Number(v) || 0))
		const h = { pan: clamp(pan, fx.pan.range), tilt: clamp(tilt, fx.tilt.range), until: this.now() + HOLD_TTL_MS }
		this._hold.set(id, h)
		return { pan: h.pan, tilt: h.tilt }
	}

	release(id) {
		return this._hold.delete(id)
	}

	/** The aim fixture `id` was last given ({ pan, tilt, state }) — where a calibration jog starts from. */
	aimOf(id) {
		return this._aim.get(id) || { pan: 0, tilt: 0, state: 'centre' }
	}

	_key(fx) {
		return `${fx.to.host}:${fx.to.port}|${fx.universe}`
	}

	start() {
		this.stop()
		this._timer = setInterval(() => this.tick(), TICK_MS)
		if (typeof this._timer.unref === 'function') this._timer.unref()
	}

	stop() {
		if (this._timer) clearInterval(this._timer)
		this._timer = null
	}

	/** One frame: aim every fixture, then (master on) transmit changed / due universes. → packets sent. */
	tick() {
		const now = this.now()
		const dt = this._lastTick ? Math.min(0.5, (now - this._lastTick) / 1000) : 0
		this._lastTick = now
		const marks = new Map((this.hub?.list(this.hub.now()) || []).map((m) => [m.id, m]))
		const thru = this.through.enabled && this.protocol === 'artnet' && this.consoleFrames ? this.through : null
		const consoleOf = (universe) => {
			const pa = universe + (thru?.offset ?? 0)
			return thru ? this.consoleFrames.frame(pa, now) || this.consoleFrames.last?.(pa) || null : null
		}
		for (const u of this._uni.values()) {
			const cf = consoleOf(u.universe)
			if (cf) u.buf.set(cf)
			else u.buf.fill(0)
		}
		for (const fx of this.fixtures) {
			const cf = consoleOf(fx.universe)
			let prev = this._aim.get(fx.id) || { pan: 0, tilt: 0, state: 'centre' }
			if (cf && !this._w.get(fx.id)) prev = { ...consoleAim(fx, cf), state: prev.state } // track from the console's aim
			let next
			const m = fx.follow ? marks.get(fx.follow) : null
			const h = this._hold.get(fx.id)
			if (h && now > h.until) this._hold.delete(fx.id)
			if (h && now <= h.until) next = { pan: h.pan, tilt: h.tilt, state: 'calibrating' }
			else if (!fx.follow) next = { ...prev, state: prev.state === 'centre' ? 'centre' : 'holding' }
			else if (!m) next = { ...prev, state: 'no marker' }
			else if (m.stale) next = { ...prev, state: 'holding (stale)' }
			else {
				const pt = aim(fx, [m.x, m.y, m.z + fx.aim_z], prev)
				next = pt ? { ...pt, state: 'following' } : { ...prev, state: 'out of range' }
			}
			this._aim.set(fx.id, next)
			const tracking = next.state === 'calibrating' || (next.state === 'following' && Number(m?.status ?? 1) > 0)
			const w0 = this._w.get(fx.id) || 0
			const step = thru && thru.fade_s > 0 ? dt / thru.fade_s : 1
			// No console frame yet = the aim alone is on the wire (w 1), so the console appearing fades in, never snaps.
			this._w.set(fx.id, cf ? Math.max(0, Math.min(1, w0 + (tracking ? step : -step))) : 1)
			if (fx.problem || !fx.enabled || !fx.to) continue
			const key = this._key(fx)
			let u = this._uni.get(key)
			if (!u) {
				u = { to: fx.to, universe: fx.universe, buf: new Uint8Array(512), last: null, at: 0, seq: 0, packets: 0 }
				if (cf) u.buf.set(cf)
				this._uni.set(key, u)
			}
			if (cf) blendFixture(u.buf, fx, cf, next, fx.fixedList, this._w.get(fx.id))
			else writeFixture(u.buf, fx, next, fx.fixedList)
		}
		if (!this.enabled || this.protocol !== 'artnet') return 0
		let sent = 0
		for (const u of this._uni.values()) {
			const same = u.last && Buffer.from(u.buf).equals(u.last)
			if (same && now - u.at < REFRESH_MS) continue
			u.seq = (u.seq % 255) + 1
			this._send(u.to, encodeArtDmx({ portAddress: u.universe, sequence: u.seq, data: u.buf }))
			u.last = Buffer.from(u.buf)
			u.at = now
			u.packets++
			sent++
		}
		return sent
	}

	status() {
		const now = this.now()
		return {
			output_enabled: this.enabled,
			protocol: this.protocol,
			through: this.through,
			tick_hz: Math.round(1000 / TICK_MS),
			fixtures: this.fixtures.map((fx) => {
				const a = this._aim.get(fx.id) || { pan: 0, tilt: 0, state: 'centre' }
				const w = this._w.get(fx.id) || 0
				const pa = fx.universe + this.through.offset
				const cons = !this.consoleFrames ? null : this.consoleFrames.frame(pa, now) ? 'live'
					: this.consoleFrames.last?.(pa) ? 'held' : 'none'
				return { id: fx.id, name: fx.name, follow: fx.follow, enabled: fx.enabled, problem: fx.problem,
					through: !this.through.enabled ? null : w <= 0 ? 'console' : w >= 1 ? 'tracking' : 'fading',
					console: this.through.enabled ? cons : null,
					state: fx.problem ? 'not output' : a.state, pan: Math.round(a.pan * 100) / 100,
					tilt: Math.round(a.tilt * 100) / 100, universe: fx.universe, address: fx.address, dest: fx.dest }
			}),
			universes: [...this._uni.values()].map((u) => ({ dest: `${u.to.host}:${u.to.port}`, universe: u.universe,
				packets: u.packets, last_sent_ms_ago: u.at ? now - u.at : null })),
		}
	}
}

module.exports = { FollowEngine, TICK_MS, REFRESH_MS, HOLD_TTL_MS }
