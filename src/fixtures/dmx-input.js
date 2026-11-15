'use strict'

/**
 * WO-615 T7 — visualiser mode: the console's DMX, not ours, drives the previs through the patch
 * (`fixtures.dmx.visualise`). Art-Net arrives through follow-through.js ConsoleFrames (the lighting input's shared
 * :6454 socket, WO-632); sACN through SacnFrames below — one socket on `fixtures.dmx.sacn_port` (5568) joined to the
 * multicast group of every patched sACN universe, also taking unicast. While visualising the engine sends no typed
 * universe at all (follow-engine.js _live), so what we show can never be our own output looping back.
 *
 *   inputFrame(fx, { artnet, sacn })  the fresh console frame of fx's universe, else ZERO (no console = dark rig)
 *
 * WO-1078: a rig driven partly by Art-Net and partly by sACN usually arrives with every fixture patched "artnet" (an
 * MVR carries no protocol). So the visualiser listens to BOTH protocols for every patched universe, and a fixture
 * whose own protocol has no fresh frame takes the other protocol's frame of the same console universe — the box's
 * convention everywhere (MVR import, consoles): console universe N = Art-Net N-1 = sACN N (`twinUniverse`).
 * Linux allows 20 multicast memberships
 * per socket (igmp_max_memberships) and a join costs one per network card, so memberships beyond that go to extra
 * unbound-port sockets: the bound socket still receives those groups (IP_MULTICAST_ALL), and no universe is dropped.
 */

const dgram = require('dgram')
const os = require('os')
const { decodeE131, multicastOf, MAX_UNIVERSE } = require('./sacn')
const { STALE_MS } = require('./follow-through')

const ZERO = new Uint8Array(512)
const MAX_MEMBERSHIPS = 20 // net.ipv4.igmp_max_memberships default, per socket

class SacnFrames {
	constructor({ log, now } = {}) {
		this.log = typeof log === 'function' ? log : () => {}
		this.now = typeof now === 'function' ? now : () => Date.now()
		this.frames = new Map() // universe → { data, at, from, source }
		this.packets = 0
		this._sock = null
		this._port = 0
		this._unis = new Set()
		this._members = new Map() // "group|nic address" → the socket holding that membership
		this._joiners = [] // extra sockets that only hold memberships (WO-1078)
		this.joinFailures = 0
	}

	/** Listen for `universes` on `port` (an empty set closes the socket). */
	configure(universes, port) {
		const want = new Set(universes)
		if (!want.size) return this.stop()
		if (this._sock && port === this._port) return this._join(want)
		this.stop()
		const s = dgram.createSocket({ type: 'udp4', reuseAddr: true })
		s.on('error', (e) => this.log('warn', '[fixtures] sACN input: ' + e.message))
		s.on('message', (msg, rinfo) => this.feed(msg, rinfo))
		s.bind(port, () => {
			if (this._sock !== s) return
			this.log('info', `[fixtures] visualiser: sACN input on :${port}`)
			this._join(want)
		})
		this._sock = s
		this._port = port
		this._unis = new Set()
		this._pending = want
	}

	_join(want) {
		const s = this._sock
		if (!s) return
		const nics = Object.values(os.networkInterfaces())
			.flat()
			.filter((i) => i && i.family === 'IPv4' && !i.internal)
			.map((i) => i.address)
		for (const u of this._unis) {
			if (want.has(u)) continue
			for (const a of nics) this._drop(multicastOf(u), a)
		}
		for (const u of want) for (const a of nics) this._add(multicastOf(u), a)
		this._unis = want
	}

	/** A socket with a free membership: the bound one first, then joiner sockets (made on demand). */
	_holder() {
		const used = new Map()
		for (const h of this._members.values()) used.set(h, (used.get(h) || 0) + 1)
		for (const h of [this._sock, ...this._joiners]) if ((used.get(h) || 0) < MAX_MEMBERSHIPS) return h
		const j = dgram.createSocket({ type: 'udp4', reuseAddr: true })
		j.on('error', (e) => this.log('warn', '[fixtures] sACN input (membership socket): ' + e.message))
		j.unref?.()
		this._joiners.push(j)
		return j
	}

