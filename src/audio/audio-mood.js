'use strict'

/**
 * WO-861 — mood, loudness, density and sections at a fixed 30 Hz tick, ported from CanYuzbey/music-reactive-lighting
 * (MIT, commit 68880191, see THIRD_PARTY_NOTICES): app/mapping/emotion.py (MoodEngine), app/audio/loudness.py
 * (AdaptiveNormalizer), app/lighting/dynamics.py (DynamicsController), app/audio/tempo.py (density). Their constants are
 * per frame at 30 fps, so this runs on a 30 Hz tick (audio-parts.js drives it from the sample clock).
 *
 * Departures (WO-861 §1.2): the loudness gate is in dBFS (theirs is a fixed RMS tuned to the author's input); onset
 * strength comes from our spectral flux (theirs: |dx| with fixed floor/ceiling); density also counts the running gap
 * once it exceeds the average (theirs freezes through a break); `build` is ours.
 */

const FPS = 30
const GATE_ON_DB = -55
const GATE_OFF_DB = -60
const GATE_HOLD = 40 // ticks below GATE_OFF before the gate closes (their hold_frames)

/** loudness.py AdaptiveNormalizer: gated, adaptive max, ^0.45, instant attack, linear release. */
function createLoudness() {
	const off = 10 ** (GATE_OFF_DB / 20)
	const on = 10 ** (GATE_ON_DB / 20)
	let open = false
	let hold = 0
	let maxRms = 0.15
	let value = 0
	return {
		/** @param {number} rms linear */
		step(rms) {
			if (open) {
				if (rms < off) {
					if (++hold > GATE_HOLD) open = false
				} else hold = 0
			} else if (rms > on) {
				open = true
				hold = 0
			}
			let target = 0
			if (open && rms > off) {
				if (rms > maxRms) maxRms = rms
				else maxRms -= maxRms * 0.001
				maxRms = Math.max(maxRms, 0.005)
				const n = Math.max(0, Math.min(1, (rms - off) / Math.max(maxRms - off, 0.001)))
				target = n ** 0.45
			}
			value = target > value ? target : Math.max(0, value - 0.012)
			return value
		},
		get open() {
			return open
		},
		reset() {
			open = false
			hold = 0
			maxRms = 0.15
			value = 0
		},
	}
}

/** emotion.py MoodEngine with its default baselines. */
function createMood() {
	let avgLow = 0.33
	let avgMid = 0.33
	let avgHigh = 0.33
	const anchor = 0.66
	const spread = 1.5
	const lr = 0.005
	let valence = 0.5
	let arousal = 0
	return {
		/**
		 * @param {{ loudness: number, onset: number, density: number, low: number, mid: number, high: number }} f
		 *   low/mid/high = band shares (sum ≈ 1)
		 */
		step({ loudness, onset, density, low, mid, high }) {
			let a = loudness * 0.5 + density * 0.4 + onset * 0.1
			if (loudness > 0.01) {
				avgLow += (low - avgLow) * lr
				avgMid += (mid - avgMid) * lr
				avgHigh += (high - avgHigh) * lr
				const eL = low / (avgLow + 1e-4)
				const eM = mid / (avgMid + 1e-4)
				const eH = high / (avgHigh + 1e-4)
				const dom = (eM + eH) / (eL + eM + eH + 1e-6)
				const absolute = Math.max(0, Math.min(1, 0.5 + (dom - anchor) * spread))
				const adaptive = 0.5 + (dom - anchor) * spread * 2
				let v = absolute * 0.3 + adaptive * 0.7
				const peak = Math.max(eL, eM, eH)
				if (peak > 1.5) a = Math.min(1, a + (peak - 1.5) * 0.1)
				if (onset > 0.3) v += 0.15
				const glide = Math.max(0.02, Math.min(0.6, 0.05 + a * 0.15 + onset * 0.2))
				valence += (Math.max(0, Math.min(1, v)) - valence) * glide
				arousal += (Math.max(0, Math.min(1, a)) - arousal) * glide
			} else {
				valence += (0.5 - valence) * 0.01
				arousal += (0 - arousal) * 0.05
			}
			return { arousal, valence }
		},
		reset() {
			avgLow = avgMid = avgHigh = 0.33
			valence = 0.5
			arousal = 0
		},
	}
}

