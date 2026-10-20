'use strict'

/**
 * WO-631 — PosiStageNet v2 output (owner 20.10: "add PosiStageNet output then. with a raw artnet as backup choice"):
 * the marker hub's markers go out as PSN trackers (tracker id = marker id) so grandMA3 / MagicQ aim their own
 * fixtures from positions. Wire format per the PSN v2.03 description (VYV / MA Lighting) and psn-cpp
 * (github.com/vyv/psn-cpp, MIT, (C) 2014 VYV Corporation): little-endian; every chunk starts with a 32-bit header
 * (id 16 bits · data_len 15 bits · has_subchunks 1 bit); UDP multicast 236.10.10.10:56565; DATA at 60 Hz, INFO at
 * 1 Hz; a frame bigger than 1500 bytes is split over several packets that share frame_id / frame_packet_count.
 *
 *   DATA 0x6755 { header 0x0000 (uint64 µs since start · u8 2 · u8 0 · u8 frame_id · u8 packet count),
 *                 tracker list 0x0001 { <id> { pos 0x0000 f32×3 · speed 0x0001 f32×3 · status 0x0003 f32 ·
 *                                              timestamp 0x0006 u64 } } }
 *   INFO 0x6756 { header 0x0000 · system name 0x0001 · tracker list 0x0002 { <id> { name 0x0000 } } }
 *
 * Axes: `stage` sends the hub frame as is (X stage left, Y upstage, Z up — what OpenFollow sends); `y_up` is the
 * spec's text (x right, y up, z depth: x = X, y = Z, z = −Y). Status is the hub's validity, 0 while stale.
 */

const dgram = require('dgram')

const PSN_GROUP = '236.10.10.10'
const PSN_PORT = 56565
const MAX_PACKET = 1500
const DATA_HZ = 60
const INFO_MS = 1000
const VERSION = [2, 0]

function chunk(id, body, sub) {
	const h = Buffer.alloc(4)
	h.writeUInt32LE(((id & 0xffff) | ((body.length & 0x7fff) << 16) | (sub ? 0x80000000 : 0)) >>> 0, 0)
	return Buffer.concat([h, body])
}

function header(id, frameId, timestampUs) {
	const b = Buffer.alloc(12)
	b.writeBigUInt64LE(BigInt(Math.max(0, Math.floor(timestampUs))), 0)
	b[8] = VERSION[0]
	b[9] = VERSION[1]
	b[10] = frameId & 0xff
	b[11] = 1 // patched once the frame's packet count is known
	return chunk(id, b, false)
}

const f32x3 = (v) => {
	const b = Buffer.alloc(12)
	v.forEach((n, i) => b.writeFloatLE(Number(n) || 0, i * 4))
	return b
}

/** Hub marker → wire vectors for the chosen axes. */
function toWire(m, axes) {
	const p = [m.x, m.y, m.z], v = [m.vx || 0, m.vy || 0, m.vz || 0]
	if (axes !== 'y_up') return { pos: p, speed: v }
	return { pos: [p[0], p[2], -p[1]], speed: [v[0], v[2], -v[1]] }
}

/** Packs tracker chunks into as many root packets as needed (each ≤ MAX_PACKET). */
function pack(rootId, head, listId, items) {
	const base = 4 + head.reduce((a, b) => a + b.length, 0) + 4 // root header · header chunks · list header
	const bodies = []
	let group = []
	let size = base
	for (const it of items) {
		if (group.length && size + it.length > MAX_PACKET) {
			bodies.push(group)
			group = []
			size = base
		}
		group.push(it)
		size += it.length
	}
	if (group.length) bodies.push(group)
	const out = bodies.map((g) => chunk(rootId, Buffer.concat([...head, chunk(listId, Buffer.concat(g), true)]), true))
	for (const p of out) p[4 + 4 + 11] = out.length // root header · header chunk header · frame_packet_count
	return out
}

/** markers: hub.list() rows → DATA packets (none when there are no markers). */
function encodeData(markers, { frameId = 0, timestampUs = 0, axes = 'stage', nowUs = timestampUs } = {}) {
	const items = markers.map((m) => {
		const w = toWire(m, axes)
		const st = Buffer.alloc(4)
		st.writeFloatLE(m.stale ? 0 : Math.max(0, Math.min(1, Number(m.status ?? 1))), 0)
		const ts = Buffer.alloc(8)
		ts.writeBigUInt64LE(BigInt(Math.max(0, Math.floor(nowUs - (m.age_ms || 0) * 1000))), 0)
		return chunk(m.id, Buffer.concat([chunk(0x0000, f32x3(w.pos)), chunk(0x0001, f32x3(w.speed)),
			chunk(0x0003, st), chunk(0x0006, ts)]), true)
	})
	return pack(0x6755, [header(0x0000, frameId, timestampUs)], 0x0001, items)
}

/** markers → INFO packets (system name + each tracker's name). */
function encodeInfo(markers, { frameId = 0, timestampUs = 0, systemName = 'HighAsCG' } = {}) {
	const items = markers.map((m) => chunk(m.id, chunk(0x0000, Buffer.from(String(m.name || `Marker ${m.id}`).slice(0, 64), 'utf8')), true))
	const name = chunk(0x0001, Buffer.from(String(systemName).slice(0, 64), 'utf8'))
	return pack(0x6756, [header(0x0000, frameId, timestampUs), name], 0x0002, items)
}

