'use strict'

/**
 * WO-1092 — an independent SMPTE 12M LTC bit-level toolkit, written from the standard (not from libltc), so the
 * generator (tools/ltc/ltc_helper.py → libltc) can be checked by something that does not share its code:
 *
 *   frameBits(tc, opts)       → the 80 bits of one LTC frame (bit 0 first on the wire), parity included
 *   decodeLtc(samples, opts)  → every frame found in mono s16 PCM: { start, bits, tc, df, userBits, parityOk }
 *
 * Frame layout (bit: field) — 0-3 frame units, 4-7 user 1, 8-9 frame tens, 10 drop-frame, 11 colour frame,
 * 12-15 user 2, 16-19 second units, 20-23 user 3, 24-26 second tens, 27 flag (parity at 24/30 fps), 28-31 user 4,
 * 32-35 minute units, 36-39 user 5, 40-42 minute tens, 43 flag, 44-47 user 6, 48-51 hour units, 52-55 user 7,
 * 56-57 hour tens, 58 flag, 59 flag (parity at 25 fps), 60-63 user 8, 64-79 sync word 0011 1111 1111 1101.
 * Parity ("bi-phase mark correction"): every frame holds an even number of zeros (with 80 bits: an even number of ones).
 * Bi-phase mark: every bit cell starts with a transition, a 1 has a second one in the middle of the cell.
 */

const SYNC = [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1]
const USER_AT = [4, 12, 20, 28, 36, 44, 52, 60] // first bit of user-bit groups 1…8 (LSB first)

function put(bits, at, width, value) {
	for (let i = 0; i < width; i++) bits[at + i] = (value >> i) & 1
}

function get(bits, at, width) {
	let v = 0
	for (let i = 0; i < width; i++) v |= (bits[at + i] & 1) << i
	return v
}

/** Bit that makes the frame's parity even: 59 at 25 fps (EBU), 27 at 24 / 30 fps (SMPTE). */
function parityBit(fps) {
	return Math.round(fps) === 25 ? 59 : 27
}

/**
 * @param {{ h: number, m: number, s: number, f: number }} tc
 * @param {{ fps?: number, df?: boolean, userBits?: string }} [opts] userBits: 8 hex digits, group 1 first ("00000000")
 * @returns {Uint8Array} 80 bits
 */
function frameBits(tc, opts = {}) {
	const bits = new Uint8Array(80)
	put(bits, 0, 4, tc.f % 10)
	put(bits, 8, 2, Math.floor(tc.f / 10))
	bits[10] = opts.df ? 1 : 0
	put(bits, 16, 4, tc.s % 10)
	put(bits, 24, 3, Math.floor(tc.s / 10))
	put(bits, 32, 4, tc.m % 10)
	put(bits, 40, 3, Math.floor(tc.m / 10))
	put(bits, 48, 4, tc.h % 10)
	put(bits, 56, 2, Math.floor(tc.h / 10))
	const ub = String(opts.userBits || '00000000').padStart(8, '0')
	USER_AT.forEach((at, i) => put(bits, at, 4, parseInt(ub[i], 16) || 0))
	SYNC.forEach((b, i) => (bits[64 + i] = b))
	const p = parityBit(opts.fps ?? 25)
	bits[p] = 0
	bits[p] = bits.reduce((n, b) => n + b, 0) % 2
	return bits
}

/** 80 bits → "user bits" as 8 hex digits, group 1 first. */
function userBitsOf(bits) {
	return USER_AT.map((at) => get(bits, at, 4).toString(16)).join('')
}

function fieldsOf(bits) {
	return {
		h: get(bits, 48, 4) + 10 * get(bits, 56, 2),
		m: get(bits, 32, 4) + 10 * get(bits, 40, 3),
		s: get(bits, 16, 4) + 10 * get(bits, 24, 3),
		f: get(bits, 0, 4) + 10 * get(bits, 8, 2),
	}
}

const p2 = (n) => String(n).padStart(2, '0')

/**
 * Decode LTC from mono 16-bit PCM.
 * @param {Int16Array|number[]} samples
 * @param {{ rate?: number, fps: number, offset?: number }} opts offset: sample index of samples[0] in the stream
 * @returns {Array<{ start: number, tc: string, h: number, m: number, s: number, f: number, df: boolean, userBits: string, parityOk: boolean, bits: Uint8Array, peak: number }>}
 */
function decodeLtc(samples, opts) {
	const rate = opts.rate || 48000
	const T = rate / (opts.fps * 80) // samples per bit cell
	const base = opts.offset || 0
	let peak = 0
	for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]))
	const thr = Math.max(64, peak * 0.2)
	const frames = []
	const bits = []
	const starts = []
	let level = 0 // -1 / +1 once the signal crossed a threshold
	let lastEdge = -1
	let pendingHalf = -1 // start of a cell whose first half was seen
	let framePeak = 0
	const reset = () => {
		bits.length = 0
		starts.length = 0
		pendingHalf = -1
	}
	const push = (bit, at) => {
		bits.push(bit)
		starts.push(at)
		if (bits.length > 80) {
			bits.shift()
			starts.shift()
		}
		if (bits.length < 80) return
		for (let k = 0; k < 16; k++) if (bits[64 + k] !== SYNC[k]) return
		const b = Uint8Array.from(bits)
		const t = fieldsOf(b)
		const df = b[10] === 1
		frames.push({ start: base + starts[0], ...t, tc: `${p2(t.h)}:${p2(t.m)}:${p2(t.s)}${df ? ';' : ':'}${p2(t.f)}`, df,
			userBits: userBitsOf(b), parityOk: b.reduce((n, x) => n + x, 0) % 2 === 0, bits: b, peak: framePeak })
		framePeak = 0
		reset()
	}
	for (let i = 0; i < samples.length; i++) {
		const v = samples[i]
		framePeak = Math.max(framePeak, Math.abs(v))
		const next = v > thr ? 1 : v < -thr ? -1 : level
		if (next === level) {
			if (lastEdge >= 0 && i - lastEdge > 2 * T) {
				reset() // silence: a gap longer than any cell
				lastEdge = -1
			}
			continue
		}
		const prevLevel = level
		level = next
		if (prevLevel === 0) {
			lastEdge = i
			continue
		}
		if (lastEdge < 0) {
			lastEdge = i
			continue
		}
		const d = i - lastEdge
		if (d < 0.25 * T || d > 1.6 * T) reset()
		else if (d < 0.75 * T) {
			if (pendingHalf >= 0) {
				push(1, pendingHalf)
				pendingHalf = -1
			} else pendingHalf = lastEdge
		} else {
			if (pendingHalf >= 0) pendingHalf = -1 // half-cell phase was wrong: re-align on this full cell
			push(0, lastEdge)
		}
		lastEdge = i
	}
	return frames
}

module.exports = { frameBits, decodeLtc, userBitsOf, parityBit, SYNC }
