'use strict'

/**
 * WO-1097 — the "desk feed": the fronts' FINAL pan / tilt / dimmer — after tracking, the calibration (offset /
 * offset_map pins, the calibrated pose), the GDTF IK, Auto follow and the WO-1085 spot handover — sent to the lighting
 * DESK on a universe its show does not output. On the desk the LD puts it under a fader (merge / take-over); the desk
 * stays the only thing talking to the rig. Layout and table: desk-feed-layout.js.
 *
 * Same code path as the rig: the bytes are tapped from the engine's own per-fixture frame after the tick (engine.frameOf,
 * after aim / offsets / IK / the handover Dimmer), so mirror-layout pan / tilt / dimmer are byte-for-byte what the
 * engine would put on the head's real channels (its invert and ranges included). In Split mode (no handover decision)
 * the engine leaves a typed head's Dimmer to the programmer / GDTF default, so the feed applies the handover's own
 * dimmer writer (follow-handover.js dim) with level 1 while the head is aimed (following, home, calibrating) and 0
 * otherwise — the levels universe's rule.
 * The LD's grant channel (follow-handover.js, the console → this box, slewed over fade_s, 0 once the console is lost)
 * scales the fed dimmers like it scales the levels universe: one desk fader = HighAsCG's dimmer master on any desk.
 * Not fed (resting, no person, parked after leaving the pool): the last aim the feed sent is held, dimmer 0, active 0 —
 * never a snap to 0 / 0. Sent only while `feed.enabled`, independent of the follow output master and the rig DMX master
 * (the box never has to talk to the rig in this mode); through the engine's send (lighting duty). Refresh: on change
 * (engine rate while moving), else every REFRESH_MS. Refused (status `problems`): no / bad destination, an Art-Net
 * broadcast, a rig output universe, the levels or grant universe, a universe read back as console input, this box's
 * own input (the WO-845 self-loop guard), compact past channel 512.
 */

const { encodeArtDmx } = require('./artdmx')
const { encodeE131 } = require('./sacn')
const L = require('./desk-feed-layout')
const { visualReads } = require('./dmx-input')

const REFRESH_MS = 1000
const RATE_WINDOW_MS = 2000
const AIMED = new Set(['following', 'home', 'calibrating'])

class DeskFeed {
	/** @param {import('./follow-engine').FollowEngine} engine */
	constructor(engine) {
		this.engine = engine
		this.cfg = L.normalizeFeed(null)
		this._gen = 0 // bumped by configure — the layout is rebuilt on the next send
		this._key = ''
		this.layout = { universes: [], heads: [], overflow: [] }
		this._uni = new Map() // feed universe → { to, problem, buf, last, at, seq, packets }
		this._held = new Map() // fixture id → Map(abs channel → byte): the pan / tilt the feed last sent while active
		this._parked = new Set()
		this._fedIds = new Set()
		this._sentAt = []
		this._active = []
	}

	configure(raw) {
		const was = this.cfg.enabled
		this.cfg = L.normalizeFeed(raw)
		if (!this.cfg.enabled || !was) this._parked.clear()
		this._gen++
	}

	/** Rebuild the layout and the per-universe refusals when the patch / settings / fed set changed. */
	_relayout() {
		const e = this.engine
		const live = new Set(e.fixtures.map((f) => f.id))
		const following = new Set(L.feedHeads(e.fixtures).map((f) => f.id))
		for (const id of this._fedIds) if (!following.has(id) && live.has(id)) this._parked.add(id)
		for (const id of [...this._parked]) if (following.has(id) || !live.has(id)) this._parked.delete(id)
		const heads = L.feedHeads(e.fixtures, this._parked)
		const key = `${this._gen}|${heads.map((f) => f.id).join(',')}`
		if (key === this._key) return
		this._key = key
		this._fedIds = new Set(heads.map((f) => f.id))
		this.layout = L.buildLayout(heads, this.cfg)
		const h = e.handover.cfg
		const reads = new Set()
		if (e.through.enabled) for (const f of e.fixtures) if (f.protocol === 'artnet') reads.add(f.universe + e.through.offset)
		if (h.grant.enabled) reads.add(h.grant.universe)
		const vis = visualReads(e.fixtures, e.dmx) // WO-1106 B17: + the visualiser's universes and their WO-1078 twins
		for (const u of vis.artnet) reads.add(u)
		const ctx = { fixtures: e.fixtures, levels: h.levels, grant: h.grant, reads, sacnReads: vis.sacn, isSelfLoop: e._isSelfLoop,
			reachesSelf: e._reachesSelf, sacnReachesSelf: e._sacnReachesSelf }
		const next = new Map()
		for (const u of this.layout.universes) {
			const to = L.feedDest(this.cfg, u)
			const old = this._uni.get(u)
			next.set(u, { to, problem: L.refusal(this.cfg, u, to, ctx), buf: new Uint8Array(512), last: null, at: 0,
				seq: old?.seq || 0, packets: old?.packets || 0 })
		}
		this._uni = next
	}

