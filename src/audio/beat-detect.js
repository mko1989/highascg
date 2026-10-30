'use strict'

/**
 * WO-662 — beat detection for shader audio reactivity (owner 21.10: "Add beat detection and a way to weave it into
 * shaders audio reactivity"); WO-872 (30.10) rebuilt the inside after fosfora (github.com/kevinraymond/fosfora,
 * MIT OR Apache-2.0) and the GTZAN benchmark (tools/audio/eval-beat-tracker.js).
 *
 * Runs on the raw mono samples the FFT engine already receives (src/audio/audio-capture-fft.js pushSamples), not on
 * the 30 Hz frames, so beats are timed to one hop (512 samples ≈ 10.7 ms at 48 kHz). Three stages:
 *  1. onset strength — SuperFlux on log bands, low / mid / high weighted 0.60 / 0.28 / 0.12 (beat-onset.js);
 *  2. tempo — comb-scored autocorrelation with a prior, seed gate, Kalman filter, lock hysteresis and a metrical
 *     anchor against half / double flips (beat-tempo.js);
 *  3. grid — beats fire at predicted instants, onsets only correct the phase (PI loop); a breakdown mutes the grid
 *     without losing its phase; an off-beat lock is moved half a beat (beat-grid.js).
 * Silence (below gateDb for 0.5 s) drops the grid and the lock; the tempo stays as the guess for what comes back.
 * Pure: time is the sample clock, so tests and the benchmark drive it with recorded or synthetic audio.
 */

const { createOnsetFunction } = require('./beat-onset')
const { createTempoTracker } = require('./beat-tempo')
const { createBeatGrid } = require('./beat-grid')

const TEMPO_EVERY = 6 // hops between tempo estimates (≈ 16 Hz at 48 kHz)
const SILENCE_MS = 500

/**
 * @param {{ sampleRate?: number, hop?: number, gateDb?: number, fftSize?: number, delayMs?: number, grid?: object,
 *   priorBpm?: number, priorOct?: number, minBpm?: number, maxBpm?: number, historyS?: number, lockTau?: number,
 *   seedConf?: number, seedConf2?: number, ratios?: number[] }} [opts] all but sampleRate are benchmark knobs
 */
function createBeatDetector(opts = {}) {
	const sr = opts.sampleRate || 48000
	const hop = opts.hop || 512
	const fr = sr / hop // onset frames per second
	const gateDb = opts.gateDb ?? -60
	const onset = createOnsetFunction({ sampleRate: sr, fftSize: opts.fftSize, gateDb })
	const win = onset.size
	// how late an onset reads behind the sound (GTZAN: 20 ms beat 0 and half the window, 43 ms)
	const delayMs = opts.delayMs ?? 20
	const tempo = createTempoTracker({
		fr,
		...pick(opts, ['priorBpm', 'priorOct', 'minBpm', 'maxBpm', 'seedConf', 'seedConf2', 'lockTau', 'ratios', 'historyS']),
	})
	const grid = createBeatGrid({ fr, delayMs, ...opts.grid })
	const input = new Float32Array(win)
	let inFill = 0
	let sinceHop = 0
	let hops = 0
	let level = 0
	let quietMs = 0

	const nowMs = () => (hops * hop * 1000) / sr

	function onHop() {
		const { odf, db } = onset.step(input, inFill)
		level = Math.max(0, Math.min(1, (db - gateDb) / -gateDb))
		hops++
		const t = nowMs()
		quietMs = db < gateDb ? quietMs + 1000 / fr : 0
		if (quietMs >= SILENCE_MS && quietMs < SILENCE_MS + 1000 / fr) {
			grid.drop()
			tempo.unlock()
		}
		if (quietMs >= SILENCE_MS) return
		tempo.push(odf)
		if (hops % TEMPO_EVERY === 0) tempo.update(TEMPO_EVERY / fr)
		grid.step(t, odf, tempo.state())
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
		 * @returns {{ n: number, age: number, bpm: number, conf: number, phase: number, level: number, locked: boolean }}
		 *   n = beats so far (a change = a new beat), age = ms since the last beat (-1 = none yet), phase = 0..1
		 *   through the current beat period (the grid's, so it runs on through a breakdown), conf = tempo support 0..1,
		 *   locked = the tempo is locked and the grid is speaking.
		 */
		snapshot() {
			const t = nowMs()
			const g = grid.state(t)
			const ts = tempo.state()
			return {
				n: g.n,
				age: g.beatMs >= 0 ? Math.round(t - g.beatMs) : -1,
				bpm: Math.round(ts.bpm * 10) / 10,
				conf: Math.round(ts.support * 100) / 100,
				phase: Math.round(g.phase * 1000) / 1000,
				level: Math.round(level * 1000) / 1000,
				locked: ts.locked && !g.muted && g.period > 0,
			}
		},
		/** Source gone (stale feed): forget tempo and grid; the beat count keeps counting up. */
		reset() {
			input.fill(0)
			inFill = sinceHop = 0
			level = quietMs = 0
			onset.reset()
			tempo.reset()
			grid.reset() // keeps the beat count
		},
	}
}

function pick(o, keys) {
	const out = {}
	for (const k of keys) if (o[k] !== undefined) out[k] = o[k]
	return out
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
