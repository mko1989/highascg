'use strict'

/**
 * WO-632 — Art-Net read-through for the follow backup (owner, next.md: "can the artnet value be read before its
 * changed, so it aligns with the console values until it starts tracking then the output is turned on and the
 * transition is seemless").
 *
 * The console sends the heads' universes to this box (port-address = output universe + `offset`); the box passes
 * every channel through and owns only pan / tilt (+ the fixed channels) of a following head, faded in over
 * `fade_s` when its marker is tracked (valid, fresh) and faded back to the console's values when it is lost.
 * The fade is in degrees, and a head starting to track takes the console's aim as its IK start, so it picks the
 * pan solution nearest where the console left it (no 360° swing). No console frame for a universe (never seen, or
 * older than STALE_MS) → the engine's normal output for it.
 *
 *   output.through: { enabled: false, offset: 0 (input = output universe + offset), fade_s: 1 }
 */

const dgram = require('dgram')
const { decodeArtDmx, ARTNET_PORT, MAX_PORT_ADDRESS } = require('./artdmx')
const { axisBytes } = require('./follow-ik')
const tap = require('../artnet/artnet-tap')

const STALE_MS = 2500
// WO-796: a desk on this box (MagicQ PC, WO-792) unicasts here. Its own :6454 socket would take datagrams sent to
// 127.0.0.1 from ours (the later SO_REUSEADDR bind wins); an exact-address bind wins over every wildcard one.
const LOCAL_DESK_HOST = '127.0.0.2'

const num = (v, d, lo, hi) => {
	const n = Number(v)
	return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d
}

function normalizeThrough(raw) {
	const o = raw && typeof raw === 'object' ? raw : {}
	return { enabled: o.enabled === true, offset: Math.round(num(o.offset, 0, -MAX_PORT_ADDRESS, MAX_PORT_ADDRESS)),
		fade_s: num(o.fade_s, 1, 0, 30) }
}

/** The console's angle for an axis (degrees from centre) — axisBytes inverted. */
function axisDeg(ax, frame, address) {
	const at = (ch) => frame[address - 1 + ch - 1] ?? 0
	let n = ax.fine ? ((at(ax.ch) << 8) | at(ax.fine)) / 65535 : at(ax.ch) / 255
	if (ax.invert) n = 1 - n
	return n * ax.range - ax.range / 2
}

/** { pan, tilt } the console is giving fixture fx in this frame. */
function consoleAim(fx, frame) {
	return { pan: axisDeg(fx.pan, frame, fx.address), tilt: axisDeg(fx.tilt, frame, fx.address) }
}

/**
 * Write fx into buf (already holding the console frame) at weight w (0 = console, 1 = tracking): pan / tilt
 * blended in degrees, fixed channels blended in DMX.
 */
function blendFixture(buf, fx, frame, pt, fixed, w) {
	const put = (ch, v) => {
		const i = fx.address - 1 + ch - 1
		if (i >= 0 && i < 512) buf[i] = v
	}
	const c = consoleAim(fx, frame)
	for (const f of fixed) put(f.ch, Math.round(frame[fx.address - 1 + f.ch - 1] * (1 - w) + f.value * w))
	for (const [ax, from, to] of [[fx.pan, c.pan, pt.pan], [fx.tilt, c.tilt, pt.tilt]]) {
		const b = axisBytes(ax, from + (to - from) * w)
		put(ax.ch, b[0])
		if (ax.fine) put(ax.fine, b[1])
	}
}

/**
 * The console's latest frame per port-address, from the lighting input's socket (artnet-tap). While nothing owns
 * :6454 (Art-Net input off / sACN) it binds its own socket there; it never sends. WO-796: plus LOCAL_DESK_HOST:6454
 * while started, for a desk running on this box.
 */
class ConsoleFrames {
	constructor({ log, now, bind = true } = {}) {
		this.log = typeof log === 'function' ? log : () => {}
		this.now = typeof now === 'function' ? now : () => Date.now()
		this.frames = new Map() // port-address → { data: Uint8Array(512), at, from }
		this.packets = 0
		this._bind = bind
		this._sock = null
		this._local = null
		this._off = null
		this._watch = null
	}

	start() {
		if (this._off) return
		this._off = tap.subscribe((msg, rinfo) => this.feed(msg, rinfo))
		if (!this._bind) return
		this._local = this._listen(LOCAL_DESK_HOST, 'local desk socket')
		const check = () => (tap.owned() ? this._closeOwn() : this._openOwn())
		check()
		this._watch = setInterval(check, 2000)
		this._watch.unref?.()
	}

	stop() {
		this._off?.()
		this._off = null
		if (this._watch) clearInterval(this._watch)
		this._watch = null
		this._closeOwn()
		this._close(this._local)
		this._local = null
		this.frames.clear()
	}

	_listen(host, what) {
		const s = dgram.createSocket({ type: 'udp4', reuseAddr: true })
		s.on('error', (e) => this.log('warn', `[follow] ${what}: ${e.message}`))
		s.on('message', (msg, rinfo) => this.feed(msg, rinfo))
		s.bind(ARTNET_PORT, host)
		return s
	}

	_close(s) {
		try {
			s?.close()
		} catch (_) {}
	}

	_openOwn() {
		if (this._sock) return
		this._sock = this._listen('0.0.0.0', 'read-through socket')
		this.log('info', '[follow] read-through: no Art-Net input socket — listening on :6454 itself')
	}

	_closeOwn() {
		this._close(this._sock)
		this._sock = null
	}

	feed(msg, rinfo) {
		const d = decodeArtDmx(msg)
		if (!d) return
		let f = this.frames.get(d.portAddress)
		if (!f) this.frames.set(d.portAddress, (f = { data: new Uint8Array(512), at: 0, from: '' }))
		f.data.fill(0)
		f.data.set(d.data.subarray(0, 512))
		f.at = this.now()
		f.from = rinfo?.address || ''
		this.packets++
	}

	/** The fresh frame for a port-address, or null. */
	frame(pa, now = this.now()) {
		const f = this.frames.get(pa)
		return f && now - f.at <= STALE_MS ? f.data : null
	}

	/** The last frame for a port-address at any age (a lost console's look is held, never blacked out), or null. */
	last(pa) {
		return this.frames.get(pa)?.data || null
	}

	status(now = this.now()) {
		return { packets: this.packets, own_socket: !!this._sock, local_desk: this._local ? LOCAL_DESK_HOST : null,
			universes: [...this.frames].map(([pa, f]) => ({ universe: pa, from: f.from, age_ms: now - f.at })) }
	}
}

module.exports = { STALE_MS, LOCAL_DESK_HOST, normalizeThrough, axisDeg, consoleAim, blendFixture, ConsoleFrames }