	/** One head's bytes for this tick → (abs 0-based channel) → byte, plus active / level. */
	_head(fx) {
		const e = this.engine
		const src = e.frameOf(fx)
		if (!src) return null
		const parked = this._parked.has(fx.id)
		const hd = parked ? null : e.handover.decide(fx)
		const active = !parked && (hd ? hd.phase !== 'rest' : AIMED.has(e._aim.get(fx.id)?.state))
		const k = this._grantOf(fx)
		const level = (hd ? hd.level : active ? 1 : 0) * k
		let dimSrc = src
		if (!hd) {
			dimSrc = Uint8Array.from(src) // Split / parked: the handover's own dimmer writer at level 1 / 0
			e.handover.dim(dimSrc, fx, { level }, null, 1)
		} else if (k < 1) {
			dimSrc = Uint8Array.from(src) // the LD's grant fader scales the final dimmer towards dark
			e.handover.dim(dimSrc, fx, { level: k }, src, 1)
		}
		const base = fx.address - 1
		const ptAbs = [fx.pan.ch, fx.pan.fine, fx.tilt.ch, fx.tilt.fine].filter(Boolean).map((c) => base + c - 1)
		let held = this._held.get(fx.id)
		if (active || !held) {
			held = new Map(ptAbs.map((i) => [i, src[i]]))
			this._held.set(fx.id, held)
		}
		return { byte: (abs) => (held.has(abs) ? held.get(abs) : dimSrc[abs]), active, level }
	}

	/**
	 * The LD's grant (WO-1085 grant channel, slewed, 0 once lost) for this head: 1 when no grant is configured.
	 * WO-1106 B15: per_head, a fed head outside the Auto pool (a named marker) has no channel of its own — it takes the
	 * first one (`address`); indexOf −1 used to read as grant 0 and kept it dark whatever the console granted.
	 */
	_grantOf(fx) {
		const h = this.engine.handover
		if (!h._applied) return 1
		const i = h.cfg.grant.per_head ? h._pool().indexOf(fx) : 0
		return h._applied[Math.max(0, i)] ?? 0
	}

	/** Build the feed universes after the engine's tick and send what changed / is due. → packets sent. */
	send(now) {
		if (!this.cfg.enabled) {
			this._fedIds.clear()
			this._key = ''
			return 0
		}
		this._relayout()
		for (const u of this._uni.values()) u.buf.fill(0)
		const active = []
		for (const { fx, slots } of this.layout.heads) {
			const h = this._head(fx)
			if (!h) continue
			if (h.active) active.push(fx.name)
			for (const s of slots) {
				const u = this._uni.get(s.feedUniverse)
				const v = s.role === 'active' ? (h.active ? 255 : 0) : s.role === 'level' ? Math.round(h.level * 255)
					: s.ch ? h.byte(fx.address - 1 + s.ch - 1) : 0
				if (u) u.buf[s.feedCh - 1] = v
			}
		}
		this._active = active
		const ids = new Set(this.engine.fixtures.map((f) => f.id))
		for (const id of [...this._held.keys()]) if (!ids.has(id)) this._held.delete(id)
		let sent = 0
		for (const [universe, u] of this._uni) {
			if (u.problem) continue
			if (u.last && Buffer.from(u.buf).equals(u.last) && now - u.at < REFRESH_MS) continue
			u.seq = (u.seq % 255) + 1
			this.engine._send(u.to, this.cfg.protocol === 'sacn'
				? encodeE131({ universe, sequence: u.seq, priority: this.cfg.priority, cid: this.engine._cid, sourceName: 'HighAsCG desk feed', data: u.buf })
				: encodeArtDmx({ portAddress: universe, sequence: u.seq, data: u.buf }))
			u.last = Buffer.from(u.buf)
			u.at = now
			u.packets++
			this._sentAt.push(now)
			sent++
		}
		while (this._sentAt.length && now - this._sentAt[0] > RATE_WINDOW_MS) this._sentAt.shift()
		return sent
	}

	/** The LD's channel table from the actual patch (also when the feed is off: what it WOULD carry). */
	table() {
		const heads = L.feedHeads(this.engine.fixtures, this._parked)
		return L.tableRows(this.cfg.enabled ? this.layout : L.buildLayout(heads, this.cfg), this.cfg)
	}

	status() {
		const now = this.engine.now()
		while (this._sentAt.length && now - this._sentAt[0] > RATE_WINDOW_MS) this._sentAt.shift()
		const universes = [...this._uni].map(([universe, u]) => ({ universe, dest: u.to ? `${u.to.host}:${u.to.port}` : null,
			problem: u.problem, packets: u.packets, last_sent_ms_ago: u.at ? now - u.at : null }))
		const problems = universes.filter((u) => u.problem).map((u) => `U${u.universe}: ${u.problem}`)
		if (this.layout.overflow.length) problems.push(`${this.layout.overflow.length} head(s) past the last channel / universe`)
		return {
			...this.cfg,
			live: this.cfg.enabled && universes.length > 0 && universes.every((u) => !u.problem),
			heads: this.cfg.enabled ? this.layout.heads.length : L.feedHeads(this.engine.fixtures).length,
			active: this.cfg.enabled ? this._active : [],
			parked: [...this._parked],
			universes,
			problems: this.cfg.enabled ? problems : [],
			pps: Math.round((this._sentAt.length / (RATE_WINDOW_MS / 1000)) * 10) / 10,
		}
	}
}

module.exports = { DeskFeed, REFRESH_MS }
