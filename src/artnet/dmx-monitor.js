'use strict'

/**
 * WO-693 — the DMX viewer behind GET /api/dmx-monitor: what Art-Net / sACN reaches this box. It runs only while a
 * viewer polls it (stops IDLE_MS after the last request) and never sends DMX — only ArtPoll, on request.
 *
 * Art-Net arrives through artnet-tap (the lighting input's :6454 socket, WO-632). While nothing owns :6454 the viewer
 * binds it itself and registers as its owner, publishing to the tap, so the follow read-through drops its own socket
 * instead of a second SO_REUSEADDR bind splitting the unicast; it closes again when another owner appears.
 * sACN: one socket on 5568 joined to the watched universe's group and the universe-discovery group.
 *
 *   artnet.nodes    ArtPollReply answers (POST /api/dmx-monitor/poll sends ArtPoll to every interface's broadcast)
 *   artnet.sources  who sends ArtDmx, and on which port-addresses
 *   sacn.sources    E1.31 senders (data + discovery), by CID
 *   frame           the watched universe's latest 512 slots
 */

const dgramDefault = require('dgram')
const os = require('os')
const tapDefault = require('./artnet-tap')
const { decodeArtDmx, ARTNET_PORT } = require('../fixtures/artdmx')
const { decodeE131, multicastOf, SACN_PORT } = require('../fixtures/sacn')
const C = require('./dmx-monitor-codec')

const IDLE_MS = 15000
const FORGET_MS = 60000

/** IPv4 interfaces as [{ address, broadcast }] (directed broadcast from the netmask). */
function ipv4Interfaces(nets = os.networkInterfaces()) {
	const out = []
	for (const list of Object.values(nets)) {
		for (const i of list || []) {
			if (!i || i.family !== 'IPv4' || i.internal) continue
			const a = i.address.split('.').map(Number)
			const m = String(i.netmask || '255.255.255.0').split('.').map(Number)
			out.push({ address: i.address, broadcast: a.map((x, k) => (x & m[k]) | (~m[k] & 255)).join('.') })
		}
	}
	return out
}

class DmxMonitor {
	constructor({ log, now, dgram = dgramDefault, tap = tapDefault, artnetPort = ARTNET_PORT, sacnPort = SACN_PORT,
		interfaces = ipv4Interfaces } = {}) {
		this.log = typeof log === 'function' ? log : () => {}
		this.now = typeof now === 'function' ? now : () => Date.now()
		this._dgram = dgram
		this._tap = tap
		this._artnetPort = artnetPort
		this._sacnPort = sacnPort
		this._interfaces = interfaces
		this._reset()
		this._timer = null
		this._watch = null
		this._off = null
		this._own = null
		this._owning = false
		this._sacn = null
		this._joined = new Set()
	}

	_reset() {
		this.art = { frames: new Map(), sources: new Map(), nodes: new Map() }
		this.sacn = { frames: new Map(), sources: new Map() }
		this.watched = { protocol: 'artnet', universe: 0 }
	}

	get running() {
		return this._off != null
	}

	/** A viewer asked: start (if idle), watch `protocol` / `universe`, and push the idle stop back. */
	touch({ protocol, universe } = {}) {
		const p = protocol === 'sacn' ? 'sacn' : 'artnet'
		const u = Math.trunc(Number(universe))
		this.watched = { protocol: p, universe: Number.isFinite(u) ? u : p === 'sacn' ? 1 : 0 }
		if (!this.running) this._start()
		if (p === 'sacn') this._joinSacn([this.watched.universe, C.SACN_DISCOVERY_UNIVERSE])
		clearTimeout(this._timer)
		this._timer = setTimeout(() => this.stop(), IDLE_MS)
		this._timer.unref?.()
	}

