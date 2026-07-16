'use strict'

/**
 * osc-float-endian.js — normalize float byte order in raw CasparCG OSC datagrams.
 *
 * The 2.6-dev binary writes OSC float32 payloads in LITTLE-ENDIAN byte order (OSC 1.0 mandates
 * big-endian). Live capture 2026-07-16 on this box (predefined client tee, port 6250):
 *   /channel/1/stage/layer/10/foreground/file/time  ,ff  bytes 52b87e40 ae47a140
 *     BE decode: 3.95e11, -4.5e-11 (the "garbage floats" WO-235 sanity-filtered for months)
 *     LE decode: 3.98, 5.04       (real elapsed/duration, advancing exactly one frame per tick)
 * INTEGER args (i/h) on the same stream are correct big-endian (framerate 50/1, sample-rate
 * 48000, width 1920 all decode sane as BE) — ONLY floats are byte-swapped. That asymmetry is
 * also why audio meters kept working (mixer/audio/volume arrives as ints) while every
 * float-sourced value (file/time, file/fps, profiler) was frozen or jumping: the whole "jumpy
 * timers" family of symptoms.
 *
 * This module rewrites the raw datagram IN PLACE before osc.js parses it (hooked from
 * osc-listener.js via the port's "raw" event, which fires synchronously before readPacket on the
 * same byte array). Only 'f' (4-byte) and 'd' (8-byte) args are reversed; everything else is
 * left untouched.
 *
 * Byte order is AUTO-DETECTED by default so both lineages keep working with no config switch
 * (the house rule — see the loop/producer dual-lineage handling in osc-state.js): a
 * `.../file/fps` float is an unambiguous canary (a real fps is 1..1000; its byte-swap is a
 * subnormal ~e-41 or similarly insane), and after MODE_LATCH_VOTES consistent votes the mode
 * latches for the process lifetime. Until latched, packets pass through unmodified (= BE
 * behavior, correct for a spec-compliant binary). Override with config `osc.floatByteOrder`
 * ('be' | 'le') or env OSC_FLOAT_BYTE_ORDER when a stream has no fps traffic to vote on.
 */

const MODE_LATCH_VOTES = 3
const FPS_SANE_MIN = 1
const FPS_SANE_MAX = 1000

/** Arg byte sizes for fixed-width OSC type tags; tags absent here are variable/zero-width. */
const FIXED_SIZES = { i: 4, f: 4, c: 4, r: 4, m: 4, h: 8, t: 8, d: 8 }
const ZERO_SIZES = new Set(['T', 'F', 'N', 'I', '[', ']'])

/** Read a null-terminated, 4-padded OSC string; returns end offset (after padding) or -1. */
function skipPaddedString(buf, off, end) {
	let z = off
	while (z < end && buf[z] !== 0) z++
	if (z >= end) return -1
	return (z + 4) & ~3
}

/**
 * Walk one OSC message (not bundle) and byte-swap float args in place.
 * @param {Buffer|Uint8Array} buf
 * @param {number} off - message start
 * @param {number} end - message end (exclusive)
 * @param {boolean} swap - reverse 'f'/'d' payload bytes
 * @param {(fpsBE: number, fpsLE: number) => void} [onFpsCanary] - called with both decodes of a
 *   single-float `.../file/fps` message so the caller can vote on endianness
 */
