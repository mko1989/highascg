'use strict'

/**
 * WO-861 — real-time audio "parts" from the live input (owner 30.10: "it needs to be real time based on the audio input
 * from a dj/band"). Runs on the same mono samples as the WO-662 beat detector (audio-capture-fft.js pushSamples), one
 * 2048-point spectrum per 512-sample hop (10.7 ms at 48 kHz, 23.4 Hz bins), and keeps named buses (WO-858 §3.3):
 *
 *  - kick / snare / hats: band-limited spectral flux, each against its own last second (mean + k·std, × ratio,
 *    re-arm, refractory, floor), decided 2 hops later: only near the band's own peak, and when two drums fire
 *    together the weaker band must be close enough in level to be its own hit (a kick's click is not a snare).
 *  - bass / mid / high: band energy against its own P5..P95 of the last 4 s (WO-872, level-norm.js), so a quiet DJ and
 *    a loud band both span 0..1 and a loud hit does not pump them; 0 while the BS.1770 silence gate is closed.
 *  - tonal: harmonic energy 300–3400 Hz (causal HPSS: median over the last 9 hops vs across ±8 bins) × the harmonic
 *    ratio — the real-time proxy for vocals / leads (true vocals need stems, WO-861 §1.3).
 *  - loudness, onset, density, arousal, valence, energy, section, drop: audio-mood.js (CanYuzbey port) on a 30 Hz tick.
 * Band split after CanYuzbey/music-reactive-lighting app/audio/live_analyzer.py (MIT, commit 68880191, see
 * THIRD_PARTY_NOTICES). Pure: time is the sample clock, so tests drive it with synthetic audio.
 */

const { fftRadix2 } = require('./fft')
const { createLoudness, createMood, createDensity, createSections, FPS } = require('./audio-mood')
const { createPercentileAgc, createSilenceGate } = require('./level-norm')

const WIN = 2048
const HOP = 512
const PULSE_MS = 150 // an onset's pulse decays 1 → 0 over this
const AGC_RANGE_DB = 36
const AGC_DECAY_DB_S = 1.5
const GATE_DB = -60
const HPSS_T = 9 // hops of history for the harmonic median
const HPSS_F = 8 // ± bins for the percussive median
const FLUX_FLOOR = 0.5 // band flux below this is no onset (a steady tone's jitter stays < 0.1, a hit > 1)
// WO-866, scored against MDB Drums (23 annotated mixes, tools/audio/eval-drum-detector.js): the WO-861 rule (k 1.5 × all,
// NEAR_PEAK 24, plain flux) fired ~2 false kicks per real one. Per-drum thresholds, SuperFlux (±1 bin) and the percussive
// part for kick / snare (bass notes and vocals are harmonic) took the non-jazz F from 61 / 50 / 72 to 79 / 57 / 77.
const TUNE = {
	maxBins: 1,
	nearPeakDb: 12,
	perc: ['kick', 'snare'],
	kick: { k: 3, ratio: 2 },
	snare: { k: 3.5, ratio: 1.5 },
	hats: { k: 1.2, ratio: 3 },
}
/** Sensitivity 0..1 (0.5 = as tuned) → threshold factor: 0 doubles k, 1 halves it (near-peak range: the inverse). */
const kOf = (k, sens) => k * 2 ** ((0.5 - Math.max(0, Math.min(1, sens))) * 2)
// co-fire rules, measured on a synthetic kit (WO-861 §3): a kick's click sits ~44 dB under it in the snare band, a snare
// hit on a kick 20–22 dB; a snare's noise/body sits ~6 dB under it in the kick band, a kick hit is the loudest band
const SNARE_UNDER_KICK_DB = 30
const KICK_UNDER_SNARE_DB = 0
const SNARE_UNDER_HATS_DB = 12 // a hat sits ~25 dB under itself in the snare band, a snare on a hat ~2 dB above