/** tempo.py density from inter-onset intervals (≥ 0.2 s, last 20). */
function createDensity() {
	const iois = []
	let last = -1
	const avg = () => iois.reduce((s, v) => s + v, 0) / iois.length
	return {
		/** @param {number} tSec onset time */
		onset(tSec) {
			if (last >= 0 && tSec - last > 0.2) {
				iois.push(tSec - last)
				if (iois.length > 20) iois.shift()
			}
			if (last < 0 || tSec - last > 0.2) last = tSec
		},
		/** @param {number} tSec now */
		value(tSec) {
			if (iois.length === 0) return 0
			let a = avg()
			const gap = last >= 0 ? tSec - last : 0
			if (gap > a) a = (a * iois.length + gap) / (iois.length + 1) // a break counts as it grows
			return Math.max(0, Math.min(1, 1 - (a - 0.1) / 0.9))
		},
		reset() {
			iois.length = 0
			last = -1
		},
	}
}

/**
 * dynamics.py DynamicsController (drop event, minimal mode = `quiet`) + `build` (ours: the 1 s loudness has risen by
 * BUILD_RISE over the last 6 s and is still rising) + `peak` (ours: the 1 s loudness is in the top fifth of the last
 * 2 minutes' range, when that range is at least PEAK_RANGE — a steadily loud, compressed mix is `normal`, measured on
 * the box's live input 30.10, WO-861 §3) + `energy` (10 s mean, absolute).
 */
function createSections() {
	const short = [] // their TimeWindow(10): 10 ticks
	const sec1 = [] // 1 s loudness means, one per tick, last 6 s
	const long = [] // 10 s
	const sec2m = [] // 1 s loudness means, one per second, last 2 min
	let ticks = 0
	let low = 0
	let quiet = false
	let drops = 0
	let lastDrop = -1
	const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0)
	const push = (a, v, n) => {
		a.push(v)
		if (a.length > n) a.shift()
	}
	const BUILD_RISE = 0.2
	const PEAK_RANGE = 0.15
	const DROP_GAP_S = 8
	return {
		/** @returns {{ section: string, energy: number, drop: boolean }} */
		step(loudness, onset, tSec) {
			push(short, loudness, 10)
			const sb = mean(short)
			// theirs: loud ∧ jump over the last 10 ticks ∧ onset. Ours adds: after a quieter 4 s, and at most one per
			// DROP_GAP_S — on the box's live input 30.10 every hit in a sparse break fired theirs (10 in 15 s)
			const before = mean(long.slice(-4 * FPS, -9)) // the 4 s up to the 10-tick window, this tick not yet pushed
			push(long, loudness, 10 * FPS)
			const drop =
				loudness >= 0.65 &&
				loudness - sb >= 0.35 &&
				onset >= 0.55 &&
				loudness - before >= 0.35 &&
				(lastDrop < 0 || tSec - lastDrop >= DROP_GAP_S)
			if (drop) {
				drops++
				lastDrop = tSec
			}
			if (sb < 0.15) low++
			else low = 0
			if (!quiet && low >= 3 * FPS) quiet = true
			if (quiet && sb > 0.2) {
				quiet = false
				low = 0
			}
			push(sec1, mean(long.slice(-FPS)), 6 * FPS)
			const now = sec1[sec1.length - 1]
			const rising = sec1.length >= 2 * FPS && now - sec1[sec1.length - 2 * FPS] > 0.02
			const build = !quiet && rising && now - Math.min(...sec1) >= BUILD_RISE
			if (long.length === 10 * FPS && ++ticks % FPS === 0) push(sec2m, now, 120) // after a 10 s warm-up
			const lo = Math.min(now, ...sec2m)
			const hi = Math.max(now, ...sec2m)
			const peak = hi - lo >= PEAK_RANGE && now >= lo + 0.8 * (hi - lo)
			const section = quiet ? 'quiet' : build ? 'build' : peak ? 'peak' : 'normal'
			return { section, energy: mean(long), drop }
		},
		drops: () => ({ n: drops, at: lastDrop }),
		reset() {
			short.length = sec1.length = long.length = sec2m.length = 0
			low = ticks = 0
			quiet = false
			lastDrop = -1
		},
	}
}

module.exports = { createLoudness, createMood, createDensity, createSections, FPS }
