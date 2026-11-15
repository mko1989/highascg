'use strict'

/**
 * WO-1085 — spot handover in the follow engine: the pure core (src/tracking/auto-handover.js) driven from the engine
 * tick, the head's Dimmer written from its level, the LD's grant channel read from the console's frame, and the
 * "automation levels" universe for a desk that drives the heads itself (PSN only).
 *
 *   project.fixtures.handover: { mode "split" (WO-708, the default — nothing changes) | "handover",
 *     heads (per person, 1–16, 3), margin_m (0–5, 0.5), fade_s (0–10, 1), idle "home" | "dark",
 *     levels: { enabled, protocol "artnet" | "sacn", universe, address, dest ("" = broadcast / multicast) },
 *     grant: { enabled, universe (Art-Net port-address of the console's input), address, per_head } }
 *
 * Dimmer — a typed head's first channel with a `Dimmer` function: level × base, base = the console's dimmer under
 * read-through (the LD keeps the intensity; blended by the read-through weight w like pan / tilt), else the
 * programmer's Dimmer, else full. Colour, zoom, shutter, … stay the console's (read-through) or the programmer's.
 * Grant — a channel in the console's Art-Net frame to this box (per_head: channel address + i for the i-th pool head,
 * patch order); the console input is listened to whenever a grant is configured (follow-service.js).
 *   Rig (own DMX with read-through): a switch — ≥ 50 % = HighAsCG may drive the pool's pan / tilt / Dimmer, < 50 % =
 *   the console's values pass through (the read-through fade). A half-way pan between the desk's and the person's is
 *   no look, so the rig stays a switch; the fade gives it the soft edge.
 *   Levels universe (WO-1085 follow-up, PSN + levels): proportional — every head level × grant / 255, slewed at
 *   1 / fade_s (a fader snapped to 0 still fades the levels), so one desk fader cross-fades the automation in and out.
 * Fail-safe: the last fresh value is held GRANT_HOLD_MS after the console frame goes stale (STALE_MS 2.5 s), then the
 * grant is released — the read-through fades the heads back to the console's last frame (ConsoleFrames.last), and the
 * levels fade to 0 (HighAsCG no longer hears the LD's permission, so it stops asking for light). A console never seen
 * = not granted. No grant configured = full scale, as before.
 * Levels universe — channel address + i = pool head i's level 0–255 (patch order), then 1 "someone followed", 9 for
 * A1…A9, 9 for Pin 1…9 (255 while that lane's person is tracked; never scaled — information), then 1 echoing the
 * grant applied now (0 with no grant configured). Sent while the follow output master is on, through the engine's
 * send (lighting duty), never onto a rig universe, the grant's universe or this box's own input.
 */

const { createHandover, thresholds } = require('../tracking/auto-handover')
const { AUTO_MARKER_ID } = require('../tracking/auto-follow')
const { aimFixture } = require('./gdtf-ik')
const { valueFor } = require('./gdtf-patch')
const { encodeArtDmx, parseDest, MAX_PORT_ADDRESS } = require('./artdmx')
const { encodeE131, sacnDest, MAX_UNIVERSE } = require('./sacn')

const GRANT_HOLD_MS = 5000
const REFRESH_MS = 1000
const AUTO_LANES = 9
const PIN_BASE = 64980 // auto-director.js Pin k = 64980 + k
const EXTRA_CH = 1 + AUTO_LANES * 2 + 1 // + the grant echo

const num = (v, d, lo, hi) => {
	const n = Number(v)
	return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d
}
const int = (v, d, lo, hi) => Math.round(num(v, d, lo, hi))

