'use strict'

/**
 * WO-616 T11 / WO-615 T4 — Art-Net ArtDmx (OpCode 0x5000, Art-Net 4 protocol 14) encoder and a send-only UDP
 * sender. Not dmxnet: its constructor binds a listener on :6454 (the box's lighting input owns that port) and
 * `setChannel` sends one packet per channel; the follow engine wants one full-universe packet per frame.
 *
 * Packet: "Art-Net\0" · OpCode 0x5000 LE · ProtVer 14 BE · Sequence · Physical · SubUni (port-address low byte)
 *         · Net (port-address bits 8–14) · Length BE (even, 2–512) · data.
 */

const dgram = require('dgram')
const net = require('net')

const ARTNET_PORT = 6454
const OP_DMX = 0x5000
const HEADER = Buffer.from('Art-Net\0', 'ascii')
const MAX_PORT_ADDRESS = 32767

/** @param {{ portAddress: number, sequence?: number, physical?: number, data: Uint8Array | number[] }} p */
function encodeArtDmx({ portAddress, sequence = 0, physical = 0, data }) {
	const pa = Math.max(0, Math.min(MAX_PORT_ADDRESS, Math.trunc(Number(portAddress) || 0)))
	let len = Math.max(2, Math.min(512, data.length))
	if (len % 2) len++
	const buf = Buffer.alloc(18 + len)
	HEADER.copy(buf, 0)
	buf.writeUInt16LE(OP_DMX, 8)
	buf.writeUInt16BE(14, 10)
	buf[12] = sequence & 0xff
	buf[13] = physical & 0xff
	buf[14] = pa & 0xff
	buf[15] = (pa >> 8) & 0x7f
	buf.writeUInt16BE(len, 16)
	for (let i = 0; i < Math.min(len, data.length); i++) buf[18 + i] = data[i] & 0xff
	return buf
}

/** → { portAddress, sequence, physical, data: Buffer } or null (not an ArtDmx packet). */
function decodeArtDmx(buf) {
	if (!Buffer.isBuffer(buf) || buf.length < 20 || !buf.subarray(0, 8).equals(HEADER)) return null
	if (buf.readUInt16LE(8) !== OP_DMX) return null
	const len = buf.readUInt16BE(16)
	return { portAddress: buf[14] | ((buf[15] & 0x7f) << 8), sequence: buf[12], physical: buf[13],
		data: buf.subarray(18, 18 + len) }
}

/** "a.b.c.d" | "a.b.c.d:port" → { host, port } or null. */
function parseDest(dest) {
	const m = /^\s*([0-9.]+)(?::(\d{1,5}))?\s*$/.exec(String(dest ?? ''))
	if (!m || !net.isIPv4(m[1])) return null
	const port = m[2] ? Number(m[2]) : ARTNET_PORT
	return port >= 1 && port <= 65535 ? { host: m[1], port } : null
}

/**
 * One ephemeral, broadcast-enabled UDP socket; never binds :6454. WO-698: `setInterface(ip)` binds it to one of this
 * box's IPv4 addresses — the kernel then sends 255.255.255.255 and sACN multicast out of THAT NIC instead of the
 * default route's (eno1 here, while the lighting network is eno2 2.0.0.0/8). '' = OS default.
 */
class ArtnetSender {
	constructor({ log } = {}) {
		this._log = typeof log === 'function' ? log : () => {}
		this._sock = null
		this._ready = null
		this.sent = 0
		this.errors = 0
		this.iface = ''
	}

	/** '' = the OS default route; else an IPv4 of this box (a missing address falls back to the default, logged). */
	setInterface(ip) {
		const want = typeof ip === 'string' && net.isIPv4(ip.trim()) ? ip.trim() : ''
		if (want === this.iface) return
		this.iface = want
		this.close()
	}

	_open() {
		if (this._ready) return this._ready
		this._sock = dgram.createSocket({ type: 'udp4' })
		this._sock.on('error', (e) => {
			this.errors++
			this._log('warn', '[follow] Art-Net socket: ' + (e?.message || e))
		})
		const sock = this._sock
		const iface = this.iface
		this._ready = new Promise((resolve) => {
			const fail = (e) => {
				// the chosen address is not on this box (NIC unplugged, another box's project): send via the default
				this._log('warn', `[follow] DMX output interface ${iface}: ${e?.message || e} — using the OS default route`)
				this._sock = null
				this._ready = null
				this.iface = ''
				try {
					sock.close()
				} catch (_) {}
				resolve(this._open())
			}
			if (iface) sock.once('error', fail)
			sock.bind({ port: 0, address: iface || undefined }, () => {
				sock.removeListener('error', fail)
				try {
					sock.setBroadcast(true)
					if (iface) sock.setMulticastInterface(iface)
				} catch (_) {
					/* unicast still works */
				}
				resolve()
			})
		})
		return this._ready
	}

	/** @param {{ host: string, port: number }} to */
	async send(to, packet) {
		await this._open()
		if (!this._sock) return
		this._sock.send(packet, to.port, to.host, (e) => {
			if (e) {
				this.errors++
				if (this.errors <= 5 || this.errors % 100 === 0) this._log('warn', `[follow] Art-Net send ${to.host}:${to.port}: ${e.message}`)
			} else this.sent++
		})
	}

	close() {
		try {
			this._sock?.close()
		} catch (_) {
			/* already closed */
		}
		this._sock = null
		this._ready = null
	}
}

module.exports = { ARTNET_PORT, MAX_PORT_ADDRESS, encodeArtDmx, decodeArtDmx, parseDest, ArtnetSender }
