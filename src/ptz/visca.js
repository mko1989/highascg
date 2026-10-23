'use strict'

/**
 * WO-711 — VISCA encoders for PTZ camera follow. Pure: bytes in, bytes out, no sockets.
 *
 * Sources (the byte formats were checked against these, 23.10.26; no real camera was available):
 *  - PTZOptics VISCA API, "Movement" page https://docs.ptzoptics.com/dev/visca-api/movement
 *      AbsolutePosition `81 01 06 02 VV WW 0Y 0Y 0Y 0Y 0Z 0Z 0Z 0Z FF` (VV pan speed 01-18h, WW tilt speed 01-14h,
 *      YYYY pan, ZZZZ tilt, one nibble per byte), Home `81 01 06 04 FF`, worked example
 *      `81 01 06 02 05 05 01 02 03 04 00 00 05 06 FF`.
 *  - BirdDog X4 VISCA over IP page https://birddog.tv/x4-series-visca-over-ip-commands/ : Preset Recall
 *      `81 01 04 3F 02 qq FF`, Zoom Direct `81 01 04 47 0p 0q 0r 0s FF`, and the 8-byte VISCA-over-IP header
 *      (type 01 00 command / 01 10 inquiry / 01 11 reply, 2-byte big-endian payload length, 4-byte sequence number),
 *      default UDP port 52381.
 *  - Sony VISCA Command List (VISCA over IP chapter, e.g. BRC-H900 / ILME-FR7 lists): control message type 02 00,
 *      control reply 02 01, RESET = control payload `01` which sets the camera's expected sequence number back to 0
 *      (the sequence number carried in the RESET itself is ignored). The sequence number wraps to 0 at its limit.
 *  - Jon Skeet, "Variations in the VISCA protocol" https://codeblog.jonskeet.uk/2023/11/25/variations-in-the-visca-protocol/ :
 *      example `01-10-00-05-00-00-00-00-81-09-04-00-FF` (encapsulated) vs `81-09-04-00-ff` (raw, same payload).
 *  - visca-over-ip docs https://visca-over-ip.readthedocs.io/en/latest/camera.html : "52381 is the default for most cameras".
 *  - Raw VISCA in UDP, default 1259, is the PTZOptics / Lumens convention (PTZOptics camera manuals; not re-fetched).
 *
 * Positions are signed 16-bit two's complement, packed one nibble per byte (0x0990 -> 00 09 09 00; -1 -> 0F 0F 0F 0F).
 */

const PROTOCOLS = ['visca-udp', 'visca-ip']
const DEFAULT_PORTS = { 'visca-udp': 1259, 'visca-ip': 52381 }

const IP_COMMAND = 0x0100
const IP_CONTROL = 0x0200
const SEQ_MOD = 0x100000000

const clampInt = (v, lo, hi, d) => {
	const n = Math.round(Number(v))
	return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d
}

/** VISCA camera address 1-7 -> header byte 0x81-0x87 (controller 0 -> camera n). */
function addr(address = 1) {
	return 0x80 | clampInt(address, 1, 7, 1)
}

/** 16-bit value -> 4 bytes, one nibble each, most significant first. Negative values are two's complement. */
function nibbles16(v) {
	const u = clampInt(v, -32768, 65535, 0) & 0xffff
	return [(u >> 12) & 15, (u >> 8) & 15, (u >> 4) & 15, u & 15]
}

/** Pan-tiltDrive AbsolutePosition. Speeds 1-24 / 1-20; positions signed 16-bit camera units. */
function panTiltAbsolute(address, pan, tilt, panSpeed = 12, tiltSpeed = 10) {
	const vv = clampInt(panSpeed, 1, 24, 12)
	const ww = clampInt(tiltSpeed, 1, 20, 10)
	return Buffer.from([addr(address), 0x01, 0x06, 0x02, vv, ww, ...nibbles16(pan), ...nibbles16(tilt), 0xff])
}

/** Pan-tiltDrive Home. */
function home(address) {
	return Buffer.from([addr(address), 0x01, 0x06, 0x04, 0xff])
}

/** Memory (preset) recall, preset 0-127 (cameras differ; most take 0-15 or 0-63). */
function presetRecall(address, preset) {
	return Buffer.from([addr(address), 0x01, 0x04, 0x3f, 0x02, clampInt(preset, 0, 127, 0), 0xff])
}

/** CAM_Zoom direct, 0-65535 (lens specific; PTZOptics wide end 0, tele end 0x4000). */
function zoomDirect(address, zoom) {
	return Buffer.from([addr(address), 0x01, 0x04, 0x47, ...nibbles16(clampInt(zoom, 0, 65535, 0)), 0xff])
}

/** VISCA over IP framing: 2-byte type, 2-byte big-endian length, 4-byte big-endian sequence, then the payload. */
function ipFrame(type, payload, seq) {
	const head = Buffer.alloc(8)
	head.writeUInt16BE(type, 0)
	head.writeUInt16BE(payload.length, 2)
	head.writeUInt32BE(Math.floor(Number(seq) || 0) % SEQ_MOD, 4)
	return Buffer.concat([head, payload])
}

/** A VISCA command wrapped as a "visca-ip" datagram. */
function ipCommand(payload, seq) {
	return ipFrame(IP_COMMAND, payload, seq)
}

/** The Sony RESET control message (sequence number back to 0). Send it before the first command of a session. */
function ipReset() {
	return ipFrame(IP_CONTROL, Buffer.from([0x01]), 0)
}

/** Datagram bytes for a protocol: raw VISCA for 'visca-udp', header + payload for 'visca-ip'. */
function datagram(protocol, payload, seq) {
	return protocol === 'visca-ip' ? ipCommand(payload, seq) : payload
}

module.exports = {
	PROTOCOLS,
	DEFAULT_PORTS,
	SEQ_MOD,
	addr,
	nibbles16,
	panTiltAbsolute,
	home,
	presetRecall,
	zoomDirect,
	ipFrame,
	ipCommand,
	ipReset,
	datagram,
}
