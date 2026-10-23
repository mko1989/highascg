'use strict'

/**
 * WO-693 — the packets the DMX viewer (dmx-monitor.js) reads besides ArtDmx / E1.31 data: ArtPoll (what it sends to
 * find nodes), ArtPollReply (what the nodes answer, Art-Net 4) and E1.31 universe discovery (the universes an sACN
 * source announces on 239.255.250.214, universe 64214). Pure.
 */

const HEADER = Buffer.from('Art-Net\0', 'ascii')
const OP_POLL = 0x2000
const OP_POLL_REPLY = 0x2100
const ACN_ID = Buffer.from('ASC-E1.17\0\0\0', 'ascii')
const SACN_DISCOVERY_UNIVERSE = 64214
const SACN_DISCOVERY_GROUP = '239.255.250.214'

/** ArtPoll, protocol 14; flags 0 (reply once, no diagnostics). */
function encodeArtPoll() {
	const buf = Buffer.alloc(14)
	HEADER.copy(buf, 0)
	buf.writeUInt16LE(OP_POLL, 8)
	buf.writeUInt16BE(14, 10)
	return buf
}

const cstr = (buf, from, len) => buf.subarray(from, from + len).toString('latin1').replace(/\0.*$/s, '').trim()

/**
 * ArtPollReply → { ip, shortName, longName, report, mac, bindIndex, outputs: [portAddress], inputs: [portAddress] }
 * or null. A port counts when its PortTypes bit says it can output (0x80) / input (0x40) DMX.
 */
function decodeArtPollReply(buf) {
	if (!Buffer.isBuffer(buf) || buf.length < 207 || !buf.subarray(0, 8).equals(HEADER)) return null
	if (buf.readUInt16LE(8) !== OP_POLL_REPLY) return null
	const net = buf[18] & 0x7f
	const sub = buf[19] & 0x0f
	const ports = Math.min(4, buf.readUInt16BE(172))
	const outputs = []
	const inputs = []
	for (let i = 0; i < ports; i++) {
		const type = buf[174 + i]
		if (type & 0x80) outputs.push((net << 8) | (sub << 4) | (buf[190 + i] & 0x0f))
		if (type & 0x40) inputs.push((net << 8) | (sub << 4) | (buf[186 + i] & 0x0f))
	}
	const mac = [...buf.subarray(201, 207)].map((b) => b.toString(16).padStart(2, '0')).join(':')
	return {
		ip: [...buf.subarray(10, 14)].join('.'),
		shortName: cstr(buf, 26, 18),
		longName: cstr(buf, 44, 64),
		report: cstr(buf, 108, 64),
		mac,
		bindIndex: buf.length > 211 ? buf[211] : 0,
		outputs,
		inputs,
	}
}

/** E1.31 universe discovery packet → { cid (hex), sourceName, page, last, universes } or null. */
function decodeSacnDiscovery(buf) {
	if (!Buffer.isBuffer(buf) || buf.length < 120 || !buf.subarray(4, 16).equals(ACN_ID)) return null
	if (buf.readUInt32BE(18) !== 8 || buf.readUInt32BE(40) !== 2 || buf.readUInt32BE(114) !== 1) return null
	const universes = []
	const end = Math.min(buf.length, 112 + (buf.readUInt16BE(112) & 0x0fff))
	for (let i = 120; i + 1 < end; i += 2) universes.push(buf.readUInt16BE(i))
	return {
		cid: buf.subarray(22, 38).toString('hex'),
		sourceName: buf.subarray(44, 108).toString('utf8').replace(/\0.*$/s, ''),
		page: buf[118],
		last: buf[119],
		universes,
	}
}

module.exports = {
	OP_POLL,
	OP_POLL_REPLY,
	SACN_DISCOVERY_UNIVERSE,
	SACN_DISCOVERY_GROUP,
	encodeArtPoll,
	decodeArtPollReply,
	decodeSacnDiscovery,
}