/** Band-limited flux onset picker: the WO-662 rule (beat-detect.js) per band. */
function createBandOnset({ fr, k: k0 = 1.5, ratio = 1.5, refractoryMs = 100 }) {
	let k = k0
	const len = Math.round(fr)
	const ring = new Float64Array(len)
	let n = 0
	let i = 0
	let armed = true
	let lastMs = -1e9
	return {
		/** @returns {number} 0 = no onset, else strength (flux / threshold ≥ 1) */
		step(flux, tMs) {
			let mean = 0
			let sq = 0
			for (let j = 0; j < n; j++) {
				mean += ring[j]
				sq += ring[j] * ring[j]
			}
			mean = n ? mean / n : 0
			const std = n ? Math.sqrt(Math.max(0, sq / n - mean * mean)) : 0
			const thr = Math.max(mean + k * std, ratio * mean, FLUX_FLOOR)
			let s = 0
			if (n >= len / 2 && flux > 0) {
				if (armed && flux > thr && tMs - lastMs >= refractoryMs) {
					s = flux / thr
					armed = false
					lastMs = tMs
				} else if (!armed && flux < (mean + thr) / 2) armed = true
			}
			ring[i] = flux
			i = (i + 1) % len
			if (n < len) n++
			return s
		},
		/** flux relative to the last second's mean (0 below the floor or when unknown) */
		rel(flux) {
			let mean = 0
			for (let j = 0; j < n; j++) mean += ring[j]
			return n && flux >= FLUX_FLOOR ? flux / Math.max(mean / n, FLUX_FLOOR) : 0
		},
		/** WO-866: the operator's sensitivity (0..1, 0.5 = as tuned) */
		sensitivity(s) {
			k = kOf(k0, s)
		},
		reset() {
			ring.fill(0)
			n = i = 0
			armed = true
			lastMs = -1e9
		},
	}
}

/** Level against a decaying peak, instant attack, ~150 ms release (the drum buses: `near()` is tuned on MDB Drums). */
function createAgc(fr) {
	let peak = -200
	let v = 0
	let db = -200
	const rel = Math.exp(-1 / (0.15 * fr))
	return {
		step(energy, gated) {
			db = 10 * Math.log10(energy + 1e-20)
			peak = db > peak ? db : peak - AGC_DECAY_DB_S / fr
			const target = gated ? 0 : Math.max(0, Math.min(1, (db - (peak - AGC_RANGE_DB)) / AGC_RANGE_DB))
			v = target > v ? target : target + (v - target) * rel
			return v
		},
		get value() {
			return v
		},
		/** `db` (default: the last step's) is within `range` dB of the peak */
		near(range, at = db) {
			return at >= peak - range
		},
		reset() {
			peak = -200
			v = 0
		},
	}
}

function median(a, n) {
	const s = Array.prototype.slice.call(a, 0, n).sort((x, y) => x - y)
	return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2
}

/**
 * @param {{ sampleRate?: number, tune?: object }} [opts] `tune` (WO-866, eval-drum-detector.js): per drum
 *   `{ k, ratio, refractoryMs }`, `maxBins` (SuperFlux: each bin against the max of ±maxBins bins one hop back, so
 *   vibrato and glides are no onset), `nearPeakDb`.
 */
