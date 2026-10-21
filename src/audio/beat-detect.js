'use strict'

/**
 * WO-662 — beat detection for shader audio reactivity (owner 21.10: "Add beat detection and a way to weave it into
 * shaders audio reactivity").
 *
 * Runs on the raw mono samples the FFT engine already receives (src/audio/audio-capture-fft.js pushSamples), not on
 * the 30 Hz frames, so beats are timed to one hop (512 samples ≈ 10.7 ms at 48 kHz). Three stages, the textbook
 * pipeline — a low-band energy detector was tried first and failed on a real backing track (WO-662 Investigation):
 *  1. onsets: spectral flux (sum of positive log-magnitude rises, 1024-point FFT per hop, up to 10 kHz), picked
 *     where it rises above the last second's mean + k·std; one per rise (re-armed when it falls back);
 *  2. tempo: autocorrelation of the last 6 s of flux (plus half of the double lag, so the bar agrees), 70–180 BPM,
 *     a mild prior toward 120 against octave errors, parabolic peak for sub-hop precision; a new tempo must
 *     repeat before it replaces the current one;
 *  3. grid: once the tempo is confident, beats fire ON the grid (flywheel through a missing kick) and onsets near
 *     the grid pull its phase (early onset = the beat, late onset = half-way correction); off-grid onsets (hats,
 *     offbeats) are ignored. The flywheel stops 2 s after the last onset, so silence stops the beat.
 * Pure: time is the sample clock, so tests drive it with synthetic audio.
 */

const { fftRadix2, blackmanWindow } = require('./fft')

const MIN_BPM = 70
const MAX_BPM = 180
const CONF_LOCK = 0.12 // tempo confidence the grid needs before it outranks raw onsets
const RATIO = 1.5 // an onset's flux over the last second's mean, at least
const WINDOW = 0.2 // ± share of a period an onset may sit from the grid and still count as the beat

/**
 * @param {{ sampleRate?: number, hop?: number, k?: number, gateDb?: number, refractoryMs?: number }} [opts]
 */
