'use strict'

const { isSaneTimingValue } = require('./osc-state-timing')

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
 *
 * 2026-09-03: a newer 2.6-dev build stopped sending the single-float `.../fps` canary — fps now
 * rides as an INT pair on `.../file/streams/0/fps` (correct BE either way, since only floats are
 * mis-endian). With no `/fps` float left to vote on, auto-detect never latched and `file/time` /
 * `file/clip` (still `,ff` floats: elapsed, duration) stayed raw-LE garbage forever — live capture
 * confirmed BE decode gave e.g. -4.5e-11 while LE gave a smooth 41.70, 41.72, 41.74… against a
 * constant 60.0 duration matching the actual clip length. Added a second canary on those two
 * addresses' duration arg (second float) using the same sanity bounds `osc-state-timing.js`
 * already applies to elapsed/duration, so auto-detect latches from real playback traffic even when
 * the fps canary is gone.
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
 * @param {(durBE: number, durLE: number) => void} [onDurationCanary] - called with both decodes
 *   of the second (duration) float of a `.../file/time` or `.../file/clip` message
 */
function walkMessage(buf, off, end, swap, onFpsCanary, onDurationCanary) {
	const addrEnd = skipPaddedString(buf, off, end)
	if (addrEnd < 0) return
	if (buf[addrEnd] !== 0x2c /* ',' */) return
	const tagsEnd = skipPaddedString(buf, addrEnd, end)
	if (tagsEnd < 0) return
	let p = tagsEnd
	let firstFloatAt = -1
	let secondFloat4At = -1
	let floatCount = 0
	let tagCount = 0
	for (let t = addrEnd + 1; t < end && buf[t] !== 0; t++) {
		const tag = String.fromCharCode(buf[t])
		tagCount++
		if (tag === 'f' || tag === 'd') {
			const size = tag === 'f' ? 4 : 8
			if (p + size > end) return
			if (floatCount === 0) firstFloatAt = p
			else if (floatCount === 1 && size === 4) secondFloat4At = p
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
	// Canaries: decode a known-shape float both ways and let the caller vote on endianness. Only
	// meaningful pre-latch, when swap=false and the bytes are still in wire order — the address
	// string is only materialized here, on the pre-latch path, never in steady state.
	if (!swap && (onFpsCanary || onDurationCanary) && floatCount >= 1) {
		let z = off
		while (z < end && buf[z] !== 0) z++
		const address = Buffer.from(buf.buffer, buf.byteOffset + off, z - off).toString('ascii')
		// A lone-float fps message (address .../fps): a real fps is 1..1000, its byte-swap is
		// subnormal or astronomically large.
		if (onFpsCanary && floatCount === 1 && tagCount === 1 && firstFloatAt >= 0 && address.endsWith('/fps')) {
			const view = Buffer.from(buf.buffer, buf.byteOffset + firstFloatAt, 4)
			onFpsCanary(view.readFloatBE(0), view.readFloatLE(0))
		}
		// `.../file/time` / `.../file/clip` carry [elapsed, duration] as two floats — some builds
		// no longer send a `/fps` canary at all (fps moved to an int-typed address), so this is the
		// only float traffic left to vote on. Duration is the more reliable of the two args (a
		// live/looping clip can legitimately have elapsed near 0, but a byte-swapped duration is
		// reliably insane by isSaneTimingValue's bounds).
		if (
			onDurationCanary &&
			secondFloat4At >= 0 &&
			(address.endsWith('/file/time') || address.endsWith('/file/clip'))
		) {
			const view = Buffer.from(buf.buffer, buf.byteOffset + secondFloat4At, 4)
			onDurationCanary(view.readFloatBE(0), view.readFloatLE(0))
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
 * @param {(durBE: number, durLE: number) => void} [onDurationCanary]
 */
function walkPacket(buf, off, end, swap, onFpsCanary, onDurationCanary) {
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
			walkPacket(buf, p, p + size, swap, onFpsCanary, onDurationCanary)
			p += size
		}
		return
	}
	walkMessage(buf, off, end, swap, onFpsCanary, onDurationCanary)
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

	/** @param {boolean} beSane @param {boolean} leSane @param {string} reason */
	function castVote(beSane, leSane, reason) {
		if (beSane === leSane) return // ambiguous — no vote
		if (leSane) {
			beVotes = 0
			if (++leVotes >= MODE_LATCH_VOTES) {
				latched = 'le'
				log?.('warn', `[OSC] float args are LITTLE-ENDIAN on the wire (non-spec binary) — byte-swapping all floats from here on (${reason})`)
			}
		} else {
			leVotes = 0
			if (++beVotes >= MODE_LATCH_VOTES) {
				latched = 'be'
				log?.('info', '[OSC] float byte order verified big-endian (spec-compliant)')
			}
		}
	}

	function onFpsCanary(fpsBE, fpsLE) {
		castVote(
			fpsBE >= FPS_SANE_MIN && fpsBE <= FPS_SANE_MAX,
			fpsLE >= FPS_SANE_MIN && fpsLE <= FPS_SANE_MAX,
			`canary fps LE=${fpsLE}`,
		)
	}

	// Fallback canary for builds that no longer send a `/fps` float (fps moved to an int-typed
	// address) — vote on the duration arg of `file/time` / `file/clip` instead.
	function onDurationCanary(durBE, durLE) {
		castVote(isSaneTimingValue(durBE), isSaneTimingValue(durLE), `canary file duration LE=${durLE}`)
	}

	return {
		normalize(data) {
			try {
				const voting = latched === null
				walkPacket(data, 0, data.length, latched === 'le', voting ? onFpsCanary : undefined, voting ? onDurationCanary : undefined)
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