function walkMessage(buf, off, end, swap, onFpsCanary) {
	const addrEnd = skipPaddedString(buf, off, end)
	if (addrEnd < 0) return
	if (buf[addrEnd] !== 0x2c /* ',' */) return
	const tagsEnd = skipPaddedString(buf, addrEnd, end)
	if (tagsEnd < 0) return
	let p = tagsEnd
	let firstFloatAt = -1
	let floatCount = 0
	let tagCount = 0
	for (let t = addrEnd + 1; t < end && buf[t] !== 0; t++) {
		const tag = String.fromCharCode(buf[t])
		tagCount++
		if (tag === 'f' || tag === 'd') {
			const size = tag === 'f' ? 4 : 8
			if (p + size > end) return
			if (floatCount === 0) firstFloatAt = p
			floatCount++
			if (swap) {
				for (let a = p, b = p + size - 1; a < b; a++, b--) {
					const tmp = buf[a]
					buf[a] = buf[b]
					buf[b] = tmp
				}
			}
			p += size
		} else if (FIXED_SIZES[tag]) {
			p += FIXED_SIZES[tag]
		} else if (tag === 's' || tag === 'S') {
			p = skipPaddedString(buf, p, end)
			if (p < 0) return
		} else if (tag === 'b') {
			if (p + 4 > end) return
			const blen = (buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3]
			if (blen < 0) return
			p += 4 + ((blen + 3) & ~3)
		} else if (ZERO_SIZES.has(tag)) {
			// no payload
		} else {
			return // unknown tag — stop touching this message
		}
		if (p > end) return
	}
	// Canary: a lone-float fps message (address .../fps) — decode both ways for the voter.
	// Only meaningful pre-latch, when swap=false and the bytes are still in wire order. The
	// address string is only materialized here, on the pre-latch path, never in steady state.
	if (!swap && onFpsCanary && floatCount === 1 && tagCount === 1 && firstFloatAt >= 0) {
		let z = off
		while (z < end && buf[z] !== 0) z++
		const address = Buffer.from(buf.buffer, buf.byteOffset + off, z - off).toString('ascii')
		if (address.endsWith('/fps')) {
			const view = Buffer.from(buf.buffer, buf.byteOffset + firstFloatAt, 4)
			onFpsCanary(view.readFloatBE(0), view.readFloatLE(0))
		}
	}
}

/**
 * Walk a full OSC packet (message or nested bundle) in place.
 * @param {Buffer|Uint8Array} buf
 * @param {number} off
 * @param {number} end
 * @param {boolean} swap
 * @param {(fpsBE: number, fpsLE: number) => void} [onFpsCanary]
 */
function walkPacket(buf, off, end, swap, onFpsCanary) {
	if (end - off < 4) return
	// '#bundle\0'
	if (
		end - off >= 16 &&
		buf[off] === 0x23 &&
		buf[off + 1] === 0x62 &&
		buf[off + 2] === 0x75 &&
		buf[off + 3] === 0x6e &&
		buf[off + 4] === 0x64 &&
		buf[off + 5] === 0x6c &&
		buf[off + 6] === 0x65 &&
		buf[off + 7] === 0
	) {
		let p = off + 16 // marker + 8-byte timetag
		while (p + 4 <= end) {
			const size = (buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3]
			p += 4
			if (size <= 0 || p + size > end) return
			walkPacket(buf, p, p + size, swap, onFpsCanary)
			p += size
		}
		return
	}
	walkMessage(buf, off, end, swap, onFpsCanary)
}

/**
 * @param {'auto' | 'be' | 'le'} mode - configured float byte order ('auto' votes on fps canaries)
 * @param {(level: string, msg: string) => void} [log]
 * @returns {{ normalize: (data: Buffer|Uint8Array) => void, getMode: () => string }}
 *   `normalize` mutates the datagram in place (call before parsing); `getMode` reports
 *   'be' | 'le' | 'auto' (auto = still undecided).
 */
function createFloatEndianNormalizer(mode, log) {
	let latched = mode === 'be' || mode === 'le' ? mode : null
	let leVotes = 0
	let beVotes = 0

	function onFpsCanary(fpsBE, fpsLE) {
		const beSane = fpsBE >= FPS_SANE_MIN && fpsBE <= FPS_SANE_MAX
		const leSane = fpsLE >= FPS_SANE_MIN && fpsLE <= FPS_SANE_MAX
		if (beSane === leSane) return // ambiguous — no vote
		if (leSane) {
			beVotes = 0
			if (++leVotes >= MODE_LATCH_VOTES) {
				latched = 'le'
				log?.('warn', `[OSC] float args are LITTLE-ENDIAN on the wire (non-spec binary) — byte-swapping all floats from here on (canary fps LE=${fpsLE})`)
			}
		} else {
			leVotes = 0
			if (++beVotes >= MODE_LATCH_VOTES) {
				latched = 'be'
				log?.('info', '[OSC] float byte order verified big-endian (spec-compliant)')
			}
		}
	}

	return {
		normalize(data) {
			try {
				walkPacket(data, 0, data.length, latched === 'le', latched === null ? onFpsCanary : undefined)
			} catch (_) {
				/* malformed packet — leave it for the parser's own error path */
			}
		},
		getMode() {
			return latched || 'auto'
		},
	}
}

module.exports = { createFloatEndianNormalizer }
