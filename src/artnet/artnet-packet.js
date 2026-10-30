'use strict'

const { ARTNET_HEADER, OPCODE_ARTDMX, PATCH_CHANNEL_COUNT } = require('./artnet-constants')

function portKeyFromPacket(msg) {
	if (!msg || msg.length < 16) return null
	const subuni = msg.readUInt8(14)
	const net = msg.readUInt8(15)
	return (subuni << 8) | net
}

function parseArtDmx(msg) {
	if (!msg || msg.length < 18) return null
	if (msg.toString('ascii', 0, 8) !== ARTNET_HEADER) return null
	const opcode = msg.readUInt16LE(8)
	if (opcode !== OPCODE_ARTDMX) return null
	// WO-845: Art-Net ArtDmx Length is big-endian (LengthHi, Length) — src/fixtures/artdmx.js decodeArtDmx
	// already does this. Read little-endian, 24/100/18 channel universes decoded as huge lengths and
	// the loop read past the end of the packet (ERR_OUT_OF_RANGE on every packet). Trust the smaller of
	// the declared length and the bytes actually present.
	const lengthField = msg.readUInt16BE(16)
	const packetPayload = Math.max(0, msg.length - 18)
	const payloadLen = Math.min(512, lengthField, packetPayload)
	const data = []
	for (let i = 0; i < payloadLen; i++) {
		data.push(msg.readUInt8(18 + i))
	}
	return data
}

function readByte(data, idx, fallback = 0) {
	return idx >= 0 && idx < data.length ? data[idx] : fallback
}

function copyPatchWindow(data, start, channelCount = PATCH_CHANNEL_COUNT) {
	const out = new Array(channelCount)
	for (let off = 0; off < channelCount; off++) {
		const i = start + off
		out[off] = i >= 0 && i < data.length ? data[i] : 0
	}
	return out
}

module.exports = {
	portKeyFromPacket,
	parseArtDmx,
	readByte,
	copyPatchWindow,
}
