'use strict'

/**
 * WO-333 — minimal DSP for the audio-capture FFT feed (shader reactivity).
 *
 * Pure functions, no I/O: radix-2 FFT plus the AnalyserNode-shaped byte mapping the shader
 * runtime expects (template/shaders/player.js tier A uses getByteFrequencyData /
 * getByteTimeDomainData — row 0 FFT bytes, row 1 waveform bytes, 128-centered). Matching that
 * contract here means a shader authored against tier A behaves identically on the WS feed.
 */

/**
 * In-place iterative radix-2 complex FFT. `re`/`im` length must be a power of two.
 * @param {Float64Array} re
 * @param {Float64Array} im
 */
function fftRadix2(re, im) {
	const n = re.length
	if (n !== im.length || (n & (n - 1)) !== 0) {
		throw new Error(`fftRadix2 needs matching power-of-two arrays, got ${n}/${im.length}`)
	}
	// Bit-reversal permutation
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1
		for (; j & bit; bit >>= 1) j ^= bit
		j ^= bit
		if (i < j) {
			const tr = re[i]
			re[i] = re[j]
			re[j] = tr
			const ti = im[i]
			im[i] = im[j]
			im[j] = ti
		}
	}
	for (let len = 2; len <= n; len <<= 1) {
		const ang = (-2 * Math.PI) / len
		const wr = Math.cos(ang)
		const wi = Math.sin(ang)
		for (let i = 0; i < n; i += len) {
			let cwr = 1
			let cwi = 0
			for (let j = 0; j < len / 2; j++) {
				const ur = re[i + j]
				const ui = im[i + j]
				const vr = re[i + j + len / 2] * cwr - im[i + j + len / 2] * cwi
				const vi = re[i + j + len / 2] * cwi + im[i + j + len / 2] * cwr
				re[i + j] = ur + vr
				im[i + j] = ui + vi
				re[i + j + len / 2] = ur - vr
				im[i + j + len / 2] = ui - vi
				const nwr = cwr * wr - cwi * wi
				cwi = cwr * wi + cwi * wr
				cwr = nwr
			}
		}
	}
}

/** @type {Map<number, Float64Array>} */
const _windowCache = new Map()

/**
 * Blackman window (the window AnalyserNode applies before its FFT).
 * @param {number} n
 * @returns {Float64Array}
 */
function blackmanWindow(n) {
	let w = _windowCache.get(n)
	if (w) return w
	w = new Float64Array(n)
	for (let i = 0; i < n; i++) {
		const t = (2 * Math.PI * i) / n
		w[i] = 0.42 - 0.5 * Math.cos(t) + 0.08 * Math.cos(2 * t)
	}
	_windowCache.set(n, w)
	return w
}

/**
 * Interleaved S16_LE PCM → mono Float32 (−1..1), averaging channels, with linear pre-gain.
 * @param {Buffer} buf
 * @param {number} channels
 * @param {number} [gain]
 * @returns {Float32Array}
 */
function pcmS16leToMonoFloats(buf, channels, gain = 1) {
	const ch = Math.max(1, channels | 0)
	const frames = Math.floor(buf.length / (2 * ch))
	const out = new Float32Array(frames)
	for (let f = 0; f < frames; f++) {
		let sum = 0
		for (let c = 0; c < ch; c++) {
			sum += buf.readInt16LE((f * ch + c) * 2)
		}
		const v = (sum / ch / 32768) * gain
		out[f] = v > 1 ? 1 : v < -1 ? -1 : v
	}
	return out
}

/**
 * One AnalyserNode-equivalent frequency frame: Blackman window → FFT → 2|X|/N magnitude →
 * time smoothing (linear domain) → dB → byte range [minDb..maxDb] → 0..255.
 * `smoothState` (length fftSize/2) is mutated — pass the same array every frame.
 * @param {Float32Array} samples - most recent fftSize samples
 * @param {Float32Array} smoothState
 * @param {{ smoothing?: number, minDb?: number, maxDb?: number }} [opts]
 * @returns {Uint8Array} fftSize/2 frequency bytes
 */
function analyserFreqBytes(samples, smoothState, opts = {}) {
	const n = samples.length
	const bins = n >> 1
	if (smoothState.length !== bins) {
		throw new Error(`smoothState length ${smoothState.length} != bins ${bins}`)
	}
	const smoothing = opts.smoothing ?? 0.6
	const minDb = opts.minDb ?? -100
	const maxDb = opts.maxDb ?? -30
	const w = blackmanWindow(n)
	const re = new Float64Array(n)
	const im = new Float64Array(n)
	for (let i = 0; i < n; i++) re[i] = samples[i] * w[i]
	fftRadix2(re, im)
	const out = new Uint8Array(bins)
	const dbSpan = maxDb - minDb
	for (let k = 0; k < bins; k++) {
		const mag = (2 * Math.hypot(re[k], im[k])) / n
		const s = smoothing * smoothState[k] + (1 - smoothing) * mag
		smoothState[k] = s
		const db = s > 0 ? 20 * Math.log10(s) : -Infinity
		const byte = Math.round((255 * (db - minDb)) / dbSpan)
		out[k] = byte < 0 ? 0 : byte > 255 ? 255 : byte
	}
	return out
}

/**
 * getByteTimeDomainData-shaped waveform: `outLen` bytes, 128-centered, from the tail of `samples`.
 * @param {Float32Array} samples
 * @param {number} outLen
 * @returns {Uint8Array}
 */
function waveformBytes(samples, outLen) {
	const out = new Uint8Array(outLen)
	out.fill(128)
	const n = Math.min(outLen, samples.length)
	const off = samples.length - n
	for (let i = 0; i < n; i++) {
		const b = Math.round(128 + samples[off + i] * 127)
		out[i] = b < 0 ? 0 : b > 255 ? 255 : b
	}
	return out
}

/**
 * @param {Float32Array} samples
 * @returns {number} RMS 0..1
 */
function rmsOf(samples) {
	if (!samples.length) return 0
	let acc = 0
	for (let i = 0; i < samples.length; i++) acc += samples[i] * samples[i]
	return Math.sqrt(acc / samples.length)
}

module.exports = { fftRadix2, blackmanWindow, pcmS16leToMonoFloats, analyserFreqBytes, waveformBytes, rmsOf }