/** project.fixtures.handover → every field valid (twin: godot/…/tracking/handover_model.gd normalize). */
function normalizeHandover(raw) {
	const o = raw && typeof raw === 'object' ? raw : {}
	const l = o.levels && typeof o.levels === 'object' ? o.levels : {}
	const g = o.grant && typeof o.grant === 'object' ? o.grant : {}
	const sacn = l.protocol === 'sacn'
	return {
		mode: o.mode === 'handover' ? 'handover' : 'split',
		heads: int(o.heads, 3, 1, 16),
		margin_m: num(o.margin_m, 0.5, 0, 5),
		fade_s: num(o.fade_s, 1, 0, 10),
		idle: o.idle === 'dark' ? 'dark' : 'home',
		levels: {
			enabled: l.enabled === true,
			protocol: sacn ? 'sacn' : 'artnet',
			universe: sacn ? int(l.universe, 100, 1, MAX_UNIVERSE) : int(l.universe, 100, 0, MAX_PORT_ADDRESS),
			address: int(l.address, 1, 1, 512),
			dest: typeof l.dest === 'string' ? l.dest.trim().slice(0, 64) : '',
		},
		grant: {
			enabled: g.enabled === true,
			universe: int(g.universe, 0, 0, MAX_PORT_ADDRESS),
			address: int(g.address, 512, 1, 512),
			per_head: g.per_head === true,
		},
	}
}

/** A typed head's Dimmer: { c, f } (the channel and its Dimmer function), or null. */
function dimmerOf(fx) {
	for (const c of fx.gdtf?.channels || []) {
		const f = c.functions.find((q) => q.attribute === 'Dimmer')
		if (f) return { c, f }
	}
	return null
}

const readCh = (src, base, c) => c.offsets.reduce((v, o) => v * 256 + (src[base + o - 1] ?? 0), 0)
function writeCh(buf, base, c, v) {
	const n = c.offsets.length
	for (let i = 0; i < n; i++) {
		const at = base + c.offsets[i] - 1
		if (at >= 0 && at < 512) buf[at] = Math.floor(v / 256 ** (n - 1 - i)) & 0xff
	}
}

class FollowHandover {
	/** @param {import('./follow-engine').FollowEngine} engine */
	constructor(engine) {
		this.engine = engine
		this.cfg = normalizeHandover(null)
		this.core = createHandover()
		this.decisions = null // fixture id → { lane, phase, level, target } (handover mode)
		this.lanes = [] // the director's lanes this tick: [{ id, marker }]
		this.thresholds = []
		this._dim = new Map() // fixture id → dimmer { c, f }
		this._grant = { state: 'off', data: null, at: 0 }
		this._applied = null // the levels' grant now, 0…1 per head (per_head) or [one]; null = unscaled
		this._appliedAt = null
		this._levels = { to: null, problem: null, buf: new Uint8Array(512), last: null, at: 0, seq: 0, packets: 0 }
	}

	/** After the engine configured its patch. */
	configure(raw) {
		const e = this.engine
		this.cfg = normalizeHandover(raw)
		if (this.cfg.mode !== 'handover') this.core.reset()
		this._dim = new Map(e.fixtures.map((f) => [f.id, dimmerOf(f)]).filter(([, d]) => d))
		this.thresholds = thresholds(this._heads().map((f) => ({ id: f.id, x: f.pose.x, y: f.pose.y })), this.cfg.heads)
		const L = this.cfg.levels
		const to = L.protocol === 'sacn' ? sacnDest(L.dest, L.universe) : parseDest(L.dest || '255.255.255.255')
		let problem = null
		const hit = e.fixtures.find((f) => f.protocol === L.protocol && f.universe === L.universe)
		const reads = new Set()
		if (e.through.enabled) for (const f of e.fixtures) if (f.protocol === 'artnet') reads.add(f.universe + e.through.offset)
		if (this.cfg.grant.enabled) reads.add(this.cfg.grant.universe)
		if (!to) problem = `bad destination "${L.dest}"`
		else if (hit) problem = `universe ${L.universe} is the rig's (${hit.name})`
		else if (this.cfg.grant.enabled && L.protocol === 'artnet' && L.universe === this.cfg.grant.universe) problem = `universe ${L.universe} is the grant's`
		else if (e._isSelfLoop(to, L.universe, L.protocol)) problem = "would loop into this box's own input"
		else if (L.protocol === 'artnet' && reads.has(L.universe) && e._reachesSelf(to)) problem = 'would be read back as the console frame'
		else if (L.address - 1 + this._pool().length + EXTRA_CH > 512) problem = 'runs past channel 512'
		if (to !== this._levels.to || problem) this._levels.last = null
		Object.assign(this._levels, { to, problem })
	}

