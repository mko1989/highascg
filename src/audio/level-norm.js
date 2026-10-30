'use strict'

/**
 * WO-872 step 5 — level ranging and the silence gate for the audio-parts level buses (bass / mid / high / tonal),
 * after fosfora (crates/fosfora-app/src/audio/normalizer.rs:9-22, ranging.rs, loudness.rs:45-54).
 *
 *  - Percentile AGC: a band's dB level against its own P5..P95 over the last 4 s, soft knee above 0.85. One loud hit
 *    is under 5 % of the window, so it no longer sets the top of the range: the WO-861 decaying peak (36 dB range,
 *    1.5 dB/s) dropped every level after a hit and took 8 s+ to climb back (pumping). A quiet passage re-ranges in 4 s.
 *    Levels under −80 dB per-bin RMS read 0 (fosfora's floor, analyzer.rs:143-151): window leakage of a loud tone in
 *    the other bands sits at −87 dB and lower, while quiet classical music bottoms out at about −78 dB.
 *    Not in fosfora: a 6 dB minimum span reaching down from P95, so a steady tone or pad stays lit (~0.95, as the
 *    peak AGC read it) instead of its ±1 dB jitter being stretched over 0..1.
 *  - Silence gate: ITU-R BS.1770 K-weighted momentary loudness (400 ms). Opens at −55 LUFS, closes only after 0.25 s
 *    under −60 LUFS. A quiet room's noise floor (−57 LUFS) no longer opens it and gets stretched to full scale, and
 *    music hovering near the threshold does not flip it every few hops. While closed the levels read 0 and their
 *    windows are frozen.
 */

const WINDOW_S = 4
const P_LO = 0.05
const P_HI = 0.95
const KNEE = 0.85
const MIN_SPAN_DB = 6
const FLOOR_DB = -80
const OPEN_LUFS = -55
const CLOSE_LUFS = -60
const HOLD_S = 0.25

const softClip01 = (x) => (x <= 0 ? 0 : x <= KNEE ? x : KNEE + (1 - KNEE) * (1 - Math.exp(-(x - KNEE) / (1 - KNEE))))

/** Linear-interpolated quantile of a sorted array. */
function quantile(s, q) {
	const x = q * (s.length - 1)
	const i = Math.floor(x)
	return i + 1 < s.length ? s[i] + (s[i + 1] - s[i]) * (x - i) : s[i]
}

/**
 * Percentile-ranged level, instant attack, ~150 ms release (the WO-861 AGC's smoothing).
 * @param {number} fr steps per second
 * @param {number} bins the band's bin count (its power is a sum over them)
 */
function createPercentileAgc(fr, bins) {
	const cap = Math.round(WINDOW_S * fr)
	const ring = new Float64Array(cap)
	const sorted = new Float64Array(cap)
	let n = 0
	let i = 0
	let v = 0
	const rel = Math.exp(-1 / (0.15 * fr))
	return {
		/** @param {number} energy band power (linear) @param {boolean} silent the gate is closed */
		step(energy, silent) {
			let target = 0
			if (!silent) {
				const db = Math.max(FLOOR_DB, 10 * Math.log10(energy / bins + 1e-20))
				ring[i] = db
				i = (i + 1) % cap
				if (n < cap) n++
				const s = sorted.subarray(0, n)
				s.set(ring.subarray(0, n))
				s.sort()
				let lo = quantile(s, P_LO)
				const hi = quantile(s, P_HI)
				lo = Math.min(lo, hi - MIN_SPAN_DB)
				target = db > FLOOR_DB ? softClip01((db - lo) / (hi - lo)) : 0
			}
			v = target > v ? target : target + (v - target) * rel
			return v
		},
		get value() {
			return v
		},
		reset() {
			n = i = 0
			v = 0
		},
	}
}

/** RBJ biquad coefficients of the two BS.1770 K-weighting stages at any rate (libebur128's derivation). */
function kWeighting(sr) {
	const shelf = (() => {
		const K = Math.tan((Math.PI * 1681.974450955533) / sr)
		const Q = 0.7071752369554196
		const Vh = 10 ** (3.999843853973347 / 20)
		const Vb = Vh ** 0.4996667741545416
		const a0 = 1 + K / Q + K * K
		return {
			b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
			a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
		}
	})()
	const hp = (() => {
		const K = Math.tan((Math.PI * 38.13547087602444) / sr)
		const Q = 0.5003270373238773
		const a0 = 1 + K / Q + K * K
		return { b: [1, -2, 1], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] }
	})()
	return [shelf, hp]
}

/**
 * Momentary loudness (mono, K-weighted, 400 ms) with the hysteresis gate.
 * @param {number} sr sample rate
 */
function createSilenceGate(sr) {
	const stages = kWeighting(sr).map((c) => ({ ...c, x1: 0, x2: 0, y1: 0, y2: 0 }))
	const block = Math.round(sr / 100) // 10 ms blocks, 40 of them make the 400 ms window
	const blocks = new Float64Array(40)
	let bi = 0
	let bn = 0
	let acc = 0
	let accN = 0
	let lufs = -70
	let silent = true
	let under = 0
	const holdBlocks = Math.round(HOLD_S * 100)
	return {
		/** @param {number} x one mono sample */
		push(x) {
			let y = x
			for (const s of stages) {
				const o = s.b[0] * y + s.b[1] * s.x1 + s.b[2] * s.x2 - s.a[0] * s.y1 - s.a[1] * s.y2
				s.x2 = s.x1
				s.x1 = y
				s.y2 = s.y1
				s.y1 = o
				y = o
			}
			acc += y * y
			if (++accN < block) return
			blocks[bi] = acc / accN
			bi = (bi + 1) % blocks.length
			if (bn < blocks.length) bn++
			acc = accN = 0
			let ms = 0
			for (let j = 0; j < bn; j++) ms += blocks[j]
			lufs = Math.max(-70, -0.691 + 10 * Math.log10(ms / bn + 1e-20))
			if (lufs >= OPEN_LUFS) {
				silent = false
				under = 0
			} else if (lufs < CLOSE_LUFS && !silent && ++under >= holdBlocks) silent = true
			else if (lufs >= CLOSE_LUFS) under = 0
		},
		get silent() {
			return silent
		},
		get lufs() {
			return lufs
		},
		reset() {
			for (const s of stages) s.x1 = s.x2 = s.y1 = s.y2 = 0
			bi = bn = acc = accN = under = 0
			lufs = -70
			silent = true
		},
	}
}

module.exports = { createPercentileAgc, createSilenceGate }
