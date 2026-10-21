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
 * WO-615 T4: a fixture with a GDTF type writes every channel of its mode (programmer value, else the GDTF
 * default — gdtf-patch.js), then pan / tilt from the aim only while it follows or is held. A universe carrying a
 * typed fixture is transmitted only while `fixtures.dmx` is on AND lists it ("artnet:0", "sacn:1"); other
 * universes keep the WO-616/631 rule (follow master on + Art-Net backup) and may also be listed. sACN universes
 * go out as E1.31 (sacn.js), multicast unless the patch names a unicast destination.
 * WO-615 T7: while `fixtures.dmx.visualise` is on, no typed universe is sent at all (the console drives them).
 */

const { encodeArtDmx } = require('./artdmx')
const { normalizePatch, parseFixed } = require('./follow-patch')
const { aim, writeFixture } = require('./follow-ik')
const { consoleAim, blendFixture } = require('./follow-through')
const { writeGdtf, cleanValue, normalizeDmx } = require('./gdtf-patch')
const { encodeE131, boxCid } = require('./sacn')

const TICK_MS = Math.round(1000 / 44)
const REFRESH_MS = 1000
const HOLD_TTL_MS = 10 * 60 * 1000

class FollowEngine {
	/**
	 * @param {{ hub: { list(now?): object[], now(): number }, send: (to, packet) => void,
	 *           isSelfLoop?: (to, universe) => boolean, reachesSelf?: (to) => boolean, now?: () => number,
	 *           consoleFrames?: { frame(pa: number, now?: number): Uint8Array | null },
	 *           resolveMode?: (typeId, mode) => object | null }} deps  isSelfLoop(to, universe, protocol)
	 */
	constructor({ hub, send, isSelfLoop, reachesSelf, now, consoleFrames, resolveMode } = {}) {
		this.hub = hub
		this._resolveMode = typeof resolveMode === 'function' ? resolveMode : null
		this.dmx = normalizeDmx()
		this._values = new Map() // fixture id → programmer values (WO-615 T4; in memory — looks persist them, T8)
		this._cid = boxCid()
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
		const p = normalizePatch(slice, { resolveMode: this._resolveMode })
		const reads = new Set(p.through.enabled ? p.fixtures.filter((f) => f.protocol === 'artnet').map((f) => f.universe + p.through.offset) : [])
		for (const fx of p.fixtures) {
			if (!fx.problem && fx.to && this._isSelfLoop(fx.to, fx.universe, fx.protocol)) {
				fx.problem = `would loop into this box's ${fx.protocol === 'sacn' ? 'sACN' : 'Art-Net'} input (universe ${fx.universe})`
			}
			if (!fx.problem && fx.to && fx.protocol === 'artnet' && reads.has(fx.universe) && this._reachesSelf(fx.to)) {
				fx.problem = `read-through would read its own output (universe ${fx.universe}) — set an input offset`
			}
			fx.fixedList = parseFixed(fx.fixed)
		}
		const wasOn = `${this.enabled}|${this.protocol}|${this.dmx.enabled}|${this.dmx.visualise}|${[...this.dmx.universes]}`
		this.dmx = p.dmx
		this.enabled = p.enabled
		this.protocol = p.protocol
		this.psn = p.psn
		this.through = p.through
		this.fixtures = p.fixtures
		const live = new Set(p.fixtures.map((f) => f.id))
		for (const id of [...this._aim.keys()]) if (!live.has(id)) this._aim.delete(id)
		for (const id of [...this._hold.keys()]) if (!live.has(id)) this._hold.delete(id)
		for (const id of [...this._values.keys()]) if (!live.has(id)) this._values.delete(id)
		const out = p.fixtures.filter((f) => f.to && !f.problem && f.enabled)
		const keys = new Set(out.map((f) => this._key(f)))
		const typed = new Set(out.filter((f) => f.gdtf).map((f) => this._key(f)))
		for (const k of [...this._uni.keys()]) if (!keys.has(k)) this._uni.delete(k)
		for (const [k, u] of this._uni) u.typed = typed.has(k)
		this._typed = typed
		const isOn = `${this.enabled}|${this.protocol}|${this.dmx.enabled}|${this.dmx.visualise}|${[...this.dmx.universes]}`
		if (isOn !== wasOn) for (const u of this._uni.values()) u.last = null // send at once
	}

