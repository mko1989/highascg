'use strict'

/**
 * WO-999 — FragCoord's two spectrum rows (its `u_audio` spectrogram, R = weighted FFT, B = raw FFT), computed on the box
 * from the same sample ring as the Shadertoy frame (fft.js). FragCoord's player reads a Web Audio AnalyserNode
 * (fftSize 1024, smoothingTimeConstant 0.8, minDecibels −90, maxDecibels −10) and, for R, adds an A-weighting curve to
 * the float dB before the byte mapping. Doing that here — before any rounding — keeps the loud end that the Shadertoy
 * bytes (−100..−30 dB) clip, and the Web Audio scale: |X|/N (the spec), where fft.js uses 2|X|/N (+6 dB).
 */

const { fftRadix2 } = require('./fft')

const MIN_DB = -90
const MAX_DB = -10
const SMOOTHING = 0.8

/** Web Audio's Blackman window (alpha 0.16) — the same coefficients as fft.js. */
function blackman(n) {
	const w = new Float64Array(n)
	for (let i = 0; i < n; i++) {
		const t = (2 * Math.PI * i) / n
		w[i] = 0.42 - 0.5 * Math.cos(t) + 0.08 * Math.cos(2 * t)
	}
	return w
}

/** IEC 61672 A-weighting in dB at `f` Hz (+2 dB offset, as FragCoord's player has it). −Infinity at 0 Hz. */
function aWeightDb(f) {
	if (f <= 0) return -Infinity
	const f2 = f * f
	const num = 12194 ** 2 * f2 * f2
	const den = (f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2)
	return 20 * Math.log10(num / den) + 2
}

/**
 * The per-bin weights FragCoord adds: the A curve from bin 0 up, never falling (a running max from −80 dB), capped at 0.
 * So the lows are cut, and everything above the curve's peak (~2.5 kHz) passes at 0 dB.
 * @returns {Float32Array}
 */
function weightTable(sampleRate, fftSize) {
	const bins = fftSize >> 1
	const out = new Float32Array(bins)
	let run = -80
	for (let k = 0; k < bins; k++) {
		const a = aWeightDb((k * sampleRate) / fftSize)
		run = Math.max(run, Number.isFinite(a) ? a : -80)
		out[k] = Math.min(run, 0)
	}
	return out
}

function toByte(db) {
	const v = Number.isFinite(db) ? (db - MIN_DB) / (MAX_DB - MIN_DB) : 0
	const b = Math.round(v * 255)
	return b <= 0 ? 0 : b >= 255 ? 255 : b
}

/**
 * @param {{ sampleRate?: number, fftSize?: number }} [opts]
 * @returns {{ rows: (samples: Float32Array) => { weighted: Uint8Array, raw: Uint8Array }, reset: () => void }}
 */
function createFragcoordAnalyser(opts = {}) {
	const sampleRate = opts.sampleRate || 48000
	const n = opts.fftSize || 1024
	const bins = n >> 1
	const win = blackman(n)
	const weights = weightTable(sampleRate, n)
	const smooth = new Float64Array(bins)
	const re = new Float64Array(n)
	const im = new Float64Array(n)
	return {
		rows(samples) {
			if (samples.length !== n) throw new Error(`fragcoord rows need ${n} samples, got ${samples.length}`)
			for (let i = 0; i < n; i++) {
				re[i] = samples[i] * win[i]
				im[i] = 0
			}
			fftRadix2(re, im)
			const weighted = new Uint8Array(bins)
			const raw = new Uint8Array(bins)
			for (let k = 0; k < bins; k++) {
				const s = SMOOTHING * smooth[k] + (1 - SMOOTHING) * (Math.hypot(re[k], im[k]) / n)
				smooth[k] = s
				const db = s > 0 ? 20 * Math.log10(s) : -Infinity
				raw[k] = toByte(db)
				weighted[k] = toByte(db + weights[k])
			}
			return { weighted, raw }
		},
		reset() {
			smooth.fill(0)
		},
	}
}

module.exports = { createFragcoordAnalyser, weightTable, aWeightDb, MIN_DB, MAX_DB, SMOOTHING }