	_pool() {
		return this.engine.fixtures.filter((f) => f.follow === AUTO_MARKER_ID)
	}

	_heads() {
		return this._pool().filter((f) => f.enabled && !f.problem && f.moving)
	}

	_thru() {
		const e = this.engine
		return e.through.enabled && e.protocol === 'artnet' && !!e.consoleFrames
	}

	/** Read the grant channel's universe (once per tick). */
	_readGrant(now) {
		const g = this.cfg.grant
		if (!g.enabled || !this.engine.consoleFrames) return void (this._grant = { state: 'off', data: null, at: 0 })
		const f = this.engine.consoleFrames.frame(g.universe, now)
		if (f) this._grant = { state: 'live', data: Uint8Array.from(f), at: now }
		else if (this._grant.data && now - this._grant.at <= GRANT_HOLD_MS) this._grant.state = 'held'
		else this._grant = { state: this._grant.at ? 'lost' : 'none', data: null, at: this._grant.at }
	}

	/** The levels' grant: towards the fresh / held value (0 once lost), at 1 / fade_s per second. */
	_slewGrant(now) {
		const g = this.cfg.grant
		if (this._grant.state === 'off') return void ((this._applied = null), (this._appliedAt = null))
		const dt = this._appliedAt === null ? 0 : Math.max(0, Math.min(0.5, (now - this._appliedAt) / 1000))
		this._appliedAt = now
		const step = this.cfg.fade_s > 0 ? dt / this.cfg.fade_s : Infinity
		const d = this._grant.data
		const prev = this._applied || []
		this._applied = Array.from({ length: g.per_head ? this._pool().length : 1 }, (_, i) => {
			const want = d ? (d[g.address - 1 + i] ?? 0) / 255 : 0
			const cur = prev[i] ?? 0
			return want > cur ? Math.min(want, cur + step) : Math.max(want, cur - step)
		})
	}

	/** May HighAsCG drive this Auto head of the rig now (the LD's grant, read-through only)? */
	granted(fx) {
		const g = this.cfg.grant
		if (this._grant.state === 'off' || !this._thru()) return true
		if (!this._grant.data) return false
		const i = g.per_head ? this._pool().indexOf(fx) : 0
		return i >= 0 && (this._grant.data[g.address - 1 + i] ?? 0) >= 128
	}

	/** One engine tick, before the fixtures are aimed. */
	step(now, marks) {
		const e = this.engine
		this._readGrant(now)
		this._slewGrant(now)
		const on = this.cfg.mode === 'handover'
		const input = typeof e.autoLanes === 'function' ? e.autoLanes(on ? (uid) => this.core.activeFor(uid) : null) : null
		this.lanes = Array.isArray(input?.lanes) ? input.lanes : []
		if (!on || !input) return void (this.decisions = null)
		const heads = this._heads()
		const byId = new Map(heads.map((f) => [f.id, f]))
		const lanes = []
		for (const l of this.lanes) {
			const m = marks.get(l.marker)
			if (m && !m.stale) lanes.push({ id: l.id, x: m.x, y: m.y, mark: m })
		}
		const laneOf = new Map(lanes.map((l) => [l.id, l]))
		const reach = (id, laneId) => {
			const fx = byId.get(id)
			const m = laneOf.get(laneId)?.mark
			return !!fx && !!m && aimFixture(fx, [m.x, m.y, m.z + fx.aim_z], e.aimOf(id)) !== null
		}
		this.decisions = this.core.step({
			now,
			heads: heads.map((f) => ({ id: f.id, x: f.pose.x, y: f.pose.y })),
			lanes,
			home: input.home instanceof Map ? input.home : null,
			settings: this.cfg,
			reach,
			usable: (id) => this.granted(byId.get(id)),
		})
	}

	/** This Auto head's decision (handover mode), or null (Split: the WO-708 path). */
	decide(fx) {
		return this.decisions?.get(fx.id) || null
	}