	/**
	 * Programmer (WO-615 T4): merge `values` ({ "Dimmer": 1, "Pixel 2/ColorAdd_R": 0.5, "Color1": { set: "Red" } };
	 * null clears a key) into each fixture's map, or replace it. → ids changed (unknown ids skipped).
	 */
	program(ids, values, { replace = false } = {}) {
		const known = new Set(this.fixtures.map((f) => f.id))
		const changed = []
		for (const id of ids) {
			if (!known.has(id)) continue
			const next = replace ? {} : { ...(this._values.get(id) || {}) }
			for (const [k, raw] of Object.entries(values || {}).slice(0, 512)) {
				const v = cleanValue(raw)
				if (v === null) delete next[k]
				else if (v !== undefined) next[String(k).slice(0, 160)] = v
			}
			if (Object.keys(next).length) this._values.set(id, next)
			else this._values.delete(id)
			changed.push(id)
		}
		return changed
	}

	/** Release the programmer for `ids` (all fixtures when omitted) — channels fall back to their defaults. */
	clearProgram(ids) {
		if (!ids) this._values.clear()
		else for (const id of ids) this._values.delete(id)
	}

	values() {
		return Object.fromEntries(this._values)
	}

	/** Whether universe u may be transmitted right now (see the header). */
	_live(u) {
		if (u.typed && this.dmx.visualise) return false // WO-615 T7: the console drives these — never send what we show
		if (this.dmx.enabled && this.dmx.universes.has(`${u.protocol}:${u.universe}`)) return true
		return !u.typed && u.protocol === 'artnet' && this.enabled && this.protocol === 'artnet'
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

	/** WO-615 T5: the 512 bytes fixture fx was last written into (what the previs decodes), or null. */
	frameOf(fx) {
		return fx.to ? this._uni.get(this._key(fx))?.buf || null : null
	}

	_key(fx) {
		return `${fx.protocol}|${fx.to.host}:${fx.to.port}|${fx.universe}`
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
				u = { to: fx.to, protocol: fx.protocol, universe: fx.universe, typed: Boolean(this._typed?.has(key)),
					buf: new Uint8Array(512), last: null, at: 0, seq: 0, packets: 0 }
				if (cf) u.buf.set(cf)
				this._uni.set(key, u)
			}
			const aimed = !fx.gdtf || fx.follow > 0 || next.state === 'calibrating'
			if (cf && fx.moving) blendFixture(u.buf, fx, cf, next, fx.fixedList, this._w.get(fx.id))
			else if (!cf) {
				if (fx.gdtf) writeGdtf(u.buf, fx, this._values.get(fx.id))
				writeFixture(u.buf, fx, fx.moving && aimed ? next : null, fx.fixedList)
			}
		}
		let sent = 0
		for (const u of this._uni.values()) {
			if (!this._live(u)) continue
			const same = u.last && Buffer.from(u.buf).equals(u.last)
			if (same && now - u.at < REFRESH_MS) continue
			u.seq = (u.seq % 255) + 1
			this._send(u.to, u.protocol === 'sacn'
				? encodeE131({ universe: u.universe, sequence: u.seq, priority: this.dmx.priority, cid: this._cid, data: u.buf })
				: encodeArtDmx({ portAddress: u.universe, sequence: u.seq, data: u.buf }))
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
					protocol: fx.protocol, typeId: fx.typeId, mode: fx.mode, moving: fx.moving,
					slots: fx.slots.length, programmed: this._values.has(fx.id),
					through: !this.through.enabled ? null : w <= 0 ? 'console' : w >= 1 ? 'tracking' : 'fading',
					console: this.through.enabled ? cons : null,
					state: fx.problem ? 'not output' : a.state, pan: Math.round(a.pan * 100) / 100,
					tilt: Math.round(a.tilt * 100) / 100, universe: fx.universe, address: fx.address, dest: fx.dest }
			}),
			dmx: { enabled: this.dmx.enabled, priority: this.dmx.priority, universes: [...this.dmx.universes],
				visualise: this.dmx.visualise, sacn_port: this.dmx.sacn_port },
			universes: [...this._uni.values()].map((u) => ({ protocol: u.protocol, dest: `${u.to.host}:${u.to.port}`,
				universe: u.universe, typed: u.typed, live: this._live(u), packets: u.packets,
				last_sent_ms_ago: u.at ? now - u.at : null })),
		}
	}
}

module.exports = { FollowEngine, TICK_MS, REFRESH_MS, HOLD_TTL_MS }
