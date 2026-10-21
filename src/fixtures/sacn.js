'use strict'

/**
 * WO-615 T4 — sACN (ANSI E1.31-2018) data packets, sent through the same ephemeral UDP socket as Art-Net
 * (artdmx.js ArtnetSender: plain datagrams, no bind on 5568). A universe goes to its multicast group
 * 239.255.<hi>.<lo>:5568 unless the patch names a unicast destination. Pure apart from os.hostname() for the CID.
 *
 *   root layer (preamble, "ASC-E1.17", vector 4, CID) → framing layer (vector 2, source name, priority, sequence,
 *   universe) → DMP layer (vector 2, 0xa1, start code 0, up to 512 slots)
 */

const crypto = require('crypto')
const net = require('net')
const os = require('os')

const SACN_PORT = 5568
const MAX_UNIVERSE = 63999
const ACN_ID = Buffer.from('ASC-E1.17\0\0\0', 'ascii')

/** A stable 16-byte CID for this box (same across restarts, so receivers keep one source). */
function boxCid(seed = os.hostname()) {
	return crypto.createHash('md5').update(`highascg-sacn:${seed}`).digest()
}

const multicastOf = (universe) => `239.255.${(universe >> 8) & 255}.${universe & 255}`

/** "" → the universe's multicast group; "a.b.c.d[:port]" → unicast (port 5568 unless given). */
function sacnDest(dest, universe) {
	const s = String(dest ?? '').trim()
	if (!s) return { host: multicastOf(universe), port: SACN_PORT }
	const m = /^([0-9.]+)(?::(\d{1,5}))?$/.exec(s)
	if (!m || !net.isIPv4(m[1])) return null
	const port = m[2] ? Number(m[2]) : SACN_PORT
	return port >= 1 && port <= 65535 ? { host: m[1], port } : null
}

/** @param {{ universe: number, sequence?: number, priority?: number, cid?: Buffer, sourceName?: string, data: Uint8Array }} p */
function encodeE131({ universe, sequence = 0, priority = 100, cid = boxCid(), sourceName = 'HighAsCG', data }) {
	const slots = Math.max(1, Math.min(512, data.length))
	const buf = Buffer.alloc(126 + slots)
	buf.writeUInt16BE(0x0010, 0)
	ACN_ID.copy(buf, 4)
	buf.writeUInt16BE(0x7000 | (110 + slots), 16)
	buf.writeUInt32BE(0x00000004, 18)
	cid.copy(buf, 22, 0, 16)
	buf.writeUInt16BE(0x7000 | (88 + slots), 38)
	buf.writeUInt32BE(0x00000002, 40)
	buf.write(String(sourceName).slice(0, 63), 44, 'utf8')
	buf[108] = Math.max(0, Math.min(200, Math.round(Number(priority) || 0)))
	buf[111] = sequence & 0xff
	buf.writeUInt16BE(Math.max(1, Math.min(MAX_UNIVERSE, Math.trunc(universe))), 113)
	buf.writeUInt16BE(0x7000 | (11 + slots), 115)
	buf[117] = 0x02
	buf[118] = 0xa1
	buf.writeUInt16BE(0x0001, 121)
	buf.writeUInt16BE(1 + slots, 123)
	Buffer.from(data.buffer, data.byteOffset, slots).copy(buf, 126)
	return buf
}

/** E1.31 data packet → { universe, sequence, priority, sourceName, cid, data } or null. */
function decodeE131(buf) {
	if (!Buffer.isBuffer(buf) || buf.length < 126 || !buf.subarray(4, 16).equals(ACN_ID)) return null
	if (buf.readUInt32BE(18) !== 4 || buf.readUInt32BE(40) !== 2 || buf[117] !== 2 || buf[125] !== 0) return null
	const count = buf.readUInt16BE(123) - 1
	return {
		universe: buf.readUInt16BE(113),
		sequence: buf[111],
		priority: buf[108],
		sourceName: buf.subarray(44, 108).toString('utf8').replace(/\0.*$/s, ''),
		cid: buf.subarray(22, 38),
		data: new Uint8Array(buf.subarray(126, 126 + Math.max(0, Math.min(512, count)))),
	}
}

module.exports = { SACN_PORT, MAX_UNIVERSE, boxCid, multicastOf, sacnDest, encodeE131, decodeE131 }