	_start() {
		this._off = this._tap.subscribe((msg, rinfo) => this.feedArtnet(msg, rinfo))
		const check = () => {
			if (this._owning && this._tap.count() > 1) this._closeOwn()
			else if (!this._owning && !this._own && !this._tap.owned()) this._openOwn()
		}
		check()
		this._watch = setInterval(check, 2000)
		this._watch.unref?.()
		this._openSacn()
		this.log('info', '[dmx-monitor] viewer open — listening for Art-Net / sACN')
	}

	_openOwn() {
		const s = this._dgram.createSocket({ type: 'udp4', reuseAddr: true })
		s.on('error', (e) => this.log('warn', '[dmx-monitor] Art-Net socket: ' + e.message))
		s.on('message', (msg, rinfo) => this._tap.publish(msg, rinfo))
		s.on('listening', () => {
			if (this._own !== s) return
			s.setBroadcast(true)
			this._owning = true
			this._tap.ownerChanged(1)
		})
		s.bind(this._artnetPort, '0.0.0.0')
		this._own = s
	}

	_closeOwn() {
		const s = this._own
		this._own = null
		if (this._owning) this._tap.ownerChanged(-1)
		this._owning = false
		try {
			s?.close()
		} catch (_) {
			/* already closed */
		}
	}

	_openSacn() {
		const s = this._dgram.createSocket({ type: 'udp4', reuseAddr: true })
		s.on('error', (e) => this.log('warn', '[dmx-monitor] sACN socket: ' + e.message))
		s.on('message', (msg, rinfo) => this.feedSacn(msg, rinfo))
		s.on('listening', () => {
			if (this._sacn !== s) return
			this._sacnReady = true
			const want = this._wantJoin || []
			this._wantJoin = null
			this._joinSacn(want)
		})
		this._sacn = s
		this._joined = new Set()
		this._sacnReady = false
		s.bind(this._sacnPort)
	}

	/** Join exactly `universes`' multicast groups (on every IPv4 interface). */
	_joinSacn(universes) {
		const s = this._sacn
		if (!s) return
		if (!this._sacnReady) {
			this._wantJoin = universes
			return
		}
		const want = new Set(universes)
		const each = (u, fn) => {
			for (const i of this._interfaces()) {
				try {
					fn(u === C.SACN_DISCOVERY_UNIVERSE ? C.SACN_DISCOVERY_GROUP : multicastOf(u), i.address)
				} catch (_) {
					/* not joinable there */
				}
			}
		}
		for (const u of this._joined) if (!want.has(u)) each(u, (g, a) => s.dropMembership(g, a))
		for (const u of want) if (!this._joined.has(u)) each(u, (g, a) => s.addMembership(g, a))
		this._joined = want
	}

	feedArtnet(msg, rinfo) {
		const now = this.now()
		const from = rinfo?.address || ''
		const d = decodeArtDmx(msg)
		if (d) {
			let f = this.art.frames.get(d.portAddress)
			if (!f) this.art.frames.set(d.portAddress, (f = { data: new Uint8Array(512), at: 0, from: '', packets: 0 }))
			f.data.fill(0)
			f.data.set(d.data.subarray(0, 512))
			f.at = now
			f.from = from
			f.packets++
			let src = this.art.sources.get(from)
			if (!src) this.art.sources.set(from, (src = { ip: from, universes: new Set(), packets: 0, at: 0 }))
			src.universes.add(d.portAddress)
			src.packets++
			src.at = now
			return
		}
		const r = C.decodeArtPollReply(msg)
		if (r) this.art.nodes.set(`${r.ip}#${r.bindIndex}`, { ...r, from, at: now })
	}

	feedSacn(msg, rinfo) {
		const now = this.now()
		const from = rinfo?.address || ''
		const d = decodeE131(msg)
		if (d) {
			let f = this.sacn.frames.get(d.universe)
			if (!f) this.sacn.frames.set(d.universe, (f = { data: new Uint8Array(512), at: 0, from: '', source: '', priority: 0, packets: 0 }))
			f.data.fill(0)
			f.data.set(d.data)
			Object.assign(f, { at: now, from, source: d.sourceName, priority: d.priority })
			f.packets++
			this._sacnSource(d.cid.toString('hex'), d.sourceName, from, [d.universe], now)
			return
		}
		const disc = C.decodeSacnDiscovery(msg)
		if (disc) this._sacnSource(disc.cid, disc.sourceName, from, disc.universes, now)
	}