	/** The engine's next aim for a handover head: aim at its target, else hold (rest / its person gone). */
	aim(fx, hd, prev) {
		const t = hd.target
		const state = hd.phase === 'rest' ? 'rest' : `spot ${hd.phase}`
		if (!t || t.stale) return { ...prev, state }
		const pt = aimFixture(fx, [t.x, t.y, t.z + fx.aim_z], prev)
		return pt ? { ...pt, state } : { ...prev, state: 'out of range' }
	}

	/** Write the head's Dimmer: base × ((1 − w) + w × level); base = console | programmer | full (see the header). */
	dim(buf, fx, hd, cf, w) {
		const d = this._dim.get(fx.id)
		if (!d) return
		const { c, f } = d
		const base = fx.address - 1
		const up = f.physTo >= f.physFrom
		const zero = up ? f.from : f.to
		const full = cf ? readCh(cf, base, c) : valueFor(this.engine._values.get(fx.id), c) ? readCh(buf, base, c) : up ? f.to : f.from
		const k = (1 - w) + w * hd.level
		writeCh(buf, base, c, Math.round(zero + (full - zero) * k))
	}

	/** The levels universe after the tick: built every tick, sent on change / every second while live. → packets. */
	send(now, marks) {
		const L = this.cfg.levels
		const u = this._levels
		const b = u.buf
		b.fill(0)
		const pool = this._pool()
		const e = this.engine
		pool.forEach((fx, i) => {
			const hd = this.decisions?.get(fx.id)
			const st = e._aim.get(fx.id)?.state
			const v = this.cfg.mode === 'handover' ? (hd ? hd.level : 0) : st === 'following' || st === 'home' ? 1 : 0
			const k = this._applied ? (this._applied[this.cfg.grant.per_head ? i : 0] ?? 0) : 1
			if (L.address - 1 + i < 512) b[L.address - 1 + i] = Math.round(v * k * 255)
		})
		const at = L.address - 1 + pool.length
		for (const l of this.lanes) {
			const m = marks.get(l.marker)
			if (!m || m.stale || !(Number(m.status ?? 1) > 0)) continue
			const k = l.marker > PIN_BASE + AUTO_LANES ? AUTO_MARKER_ID - l.marker : AUTO_LANES + l.marker - PIN_BASE - 1
			if (at < 512) b[at] = 255
			if (k >= 0 && k < AUTO_LANES * 2 && at + 1 + k < 512) b[at + 1 + k] = 255
		}
		if (this._applied && at + EXTRA_CH - 1 < 512) b[at + EXTRA_CH - 1] = this._echo()
		if (!L.enabled || !u.to || u.problem || !e.enabled) return 0
		if (u.last && Buffer.from(b).equals(u.last) && now - u.at < REFRESH_MS) return 0
		u.seq = (u.seq % 255) + 1
		e._send(u.to, L.protocol === 'sacn'
			? encodeE131({ universe: L.universe, sequence: u.seq, priority: e.dmx.priority, cid: e._cid, data: b })
			: encodeArtDmx({ portAddress: L.universe, sequence: u.seq, data: b }))
		u.last = Buffer.from(b)
		u.at = now
		u.packets++
		return 1
	}

	/** The grant applied to the levels now, 0–255 (per head: their mean) — echoed after the presence channels. */
	_echo() {
		const a = this._applied || []
		return a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 255) : 0
	}

	status() {
		const L = this.cfg.levels
		const u = this._levels
		return {
			...this.cfg,
			levels: { ...L, problem: u.problem, live: L.enabled && !u.problem && !!u.to && this.engine.enabled, packets: u.packets },
			grant: { ...this.cfg.grant, state: this._grant.state, age_ms: this._grant.at ? this.engine.now() - this._grant.at : null,
				applies: this._thru() ? 'rig' : 'levels', value: this._grant.data?.[this.cfg.grant.address - 1] ?? null,
				applied: this._applied ? this._echo() : null,
				// own DMX without read-through: no console frame to hand the rig back to — the grant scales the levels only
				needs_through: this.cfg.grant.enabled && this.engine.protocol === 'artnet' && !this._thru() },
			thresholds: this.thresholds,
			no_dimmer: this._heads().filter((f) => !this._dim.has(f.id)).map((f) => f.id),
		}
	}
}

module.exports = { FollowHandover, normalizeHandover, GRANT_HOLD_MS, EXTRA_CH }