function createAudioParts(opts = {}) {
	const sr = opts.sampleRate || 48000
	const fr = sr / HOP
	const binHz = sr / WIN
	const bin = (hz) => Math.max(1, Math.min(WIN / 2 - 1, Math.round(hz / binHz)))
	const B = {
		kick: [bin(40), bin(120)],
		snare: [bin(1000), bin(5000)],
		snareBody: [bin(150), bin(400)],
		hats: [bin(6000), bin(16000)],
		full: [bin(40), bin(10000)],
		bass: [bin(20), bin(250)],
		mid: [bin(250), bin(2000)],
		high: [bin(2000), bin(8000)],
		tonal: [bin(300), bin(3400)],
	}
	const tIn = opts.tune || {}
	const tune = {
		...TUNE,
		...tIn,
		kick: { ...TUNE.kick, ...tIn.kick },
		snare: { ...TUNE.snare, ...tIn.snare },
		hats: { ...TUNE.hats, ...tIn.hats },
	}
	for (const [k, [lo, hi]] of Object.entries(tune.bands || {})) B[k] = [bin(lo), bin(hi)] // eval only
	const perc = tune.perc || [] // drums whose flux reads the percussive part only (vocals / leads / bass notes are harmonic)
	const hBins = [
		Math.min(B.mid[0], ...perc.map((k) => B[k][0])),
		Math.max(B.mid[1], B.tonal[1], ...perc.map((k) => B[k][1])),
	] // HPSS range
	const hN = hBins[1] - hBins[0] + 1
	const hist = Array.from({ length: hN }, () => new Float64Array(HPSS_T))
	let histI = 0
	let histN = 0

	const hann = new Float64Array(WIN)
	for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1))
	const re = new Float64Array(WIN)
	const im = new Float64Array(WIN)
	const mag = new Float64Array(WIN / 2)
	const prevLog = new Float64Array(WIN / 2)
	const prevMax = new Float64Array(WIN / 2)
	const pmag = new Float64Array(WIN / 2)
	const prevLogP = new Float64Array(WIN / 2)
	const maxBins = tune.maxBins || 0
	const nearDb = { kick: tune.nearPeakDb, snare: tune.nearPeakDb, hats: tune.nearPeakDb } // per drum: sensitivity widens it
	const input = new Float32Array(WIN)
	let inFill = 0
	let sinceHop = 0
	let hops = 0
	let samples = 0

	const on = {
		kick: createBandOnset({ fr, refractoryMs: 100, ...tune.kick }),
		snare: createBandOnset({ fr, refractoryMs: 100, ...tune.snare }),
		hats: createBandOnset({ fr, refractoryMs: 50, ...tune.hats }),
		full: createBandOnset({ fr, refractoryMs: 100 }),
	}
	const hits = { kick: { n: 0, at: -1e9 }, snare: { n: 0, at: -1e9 }, hats: { n: 0, at: -1e9 } }
	const agc = {
		bass: createPercentileAgc(fr, B.bass[1] - B.bass[0] + 1),
		mid: createPercentileAgc(fr, B.mid[1] - B.mid[0] + 1),
		high: createPercentileAgc(fr, B.high[1] - B.high[0] + 1),
		tonal: createPercentileAgc(fr, B.tonal[1] - B.tonal[0] + 1),
		kick: createAgc(fr),
		snare: createAgc(fr),
		hats: createAgc(fr),
	}
	let tonalRatio = 0
	const gate = createSilenceGate(sr)

	const loud = createLoudness()
	const mood = createMood()
	const dens = createDensity()
	const sect = createSections()
	const tickEvery = sr / FPS
	let nextTick = tickEvery
	let tickSq = 0
	let tickN = 0
	let tickOnset = 0
	const share = { low: 0, mid: 0, high: 0, n: 0 }
	let out = { loudness: 0, onset: 0, density: 0, arousal: 0, valence: 0.5, energy: 0, section: 'quiet' }

	const nowMs = () => (samples * 1000) / sr
	const sum = (a, [lo, hi], sq = false) => {
		let s = 0
		for (let b = lo; b <= hi; b++) s += sq ? a[b] * a[b] : a[b]
		return s
	}

	function flux([lo, hi]) {
		let f = 0
		for (let b = lo; b <= hi; b++) {
			const d = Math.log(1 + 100 * mag[b]) - prevMax[b]
			if (d > 0) f += d
		}
		return f
	}

	function fluxP([lo, hi]) {
		let f = 0
		for (let b = lo; b <= hi; b++) {
			const d = Math.log(1 + 100 * pmag[b]) - prevLogP[b]
			if (d > 0) f += d
		}
		return f
	}

	const DRUMS = ['kick', 'snare', 'hats']
	const LOOK = 2
	const HIST = LOOK + 2 // hops h0-1 .. h0+LOOK
	const dHist = Object.fromEntries(
		DRUMS.map((k) => [k, { e: new Float64Array(HIST).fill(-200), f: new Array(HIST).fill(false) }])
	)
	const at = (h0, d) => (h0 + d + HIST) % HIST
	const eMax = (k, h0) => Math.max(dHist[k].e[h0], dHist[k].e[at(h0, 1)], dHist[k].e[at(h0, 2)])
	const firedNear = (k, h0) => dHist[k].f[at(h0, -1)] || dHist[k].f[h0] || dHist[k].f[at(h0, 1)]

	/** Onsets at hop slot h0, decided now (t; the pulse starts at 1): count those near their band peak, settle bleed. */
	function decide(h0, t) {
		const E = {}
		const fired = {}
		for (const k of DRUMS) {
			E[k] = eMax(k, h0)
			// bleed from another drum is far below that band's own peak (in a mix)
			fired[k] = dHist[k].f[h0] && agc[k].near(nearDb[k], E[k])
		}
		// alone, a kick's click and a hat still rise in the snare band, a snare's noise in the kick band: when both fire
		// (±1 hop), the weaker band must be close enough to be its own hit
		if (fired.snare && firedNear('kick', h0)) fired.snare = E.snare >= eMax('kick', h0) - SNARE_UNDER_KICK_DB
		if (fired.snare && firedNear('hats', h0)) fired.snare = E.snare >= eMax('hats', h0) - SNARE_UNDER_HATS_DB
		if (fired.kick && firedNear('snare', h0)) fired.kick = E.kick >= eMax('snare', h0) - KICK_UNDER_SNARE_DB
		for (const k of DRUMS) {
			if (!fired[k]) continue
			hits[k].n++
			hits[k].at = t
		}
	}

	function onHop() {
		let ms = 0
		for (let i = 0; i < WIN; i++) {
			const v = input[(inFill + i) % WIN]
			ms += v * v
			re[i] = v * hann[i]
			im[i] = 0
		}
		fftRadix2(re, im)
		for (let b = 0; b < WIN / 2; b++) mag[b] = Math.hypot(re[b], im[b]) / (WIN / 4)
		const gated = 10 * Math.log10(ms / WIN + 1e-12) < GATE_DB
		hops++
		const t = nowMs()

		// causal HPSS over the mid/tonal range
		for (let j = 0; j < hN; j++) hist[j][histI] = mag[hBins[0] + j]
		histI = (histI + 1) % HPSS_T
		if (histN < HPSS_T) histN++
		let hMid = 0
		let hTonal = 0
		let tTonal = 0
		const win = new Float64Array(2 * HPSS_F + 1)
		for (let j = 0; j < hN; j++) {
			const b = hBins[0] + j
			const h = median(hist[j], histN)
			let w = 0
			for (let d = -HPSS_F; d <= HPSS_F; d++) win[w++] = mag[Math.max(1, Math.min(WIN / 2 - 1, b + d))]
			const p = median(win, w)
			const m = h * h + p * p > 0 ? (h * h) / (h * h + p * p) : 0
			pmag[b] = (1 - m) * mag[b]
			if (b >= B.mid[0] && b <= B.mid[1]) hMid += m * mag[b]
			if (b >= B.tonal[0] && b <= B.tonal[1]) {
				hTonal += (m * mag[b]) ** 2
				tTonal += mag[b] * mag[b]
			}
		}
		tonalRatio = tTonal > 0 ? hTonal / tTonal : 0

		const fx = {}
		for (const k of ['kick', 'snare', 'hats', 'full']) fx[k] = gated ? 0 : perc.includes(k) ? fluxP(B[k]) : flux(B[k])
		fx.snare += gated ? 0 : 0.5 * flux(B.snareBody)
		for (let b = 0; b < WIN / 2; b++) prevLog[b] = Math.log(1 + 100 * mag[b])
		for (let b = hBins[0]; b <= hBins[1]; b++) prevLogP[b] = Math.log(1 + 100 * pmag[b])
		for (let b = 0; b < WIN / 2; b++) {
			let m = prevLog[b]
			for (let d = 1; d <= maxBins; d++)
				m = Math.max(m, prevLog[Math.max(0, b - d)], prevLog[Math.min(WIN / 2 - 1, b + d)])
			prevMax[b] = m
		}

		// decide each drum onset LOOK hops later (21 ms): on the attack hop the band's energy is still climbing
		const h = hops % HIST
		for (const k of DRUMS) {
			const e = sum(mag, B[k], true)
			agc[k].step(e, gated)
			dHist[k].e[h] = 10 * Math.log10(e + 1e-20)
			dHist[k].f[h] = on[k].step(fx[k], t) > 0
		}
		if (hops > HIST) decide((hops - LOOK) % HIST, t)
		const sFull = on.full.step(fx.full, t)
		if (sFull) dens.onset(t / 1000)
		tickOnset = Math.max(tickOnset, Math.max(0, Math.min(1, (on.full.rel(fx.full) - 1) / 3)))

		agc.bass.step(sum(mag, B.bass, true), gate.silent)
		agc.mid.step(sum(mag, B.mid, true), gate.silent)
		agc.high.step(sum(mag, B.high, true), gate.silent)
		agc.tonal.step(hTonal, gate.silent)

		const low = sum(mag, B.bass)
		const high = sum(mag, B.high)
		const tot = low + hMid + high + 1e-12
		share.low += low / tot
		share.mid += hMid / tot
		share.high += high / tot
		share.n++
	}

	function onTick() {
		const rms = tickN ? Math.sqrt(tickSq / tickN) : 0
		const tSec = nowMs() / 1000
		const loudness = loud.step(rms)
		const n = Math.max(1, share.n)
		const density = dens.value(tSec)
		const m = mood.step({
			loudness,
			onset: tickOnset,
			density,
			low: share.low / n,
			mid: share.mid / n,
			high: share.high / n,
		})
		const s = sect.step(loudness, tickOnset, tSec)
		out = {
			loudness,
			onset: tickOnset,
			density,
			arousal: m.arousal,
			valence: m.valence,
			energy: s.energy,
			section: s.section,
		}
		tickSq = tickN = tickOnset = 0
		share.low = share.mid = share.high = share.n = 0
	}

	const r3 = (v) => Math.round(v * 1000) / 1000
	const pulse = (h, t) => r3(Math.max(0, 1 - (t - h.at) / PULSE_MS))

	return {
		/** @param {Float32Array | number[]} x mono -1..1, contiguous with the previous push */
		push(x) {
			for (let i = 0; i < x.length; i++) {
				const v = x[i]
				gate.push(v)
				input[inFill] = v
				inFill = (inFill + 1) % WIN
				tickSq += v * v
				tickN++
				samples++
				if (++sinceHop === HOP) {
					sinceHop = 0
					onHop()
				}
				if (samples >= nextTick) {
					nextTick += tickEvery
					onTick()
				}
			}
		},
		nowMs,
		/** WO-866: per-drum sensitivity 0..1 (0.5 = as tuned; higher = more hits), e.g. `{ kick: 0.6 }`. */
		sensitivity(map) {
			for (const k of DRUMS) {
				if (!Number.isFinite(map?.[k])) continue
				on[k].sensitivity(map[k]) // the flux threshold …
				nearDb[k] = tune.nearPeakDb / kOf(1, map[k]) // … and how far under the band's peak a hit may be (6 / 12 / 24 dB)
			}
		},
		/**
		 * The buses, 0..1 unless noted. Drum buses: `onset` = a pulse 1 → 0 over 150 ms, `n` = hits so far (a change =
		 * a new hit; consumers at 30 Hz never miss one), `level` = the band's energy (AGC).
		 */
		snapshot() {
			const t = nowMs()
			const d = sect.drops()
			const drum = (k) => ({ level: r3(agc[k].value), onset: pulse(hits[k], t), n: hits[k].n })
			return {
				kick: drum('kick'),
				snare: drum('snare'),
				hats: drum('hats'),
				bass: r3(agc.bass.value),
				mid: r3(agc.mid.value),
				high: r3(agc.high.value),
				tonal: r3(agc.tonal.value * Math.max(0, Math.min(1, (tonalRatio - 0.3) / 0.5))),
				loudness: r3(out.loudness),
				onset: r3(out.onset),
				density: r3(out.density),
				arousal: r3(out.arousal),
				valence: r3(out.valence),
				energy: r3(out.energy),
				section: out.section,
				drop: { n: d.n, age: d.at >= 0 ? Math.round(t - d.at * 1000) : -1 },
			}
		},
		/** Source gone (stale feed): forget the history; hit and drop counts keep counting up. */
		reset() {
			input.fill(0)
			prevLog.fill(0)
			prevMax.fill(0)
			prevLogP.fill(0)
			for (const k in on) on[k].reset()
			for (const k in agc) agc[k].reset()
			gate.reset()
			for (const k in hits) hits[k].at = -1e9 // no pulse frozen on the stale frame
			for (const h of hist) h.fill(0)
			for (const k of DRUMS) {
				dHist[k].e.fill(-200)
				dHist[k].f.fill(false)
			}
			histI = histN = inFill = sinceHop = 0
			tonalRatio = 0
			loud.reset()
			mood.reset()
			dens.reset()
			sect.reset()
			tickSq = tickN = tickOnset = 0
			share.low = share.mid = share.high = share.n = 0
			out = { loudness: 0, onset: 0, density: 0, arousal: 0, valence: 0.5, energy: 0, section: 'quiet' }
		},
	}
}

module.exports = { createAudioParts }
