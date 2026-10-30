'use strict'

/**
 * WO-872 — tempo from the onset strength (stage 2 of 3), after fosfora's TempoEstimator
 * (crates/fosfora-app/src/audio/beat.rs:499-760, 1414-1650):
 *  - autocorrelation of the last 6 s (8 s and more scored worse on GTZAN), mean-removed, normalised by lag 0 and bias-corrected (n / (n − lag), ≤ 4);
 *  - the 5 best ACF peaks, each also read at 9 metrical ratios, scored as comb (the ACF at 1–4 × the period, 1/h
 *    weights) × a log-Gaussian tempo prior × a small bonus for staying near the tracked tempo;
 *  - a seed gate (one confident reading, or two that agree over 2 s) — noise agrees with itself otherwise;
 *  - a Kalman filter in log2 BPM (a lock ignores a single wild reading), reset after a sustained disagreement;
 *  - lock hysteresis: support = EMA (τ 1.5 s; fosfora 2.5 s locked a median 8.9 s in) of "the winner agrees with the tracked tempo", lock above 0.6,
 *    release below 0.35; a lock held 8 s anchors its metrical level, after which half / double / 3:2 readings count
 *    as agreement instead of pulling the tempo (no 172 ↔ 86 flip-flop).
 * WO-662 had the ACF + prior only, a single ACF-ratio confidence and no lock state.
 */

const { fftRadix2 } = require('./fft')

const RATIOS = [1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1, 4 / 3, 3 / 2, 2]
const RELATED = [2, 1 / 2, 3 / 2, 2 / 3, 4 / 3, 3 / 4].map(Math.log2)

/**
 * @param {{ fr: number, minBpm?: number, maxBpm?: number, priorBpm?: number, priorOct?: number, historyS?: number,
 *   lockTau?: number, seedConf?: number, seedConf2?: number, ratios?: number[] }} opts fr = onset frames per second;
 *   the rest are benchmark knobs (tools/audio/eval-beat-tracker.js --opts), defaults tuned on GTZAN's tune split.
 */