	_sacnSource(cid, name, ip, universes, now) {
		let s = this.sacn.sources.get(cid)
		if (!s) this.sacn.sources.set(cid, (s = { cid, name, ip, universes: new Set(), at: 0 }))
		Object.assign(s, { name, ip, at: now })
		for (const u of universes) s.universes.add(u)
	}

	/** ArtPoll to every interface's directed broadcast (from our :6454 socket when we own it). → [broadcast addresses] */
	poll() {
		const pkt = C.encodeArtPoll()
		const to = [...new Set(this._interfaces().filter((i) => i.broadcast !== i.address).map((i) => i.broadcast))] // not /32 tunnels
		const own = this._owning ? this._own : null
		const s = own || this._dgram.createSocket('udp4')
		const send = () => {
			s.setBroadcast(true)
			for (const host of to) s.send(pkt, this._artnetPort, host, (e) => e && this.log('warn', `[dmx-monitor] ArtPoll → ${host}: ${e.message}`))
			if (!own) setTimeout(() => { try { s.close() } catch (_) {} }, 500).unref?.()
		}
		if (own) send()
		else s.bind(0, send)
		return to
	}

	snapshot(now = this.now()) {
		const ownIps = new Set(this._interfaces().map((i) => i.address))
		const local = { has: (ip) => ownIps.has(ip) || String(ip).startsWith('127.') }
		const fresh = (m) => [...m.values()].filter((x) => now - x.at <= FORGET_MS)
		const age = (at) => now - at
		const { protocol, universe } = this.watched
		const f = (protocol === 'sacn' ? this.sacn.frames : this.art.frames).get(universe)
		return {
			running: this.running,
			watched: this.watched,
			artnet: {
				listening: this._owning ? 'own' : this._tap.owned() ? 'shared' : null,
				nodes: fresh(this.art.nodes).map(({ at, ...n }) => ({ ...n, self: local.has(n.ip), age_ms: age(at) })),
				sources: fresh(this.art.sources).map((s) => ({ ip: s.ip, self: local.has(s.ip), universes: [...s.universes].sort((a, b) => a - b),
					packets: s.packets, age_ms: age(s.at) })),
			},
			sacn: {
				listening: this._sacnReady ? this._sacnPort : null,
				sources: fresh(this.sacn.sources).map((s) => ({ cid: s.cid, name: s.name, ip: s.ip, self: local.has(s.ip),
					universes: [...s.universes].filter((u) => u !== C.SACN_DISCOVERY_UNIVERSE).sort((a, b) => a - b), age_ms: age(s.at) })),
			},
			frame: f ? { protocol, universe, from: f.from, source: f.source || '', priority: f.priority ?? null, packets: f.packets,
				age_ms: age(f.at), data: [...f.data] } : null,
		}
	}

	stop() {
		clearTimeout(this._timer)
		this._timer = null
		if (this._watch) clearInterval(this._watch)
		this._watch = null
		this._off?.()
		this._off = null
		this._closeOwn()
		try {
			this._sacn?.close()
		} catch (_) {
			/* already closed */
		}
		this._sacn = null
		this._sacnReady = false
		this._joined = new Set()
		if (this.art.frames.size || this.sacn.frames.size) this.log('info', '[dmx-monitor] viewer closed')
		this._reset()
	}
}

let shared = null
/** The one monitor of this server process. */
function sharedMonitor(log) {
	if (!shared) shared = new DmxMonitor({ log })
	return shared
}

module.exports = { DmxMonitor, sharedMonitor, ipv4Interfaces, IDLE_MS }
