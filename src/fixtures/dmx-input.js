'use strict'

/**
 * WO-615 T7 — visualiser mode: the console's DMX, not ours, drives the previs through the patch
 * (`fixtures.dmx.visualise`). Art-Net arrives through follow-through.js ConsoleFrames (the lighting input's shared
 * :6454 socket, WO-632); sACN through SacnFrames below — one socket on `fixtures.dmx.sacn_port` (5568) joined to the
 * multicast group of every patched sACN universe, also taking unicast. While visualising the engine sends no typed
 * universe at all (follow-engine.js _live), so what we show can never be our own output looping back.
 *
 *   inputFrame(fx, { artnet, sacn })  the fresh console frame of fx's universe, else ZERO (no console = dark rig)
 */

const dgram = require('dgram')
const os = require('os')
const { decodeE131, multicastOf } = require('./sacn')
const { STALE_MS } = require('./follow-through')

const ZERO = new Uint8Array(512)

class SacnFrames {
	constructor({ log, now } = {}) {
		this.log = typeof log === 'function' ? log : () => {}
		this.now = typeof now === 'function' ? now : () => Date.now()
		this.frames = new Map() // universe → { data, at, from, source }
		this.packets = 0
		this._sock = null
		this._port = 0
		this._unis = new Set()
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
		const ifaces = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4')
		const each = (u, fn) => {
			for (const i of ifaces) {
				try {
					fn(multicastOf(u), i.address)
				} catch (_) {
					/* not joinable on that interface (down, no multicast) */
				}
			}
		}
		for (const u of this._unis) if (!want.has(u)) each(u, (g, a) => s.dropMembership(g, a))
		for (const u of want) if (!this._unis.has(u)) each(u, (g, a) => s.addMembership(g, a))
		this._unis = want
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
			universes: [...this.frames].map(([u, f]) => ({ universe: u, from: f.from, source: f.source, age_ms: now - f.at })) }
	}

	stop() {
		try {
			this._sock?.close()
		} catch (_) {
			/* already closed */
		}
		this._sock = null
		this._unis = new Set()
		this.frames.clear()
	}
}

/** The fresh console frame for a patched fixture's universe, else ZERO. */
function inputFrame(fx, inputs) {
	const src = fx.protocol === 'sacn' ? inputs.sacn : inputs.artnet
	return src?.frame(fx.universe) || ZERO
}

module.exports = { SacnFrames, inputFrame, ZERO }