/** Root chunk → { id, header: {timestampUs, version, frameId, packetCount}, trackers: {id → {…}} | names } (tests, sniffing). */
function decode(buf) {
	const read = (b, at) => {
		const v = b.readUInt32LE(at)
		return { id: v & 0xffff, len: (v >>> 16) & 0x7fff, sub: v >>> 31 === 1, body: b.subarray(at + 4, at + 4 + ((v >>> 16) & 0x7fff)) }
	}
	const kids = (b) => {
		const out = []
		for (let at = 0; at + 4 <= b.length; ) {
			const c = read(b, at)
			out.push(c)
			at += 4 + c.len
		}
		return out
	}
	const root = read(buf, 0)
	const res = { id: root.id, header: null, systemName: null, trackers: {} }
	for (const c of kids(root.body)) {
		if (c.id === 0x0000 && !c.sub) {
			res.header = { timestampUs: Number(c.body.readBigUInt64LE(0)), version: [c.body[8], c.body[9]],
				frameId: c.body[10], packetCount: c.body[11] }
		} else if (root.id === 0x6756 && c.id === 0x0001 && !c.sub) res.systemName = c.body.toString('utf8')
		else if (c.sub) {
			for (const t of kids(c.body)) {
				const o = {}
				for (const f of kids(t.body)) {
					if (root.id === 0x6756) o.name = f.body.toString('utf8')
					else if (f.id === 0x0000) o.pos = [0, 1, 2].map((i) => f.body.readFloatLE(i * 4))
					else if (f.id === 0x0001) o.speed = [0, 1, 2].map((i) => f.body.readFloatLE(i * 4))
					else if (f.id === 0x0003) o.status = f.body.readFloatLE(0)
					else if (f.id === 0x0006) o.timestampUs = Number(f.body.readBigUInt64LE(0))
				}
				res.trackers[t.id] = o
			}
		}
	}
	return res
}

/**
 * The PSN sender: DATA every 1/60 s and INFO every second while `configure({ enabled: true, … })`. One socket;
 * `iface` (an IPv4 address of this box) picks the multicast interface, TTL 1 keeps it on the show LAN.
 */
class PsnSender {
	constructor({ hub, log, socketFactory } = {}) {
		this.hub = hub
		this.log = typeof log === 'function' ? log : () => {}
		this._socketFactory = socketFactory || (() => dgram.createSocket({ type: 'udp4', reuseAddr: true }))
		this.cfg = { enabled: false, group: PSN_GROUP, port: PSN_PORT, iface: '', system_name: 'HighAsCG', axes: 'stage' }
		this.sent = 0
		this.errors = 0
		this.lastError = null
		this._t0 = process.hrtime.bigint()
		this._dataId = 0
		this._infoId = 0
		this._sock = null
		this._timers = []
	}

	_us() {
		return Number((process.hrtime.bigint() - this._t0) / 1000n)
	}

	configure(cfg) {
		const prev = JSON.stringify(this.cfg)
		this.cfg = { ...this.cfg, ...cfg }
		if (JSON.stringify(this.cfg) === prev) return
		this._stop()
		if (this.cfg.enabled) this._start()
	}

	_start() {
		const s = this._socketFactory()
		s.on('error', (e) => this._fail(e))
		s.bind(0, () => {
			try {
				s.setMulticastTTL(1)
				s.setMulticastLoopback(true)
				if (this.cfg.iface) s.setMulticastInterface(this.cfg.iface)
			} catch (e) {
				this._fail(e)
			}
		})
		this._sock = s
		this._timers.push(setInterval(() => this.tick('data'), Math.round(1000 / DATA_HZ)))
		this._timers.push(setInterval(() => this.tick('info'), INFO_MS))
		for (const t of this._timers) t.unref?.()
		this.log('info', `[psn] output ON → ${this.cfg.group}:${this.cfg.port}${this.cfg.iface ? ' via ' + this.cfg.iface : ''} (axes ${this.cfg.axes})`)
	}

	_stop() {
		for (const t of this._timers) clearInterval(t)
		this._timers = []
		if (this._sock) {
			try {
				this._sock.close()
			} catch (_) {}
			this.log('info', '[psn] output off')
		}
		this._sock = null
	}

	_fail(e) {
		this.errors++
		if (this.lastError !== e?.message) this.log('warn', '[psn] ' + (e?.message || e))
		this.lastError = e?.message || String(e)
	}

	/** One DATA or INFO frame now. → packets sent */
	tick(kind) {
		if (!this._sock) return 0
		const markers = this.hub?.list(this.hub.now()) || []
		const ts = this._us()
		const packets = kind === 'info'
			? encodeInfo(markers, { frameId: this._infoId++, timestampUs: ts, systemName: this.cfg.system_name })
			: encodeData(markers, { frameId: this._dataId++, timestampUs: ts, axes: this.cfg.axes })
		for (const p of packets) {
			this._sock.send(p, this.cfg.port, this.cfg.group, (e) => (e ? this._fail(e) : this.sent++))
		}
		return packets.length
	}

	status() {
		return { enabled: !!this._sock, group: this.cfg.group, port: this.cfg.port, iface: this.cfg.iface, axes: this.cfg.axes,
			system_name: this.cfg.system_name, packets_sent: this.sent, send_errors: this.errors, last_error: this.lastError }
	}

	close() {
		this._stop()
	}
}

module.exports = { PSN_GROUP, PSN_PORT, MAX_PACKET, encodeData, encodeInfo, decode, toWire, PsnSender }