function createTempoTracker(opts) {
	const fr = opts.fr
	const minBpm = opts.minBpm ?? 60
	const maxBpm = opts.maxBpm ?? 200
	const priorBpm = opts.priorBpm ?? 140 // above GTZAN's median (115): the comb leans slow, the prior leans back
	const priorOct = opts.priorOct ?? 1
	const histLen = Math.round((opts.historyS ?? 6) * fr)
	const seedConf = opts.seedConf ?? 0.35
	const lockTau = opts.lockTau ?? 1.5
	const ratios = opts.ratios || RATIOS
	const seedConf2 = opts.seedConf2 ?? 0.1
	const hist = new Float64Array(histLen)
	let histN = 0
	let histI = 0
	let pad = 1
	while (pad < histLen * 2) pad <<= 1
	const re = new Float64Array(pad)
	const im = new Float64Array(pad)
	const acf = new Float64Array(histLen)
	const lagMin = Math.floor((60 * fr) / 300)
	const lagMax = Math.ceil((60 * fr) / 40)

	let x = 0 // log2 BPM; 0 = no tempo yet
	let P = 1
	let support = 0
	let locked = false
	let lockedFor = 0
	let anchored = false
	let diverge = 0
	let seedBpm = 0
	let seedAt = 0
	let clock = 0
	let last = null // last candidate { bpm, conf }, for probes

	const at = (lag) => {
		const i = Math.floor(lag)
		if (i + 1 >= histLen) return 0
		return acf[i] + (acf[i + 1] - acf[i]) * (lag - i)
	}
	const comb = (lag) => {
		let s = 0
		let w = 0
		for (let h = 1; h <= 4; h++) {
			s += at(h * lag) / h
			w += 1 / h
		}
		return s / w
	}

	/** ACF of the history into `acf`; false when there is too little signal. */
	function autocorrelate() {
		const n = histN
		let mean = 0
		for (let i = 0; i < n; i++) mean += hist[(histI - n + i + histLen) % histLen]
		mean /= n
		re.fill(0)
		im.fill(0)
		const v = (i) => hist[(histI - n + i + histLen) % histLen]
		for (let i = 0; i < n; i++) re[i] = v(i) - mean
		fftRadix2(re, im)
		for (let k = 0; k < pad; k++) {
			re[k] = re[k] * re[k] + im[k] * im[k]
			im[k] = 0
		}
		fftRadix2(re, im) // power spectrum is real and even: a forward FFT is the inverse up to 1/pad
		const r0 = re[0]
		if (r0 <= 1e-12) return false
		for (let l = 0; l < histLen; l++) acf[l] = l < n ? (re[l] / r0) * Math.min(4, n / (n - l)) : 0
		return true
	}

	/** Best candidate: { bpm, conf } or null. */
	function candidate(tracked) {
		const peaks = []
		for (let l = lagMin; l <= Math.min(lagMax, histN - 2); l++) {
			if (acf[l] > acf[l - 1] && acf[l] >= acf[l + 1] && acf[l] > 0) {
				const den = acf[l - 1] - 2 * acf[l] + acf[l + 1]
				peaks.push({ lag: l + (den < 0 ? (0.5 * (acf[l - 1] - acf[l + 1])) / den : 0), v: acf[l] })
			}
		}
		if (!peaks.length) return null
		peaks.sort((a, b) => b.v - a.v)
		let best = null
		for (const p of peaks.slice(0, 5)) {
			for (const q of ratios) {
				const lag = p.lag * q
				const bpm = (60 * fr) / lag
				if (bpm < minBpm || bpm > maxBpm) continue
				const c = comb(lag)
				if (c <= 0) continue
				const prior = Math.exp(-0.5 * (Math.log2(bpm / priorBpm) / priorOct) ** 2)
				const cont = tracked ? 1 + 0.25 * Math.exp(-0.5 * ((bpm / tracked - 1) / 0.04) ** 2) : 1
				const score = c * prior * cont
				if (!best || score > best.score) best = { bpm, score, peak: at(lag) }
			}
		}
		if (!best) return null
		const floor = [...acf.subarray(lagMin, Math.min(lagMax, histN - 1))].sort((a, b) => a - b)
		const med = floor[floor.length >> 1] || 0
		best.conf = Math.max(0, Math.min(1, (best.peak - med) / (1 - med)))
		return best
	}

	function update(dt) {
		clock += dt
		if (histN < 2 * fr || !autocorrelate()) return
		const tracked = x ? 2 ** x : 0
		const c = candidate(tracked)
		if (!c) return
		last = c
		if (!x) {
			// seed gate: one confident reading, or two within 5 % at least 2 s apart
			if (
				c.conf >= seedConf ||
				(seedBpm && Math.abs(c.bpm / seedBpm - 1) < 0.05 && clock - seedAt >= 2 && c.conf >= seedConf2)
			) {
				x = Math.log2(c.bpm)
				P = 0.05
			} else if (!seedBpm || Math.abs(c.bpm / seedBpm - 1) >= 0.05) {
				seedBpm = c.bpm
				seedAt = clock
			}
			return
		}
		let z = Math.log2(c.bpm)
		if (anchored && RELATED.some((r) => Math.abs(z - x - r) < 0.08)) z = x // another level of the anchored tempo
		const agrees = Math.abs(2 ** (z - x) - 1) < 0.04
		support += (1 - Math.exp(-dt / lockTau)) * ((agrees ? 1 : 0) - support)
		if (locked && support < 0.35) locked = false
		else if (!locked && support > 0.6) locked = true
		lockedFor = locked ? lockedFor + dt : 0
		if (lockedFor >= 8) anchored = true
		diverge = Math.abs(2 ** (z - x) - 1) > 0.1 ? diverge + 1 : Math.max(0, diverge - 1)
		if (diverge >= (anchored ? 45 : 15)) {
			x = z
			P = 0.05
			diverge = 0
			anchored = locked = false
			support = 0
			return
		}
		P += diverge > 5 ? 0.1 : 0.001
		let r = 0.01 + (1 - c.conf) * 0.5
		if (locked && Math.abs(z - x) > 0.057) r *= 6
		const k = P / (P + r)
		x += k * (z - x)
		P *= 1 - k
	}

	return {
		/** One onset-strength frame. */
		push(v) {
			hist[histI] = v
			histI = (histI + 1) % histLen
			if (histN < histLen) histN++
		},
		/** Re-estimate (call every few frames); dt = seconds since the last call. */
		update,
		/** Tempo in BPM (0 = none yet; held through an unlock), support 0..1, locked. */
		state: () => ({ bpm: x ? 2 ** x : 0, support, locked, anchored, cand: last }),
		/** Silence: the lock goes, the tempo stays as the best guess for when the music returns. */
		unlock() {
			support = 0
			locked = anchored = false
			lockedFor = 0
			histN = histI = 0
		},
		reset() {
			hist.fill(0)
			histN = histI = 0
			x = support = lockedFor = diverge = seedBpm = 0
			P = 1
			locked = anchored = false
		},
	}
}

module.exports = { createTempoTracker }
