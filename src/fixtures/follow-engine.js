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
 */

const { encodeArtDmx } = require('./artdmx')
const { normalizePatch, parseFixed } = require('./follow-patch')
const { aim, writeFixture } = require('./follow-ik')

const TICK_MS = Math.round(1000 / 44)
const REFRESH_MS = 1000

class FollowEngine {
	/**
	 * @param {{ hub: { list(now?): object[], now(): number }, send: (to, packet) => void,
	 *           isSelfLoop?: (to, universe) => boolean, now?: () => number }} deps
	 */
	constructor({ hub, send, isSelfLoop, now } = {}) {
		this.hub = hub
		this._send = send
		this._isSelfLoop = typeof isSelfLoop === 'function' ? isSelfLoop : () => false
		this.now = typeof now === 'function' ? now : () => Date.now()
		this.enabled = false
		this.fixtures = []
		this._aim = new Map() // fixture id → { pan, tilt, state }
		this._uni = new Map() // "host:port|universe" → { to, universe, buf, last: Buffer|null, at, seq, packets }
		this._timer = null
	}

	/** project.fixtures slice → patch (keeps each fixture's last aim, so a re-patch does not snap heads). */
	configure(slice) {
		const p = normalizePatch(slice)
		for (const fx of p.fixtures) {
			if (!fx.problem && fx.to && this._isSelfLoop(fx.to, fx.universe)) {
				fx.problem = `would loop into this box's Art-Net input (universe ${fx.universe})`
			}
			fx.fixedList = parseFixed(fx.fixed)
		}
		const wasOn = this.enabled
		this.enabled = p.enabled
		this.fixtures = p.fixtures
		const live = new Set(p.fixtures.map((f) => f.id))
		for (const id of [...this._aim.keys()]) if (!live.has(id)) this._aim.delete(id)
		const keys = new Set(p.fixtures.filter((f) => f.to && !f.problem && f.enabled).map((f) => this._key(f)))
		for (const k of [...this._uni.keys()]) if (!keys.has(k)) this._uni.delete(k)
		if (this.enabled !== wasOn) for (const u of this._uni.values()) u.last = null // send at once
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
		const marks = new Map((this.hub?.list(this.hub.now()) || []).map((m) => [m.id, m]))
		for (const u of this._uni.values()) u.buf.fill(0)
		for (const fx of this.fixtures) {
			const prev = this._aim.get(fx.id) || { pan: 0, tilt: 0, state: 'centre' }
			let next
			const m = fx.follow ? marks.get(fx.follow) : null
			if (!fx.follow) next = { ...prev, state: prev.state === 'centre' ? 'centre' : 'holding' }
			else if (!m) next = { ...prev, state: 'no marker' }
			else if (m.stale) next = { ...prev, state: 'holding (stale)' }
			else {
				const pt = aim(fx, [m.x, m.y, m.z + fx.aim_z], prev)
				next = pt ? { ...pt, state: 'following' } : { ...prev, state: 'out of range' }
			}
			this._aim.set(fx.id, next)
			if (fx.problem || !fx.enabled || !fx.to) continue
			const key = this._key(fx)
			let u = this._uni.get(key)
			if (!u) {
				u = { to: fx.to, universe: fx.universe, buf: new Uint8Array(512), last: null, at: 0, seq: 0, packets: 0 }
				this._uni.set(key, u)
			}
			writeFixture(u.buf, fx, next, fx.fixedList)
		}
		if (!this.enabled) return 0
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
			tick_hz: Math.round(1000 / TICK_MS),
			fixtures: this.fixtures.map((fx) => {
				const a = this._aim.get(fx.id) || { pan: 0, tilt: 0, state: 'centre' }
				return { id: fx.id, name: fx.name, follow: fx.follow, enabled: fx.enabled, problem: fx.problem,
					state: fx.problem ? 'not output' : a.state, pan: Math.round(a.pan * 100) / 100,
					tilt: Math.round(a.tilt * 100) / 100, universe: fx.universe, address: fx.address, dest: fx.dest }
			}),
			universes: [...this._uni.values()].map((u) => ({ dest: `${u.to.host}:${u.to.port}`, universe: u.universe,
				packets: u.packets, last_sent_ms_ago: u.at ? now - u.at : null })),
		}
	}
}

module.exports = { FollowEngine, TICK_MS, REFRESH_MS }
