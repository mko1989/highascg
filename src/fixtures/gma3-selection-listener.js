'use strict'

/**
 * WO-857 — the UDP listener for the grandMA3 selection plugin (tools/lighting/grandma3/highascg_selection.lua). One text
 * datagram per selection change (and a keep-alive every few seconds, so a lost packet heals):
 *
 *   HACG-SEL 1 <source> <seq> <heads>
 *     source  short lower-case name of the sender (the plugin sends "gma3")
 *     seq     whole number that grows with every packet of one plugin run (a restart starts from the clock, so it grows
 *             across runs too); a packet whose seq is not newer than the last one from that sender is dropped
 *     heads   FixtureIDs: "101,102,110-115,121", "-" = nothing selected
 *
 * It only feeds console-selection.js (the common feed); it never answers and never reaches the lighting consoles.
 * Port: 6290/udp by default (free on the box, see ss -ulpn), `HIGHASCG_GMA3_SELECTION_PORT` or config
 * `lighting.gma3SelectionPort`; 0 / "off" turns it off. Bind: `HIGHASCG_GMA3_SELECTION_BIND` or `lighting.gma3SelectionBind`
 * (default 0.0.0.0 — the console is another machine). A sandbox server (HIGHASCG_SANDBOX) or a node test run listens only
 * when a port is set.
 */

const dgram = require('dgram')
const { MAX_HEADS } = require('./console-selection')

const DEFAULT_PORT = 6290
const MAX_DATAGRAM = 16384
const LINE = /^HACG-SEL 1 ([a-z0-9][a-z0-9_.-]{0,31}) (\d{1,10}) (-|[\d,-]+)\s*$/

/** "101,102,110-115" → [101, 102, 110…115] (unique, in order), or null when malformed / over MAX_HEADS. */
function parseHeads(text) {
	if (text === '-') return []
	const out = []
	const seen = new Set()
	for (const part of text.split(',')) {
		const m = /^(\d{1,10})(?:-(\d{1,10}))?$/.exec(part)
		if (!m) return null
		const a = Number(m[1])
		const b = m[2] === undefined ? a : Number(m[2])
		if (a < 1 || b < a || b - a >= MAX_HEADS) return null
		for (let n = a; n <= b; n++) {
			if (seen.has(n)) continue
			if (out.length >= MAX_HEADS) return null
			seen.add(n)
			out.push(n)
		}
	}
	return out
}

/** One datagram → { source, seq, heads } or null. */
function parsePacket(buf) {
	if (!buf || buf.length === 0 || buf.length > MAX_DATAGRAM) return null
	const m = LINE.exec(buf.toString('utf8'))
	if (!m) return null
	const heads = parseHeads(m[3])
	return heads ? { source: m[1], seq: Number(m[2]), heads } : null
}

/** The sender's side (tests and the plugin's documentation): heads → the wire text, runs of 3+ as ranges. */
function encodePacket(source, seq, heads) {
	const list = [...new Set(heads)].sort((a, b) => a - b)
	const parts = []
	for (let i = 0; i < list.length; ) {
		let j = i
		while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++
		parts.push(j - i >= 2 ? `${list[i]}-${list[j]}` : list.slice(i, j + 1).join(','))
		i = j + 1
	}
	return `HACG-SEL 1 ${source} ${seq} ${parts.length ? parts.join(',') : '-'}`
}

/** { port, bind } or { port: 0 } (off), from env, config and defaults. */
function listenConfig(ctx, env = process.env) {
	const raw = env.HIGHASCG_GMA3_SELECTION_PORT ?? ctx?.config?.lighting?.gma3SelectionPort
	const sandbox = /^(1|true|yes)$/i.test(String(env.HIGHASCG_SANDBOX || '')) || Boolean(env.NODE_TEST_CONTEXT) // a test never takes the live port
	let port = DEFAULT_PORT
	if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
		port = /^(off|false)$/i.test(String(raw).trim()) ? 0 : Number(raw)
	} else if (sandbox) {
		port = 0
	}
	if (!Number.isInteger(port) || port < 0 || port > 65535) port = 0
	const bind = String(env.HIGHASCG_GMA3_SELECTION_BIND || ctx?.config?.lighting?.gma3SelectionBind || '0.0.0.0')
	return { port, bind }
}

class Gma3SelectionListener {
	/** @param {{ service: { set: Function }, log?: Function, now?: () => number }} deps */
	constructor({ service, log, now } = {}) {
		this.service = service
		this.log = typeof log === 'function' ? log : () => {}
		this.now = typeof now === 'function' ? now : () => Date.now()
		this.sock = null
		this.port = null
		this.last = new Map() // sender address → last seq
		this.packets = 0
		this.rejected = 0
		this.stale = 0
		this.lastFrom = ''
		this.lastAt = 0
		this.error = ''
	}

	/** Bind; resolves to the bound port, or 0 when it is off / could not bind (the reason is in status().error). */
	start({ port, bind = '0.0.0.0' } = {}) {
		this.stop()
		if (!port) return Promise.resolve(0)
		return new Promise((resolve) => {
			const s = dgram.createSocket({ type: 'udp4', reuseAddr: false })
			s.on('error', (e) => {
				this.error = e.message
				this.log('warn', `[console-selection] grandMA3 listener ${bind}:${port}: ${e.message}`)
				if (this.sock === s) this.sock = null
				try {
					s.close()
				} catch (_) {
					/* not open */
				}
				resolve(0)
			})
			s.on('message', (msg, rinfo) => this.feed(msg, rinfo))
			s.bind(port, bind, () => {
				this.sock = s
				this.port = s.address().port
				this.error = ''
				this.log('info', `[console-selection] grandMA3 selection plugin: UDP ${bind}:${this.port}`)
				resolve(this.port)
			})
		})
	}

	feed(msg, rinfo) {
		const p = parsePacket(msg)
		const from = rinfo?.address || ''
		if (!p) {
			this.rejected++
			return false
		}
		const prev = this.last.get(from)
		if (prev !== undefined && p.seq <= prev && prev - p.seq < 1000) {
			this.stale++
			return false
		}
		this.last.set(from, p.seq)
		this.packets++
		this.lastFrom = from
		this.lastAt = this.now()
		this.service.set({ source: p.source, heads: p.heads })
		return true
	}

	status(now = this.now()) {
		return { listening: !!this.sock, port: this.sock ? this.port : null, packets: this.packets, rejected: this.rejected,
			stale: this.stale, last_from: this.lastFrom, age_ms: this.lastAt ? now - this.lastAt : null, error: this.error }
	}

	stop() {
		try {
			this.sock?.close()
		} catch (_) {
			/* already closed */
		}
		this.sock = null
		this.port = null
	}
}

module.exports = { Gma3SelectionListener, parsePacket, parseHeads, encodePacket, listenConfig, DEFAULT_PORT }