function createBeatDetector(opts = {}) {
	const sr = opts.sampleRate || 48000
	const hop = opts.hop || 512
	const win = hop * 2
	const fr = sr / hop // flux frames per second
	const k = opts.k ?? 1.5
	const gateDb = opts.gateDb ?? -60
	const refractory = opts.refractoryMs ?? 100
	const bins = Math.min(win >> 1, Math.round(10000 / (sr / win)))
	const w = blackmanWindow(win)
	const re = new Float64Array(win)
	const im = new Float64Array(win)
	const prevLog = new Float64Array(bins)
	const input = new Float32Array(win)
	let inFill = 0
	let sinceHop = 0

	const envLen = Math.round(8 * fr)
	const env = new Float64Array(envLen)
	let envN = 0
	let envI = 0
	let hops = 0

	let armed = true
	let lastOnsetMs = -1e9
	let level = 0

	let bpm = 0
	let conf = 0
	let candidate = 0
	let candidateHits = 0
	let count = 0
	let lastBeatMs = -1
	let nextBeatMs = 0
	const lagMin = Math.floor((60 * fr) / MAX_BPM)
	const lagMax = Math.ceil((60 * fr) / MIN_BPM)

	const nowMs = () => (hops * hop * 1000) / sr
	const envAt = (back) => env[(envI - 1 - back + envLen * 2) % envLen] // back = 0 → newest

	function beat(t) {
		count++
		lastBeatMs = t
		nextBeatMs = bpm ? t + 60000 / bpm : t
	}

	/** A new tempo re-spaces the grid from the last beat (the old nextBeat belongs to the old period). */
	function switchTo(est) {
		bpm = est
		candidateHits = 0
		if (lastBeatMs >= 0) nextBeatMs = lastBeatMs + 60000 / bpm
	}

	function tempo() {
		const n = Math.min(envN, Math.round(6 * fr))
		if (n < 2 * lagMax + 8) return
		let mean = 0
		for (let i = 0; i < n; i++) mean += envAt(i)
		mean /= n
		// [1 2 3 2 1] smoothing: flux spikes are 1–2 hops wide and a beat period is rarely a whole number of hops,
		// so unsmoothed peaks drift off each other after a few periods (174 BPM locked at 69.5 without it).
		const x = new Float64Array(n)
		for (let i = 0; i < n; i++) {
			let v = 0
			let wsum = 0
			for (let d = -2; d <= 2; d++) {
				const j = n - 1 - i + d
				if (j < 0 || j >= n) continue
				v += (3 - Math.abs(d)) * envAt(j)
				wsum += 3 - Math.abs(d)
			}
			x[i] = v / wsum - mean
		}
		const acf = (lag) => {
			let s = 0
			for (let i = lag; i < n; i++) s += x[i] * x[i - lag]
			return s / (n - lag)
		}
		const r0 = acf(0)
		if (r0 <= 1e-12) return
		const score = new Float64Array(lagMax + 2)
		let best = -1
		for (let lag = lagMin - 1; lag <= lagMax + 1; lag++) {
			const b = (60 * fr) / lag
			const prior = Math.exp(-0.5 * (Math.log2(b / 120) / 1.2) ** 2)
			score[lag] = (acf(lag) + 0.5 * acf(2 * lag)) * prior
			if (lag >= lagMin && lag <= lagMax && (best < 0 || score[lag] > score[best])) best = lag
		}
		const a = score[best - 1]
		const c = score[best + 1]
		const den = a - 2 * score[best] + c
		const lagF = best + (den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0)
		const est = (60 * fr) / lagF
		conf = Math.max(0, Math.min(1, acf(best) / r0))
		if (bpm && Math.abs(est - bpm) / bpm < 0.04) {
			bpm = bpm * 0.7 + est * 0.3
			candidateHits = 0
		} else if (candidate && Math.abs(est - candidate) / candidate < 0.04) {
			if (++candidateHits >= 2) switchTo(est)
		} else {
			candidate = est
			candidateHits = 0
			if (!bpm) switchTo(est)
		}
	}

	function onHop() {
		// window the last `win` samples (input is a ring ordered oldest-first from inFill)
		let ms = 0
		for (let i = 0; i < win; i++) {
			const v = input[(inFill + i) % win]
			ms += v * v
			re[i] = v * w[i]
			im[i] = 0
		}
		fftRadix2(re, im)
		let flux = 0
		for (let b = 1; b < bins; b++) {
			const l = Math.log(1 + 100 * Math.hypot(re[b], im[b]))
			const d = l - prevLog[b]
			if (d > 0) flux += d
			prevLog[b] = l
		}
		const db = 10 * Math.log10(ms / win + 1e-12)
		level = Math.max(0, Math.min(1, (db - gateDb) / -gateDb))
		if (db < gateDb) flux = 0
		hops++
		const t = nowMs()

		// onset: above the last second's mean + k·std
		const m = Math.min(envN, Math.round(fr))
		let mean = 0
		let sq = 0
		for (let i = 0; i < m; i++) {
			const v = envAt(i)
			mean += v
			sq += v * v
		}
		mean = m ? mean / m : 0
		const std = m ? Math.sqrt(Math.max(0, sq / m - mean * mean)) : 0
		// k·std alone fires on plain noise (its flux wobbles too); a real onset also clears RATIO × the mean.
		const thr = Math.max(mean + k * std, RATIO * mean)
		let onset = false
		if (m >= fr / 2 && flux > 0) {
			if (armed && flux > thr && t - lastOnsetMs >= refractory) {
				onset = true
				armed = false
				lastOnsetMs = t
			} else if (!armed && flux < (mean + thr) / 2) {
				armed = true
			}
		}
		env[envI] = flux
		envI = (envI + 1) % envLen
		if (envN < envLen) envN++
		if (hops % 32 === 0) tempo()

		const locked = bpm > 0 && conf >= CONF_LOCK
		const period = bpm ? 60000 / bpm : 0
		// No grid yet, or it went by unanswered (just locked / music resumed): the next onset re-seeds it.
		const stale = lastBeatMs < 0 || t - nextBeatMs > WINDOW * period
		if (onset) {
			if (!locked || stale) beat(t)
			else if (nextBeatMs - t <= WINDOW * period)
				beat(t) // early (or on time): this onset IS the beat
			else if (t - lastBeatMs <= WINDOW * period) nextBeatMs += (t - lastBeatMs) / 2 // late: pull the grid half-way
		}
		if (locked && !stale && t >= nextBeatMs) {
			if (t - lastOnsetMs < 2000) beat(nextBeatMs)
			else nextBeatMs = t + period // music stopped: hold the grid, no beats
		}
	}

	return {
		/** @param {Float32Array | number[]} samples mono -1..1, contiguous with the previous push */
		push(samples) {
			for (let i = 0; i < samples.length; i++) {
				input[inFill] = samples[i]
				inFill = (inFill + 1) % win
				if (++sinceHop === hop) {
					sinceHop = 0
					onHop()
				}
			}
		},
		/** Stream time in ms (sample clock) — the clock beat times are on. */
		nowMs,
		/**
		 * @returns {{ n: number, age: number, bpm: number, conf: number, phase: number, level: number }}
		 *   n = beats so far (a change = a new beat), age = ms since the last beat (-1 = none yet), phase = 0..1
		 *   through the current beat period.
		 */
		snapshot() {
			const age = lastBeatMs >= 0 ? nowMs() - lastBeatMs : -1
			const period = bpm ? 60000 / bpm : 0
			return {
				n: count,
				age: Math.round(age),
				bpm: Math.round(bpm * 10) / 10,
				conf: Math.round(conf * 100) / 100,
				phase: period && age >= 0 ? Math.round(((age % period) / period) * 1000) / 1000 : 0,
				level: Math.round(level * 1000) / 1000,
			}
		},
		/** Source gone (stale feed): forget tempo and grid; the beat count keeps counting up. */
		reset() {
			input.fill(0)
			prevLog.fill(0)
			env.fill(0)
			envN = envI = 0
			inFill = sinceHop = 0
			armed = true
			level = bpm = conf = candidate = candidateHits = 0
			lastBeatMs = -1
		},
	}
}

/**
 * Bass / mid / high (≤250 Hz, 250 Hz–4 kHz, above) as the mean of the analyser's freq bytes, 0..1 — the same
 * dB-mapped bytes the shaders read from the audio texture, so a band and the texture agree.
 * @param {Uint8Array} freq 512 bins of sampleRate / 1024 Hz
 * @param {number} [sampleRate]
 * @returns {number[]}
 */
function bandsOf(freq, sampleRate = 48000) {
	const binHz = sampleRate / (freq.length * 2)
	const edges = [1, Math.round(250 / binHz) + 1, Math.round(4000 / binHz) + 1, freq.length]
	const out = []
	for (let b = 0; b < 3; b++) {
		let sum = 0
		for (let i = edges[b]; i < edges[b + 1]; i++) sum += freq[i]
		out.push(Math.round((sum / Math.max(1, edges[b + 1] - edges[b]) / 255) * 1000) / 1000)
	}
	return out
}

module.exports = { createBeatDetector, bandsOf }