	_add(group, addr) {
		const key = `${group}|${addr}`
		if (this._members.has(key)) return
		const h = this._holder()
		try {
			h.addMembership(group, addr)
			this._members.set(key, h)
		} catch (e) {
			// a card that is down or has no multicast route: expected; anything else must not pass silently
			if (!/ENODEV|EADDRNOTAVAIL|ENETUNREACH/.test(String(e?.code || e?.message))) {
				this.joinFailures++
				this.log('warn', `[fixtures] sACN input: cannot join ${group} on ${addr}: ${e?.message || e}`)
			}
		}
	}

	_drop(group, addr) {
		const key = `${group}|${addr}`
		const h = this._members.get(key)
		if (!h) return
		this._members.delete(key)
		try {
			h.dropMembership(group, addr)
		} catch (_) {
			/* the card went away */
		}
	}

	feed(msg, rinfo) {
		const d = decodeE131(msg)
		if (!d || !this._unis.has(d.universe)) return
		let f = this.frames.get(d.universe)
		if (!f) this.frames.set(d.universe, (f = { data: new Uint8Array(512), at: 0, from: '', source: '' }))
		f.data.fill(0)
		f.data.set(d.data)
		f.at = this.now()
		f.from = rinfo?.address || ''
		f.source = d.sourceName
		this.packets++
	}

	/** The fresh frame of a universe, or null. */
	frame(u, now = this.now()) {
		const f = this.frames.get(u)
		return f && now - f.at <= STALE_MS ? f.data : null
	}

	status(now = this.now()) {
		return { packets: this.packets, port: this._sock ? this._port : null, listening: [...this._unis],
			memberships: this._members.size, join_failures: this.joinFailures,
			universes: [...this.frames].map(([u, f]) => ({ universe: u, from: f.from, source: f.source, age_ms: now - f.at })) }
	}

	stop() {
		try {
			this._sock?.close()
		} catch (_) {
			/* already closed */
		}
		for (const j of this._joiners) {
			try {
				j.close()
			} catch (_) {
				/* already closed */
			}
		}
		this._joiners = []
		this._members.clear()
		this._sock = null
		this._unis = new Set()
		this.frames.clear()
	}
}

/** The same console universe in the other protocol (console universe N = Art-Net N-1 = sACN N), or null. */
function twinUniverse(fx) {
	const u = fx.protocol === 'sacn' ? fx.universe - 1 : fx.universe + 1
	return fx.protocol === 'sacn' ? (u >= 0 ? u : null) : u <= MAX_UNIVERSE ? u : null
}

/** Every sACN universe the visualiser must hear for these fixtures: their own, or the twin of an Art-Net one. */
function sacnUniversesFor(fixtures) {
	const out = new Set()
	for (const fx of fixtures) {
		const u = fx.protocol === 'sacn' ? fx.universe : twinUniverse(fx)
		if (u != null && u >= 1 && u <= MAX_UNIVERSE) out.add(u)
	}
	return [...out]
}

/**
 * The fresh console frame for a patched fixture: its own protocol's, else the other protocol's frame of the same
 * console universe (WO-1078), else ZERO.
 */
function inputFrame(fx, inputs) {
	const sacn = fx.protocol === 'sacn'
	const own = (sacn ? inputs.sacn : inputs.artnet)?.frame(fx.universe)
	if (own) return own
	const twin = twinUniverse(fx)
	return (twin != null && (sacn ? inputs.artnet : inputs.sacn)?.frame(twin)) || ZERO
}

module.exports = { SacnFrames, inputFrame, twinUniverse, sacnUniversesFor, ZERO, MAX_MEMBERSHIPS }
