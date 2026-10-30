'use strict'

/**
 * WO-872 — the beat grid (stage 3 of 3), after fosfora's BeatScheduler (crates/fosfora-app/src/audio/beat.rs:1660-2490):
 * beats fire at PREDICTED grid instants and onsets only correct the grid, never fire beats themselves.
 *  - Phase seed: the grid starts where the last 4 s of onset strength line up best at the tempo's period, not at
 *    whatever onset comes next (WO-662 seeded on the next onset — often a hat or an off-beat).
 *  - PI loop: the strongest onset within ±25 % of a period of an instant (score √strength · e^(−½(e / 60 ms)²)) pulls
 *    the next instant by 0.5 × its error (fosfora 0.3; 0.5 scored higher on GTZAN) and trims the period by 0.02 × error / period (trim ≤ ±2 %, decays per beat).
 *  - Support: EMA (0.25 per beat) of "an onset sat within min(10 % of a period, 70 ms)". Below 0.2 the grid runs on
 *    MUTED (a breakdown: phase kept, no beats), above 0.4 it speaks again with no re-acquisition (WO-662 dropped the
 *    grid 2 s after the last onset and had to find the phase again when the drop came).
 *  Not taken: fosfora's off-beat arbiter (beat.rs:1740-1880). With the low band standing in for its kick model it
 *  moved GTZAN by −0.001 F (WO-872), so it was left out.
 *  - Unlocked tempo: a beat only where an onset and the grid agree.
 */

const SIGMA_MS = 60

/**
 * @param {{ fr: number, delayMs?: number, kPhase?: number, kTrim?: number, hitFrac?: number }} opts fr = onset frames per
 *   second; delayMs = onset-function latency; kPhase / kTrim = PI gains; hitFrac = support's strength gate.
 */
function createBeatGrid(opts) {
	const fr = opts.fr
	const frameMs = 1000 / fr
	const delayMs = opts.delayMs ?? 0
	const kPhase = opts.kPhase ?? 0.5
	const kTrim = opts.kTrim ?? 0.02
	// a hit must reach 1/4 of the recent hits' median strength: steady noise in a breakdown always offers some onset
	// within 50 ms of an instant and kept the grid speaking (SuperFlux is a log rise, so a quieter kick still clears it)
	const hitFrac = opts.hitFrac ?? 0.25
	const hitRing = []
	const histLen = Math.round(4 * fr)
	const odfHist = new Float64Array(histLen)
	let histN = 0
	let histI = 0

	// onset picking: median + 2·MAD of the last 0.5 s, local maximum, 50 ms cooldown
	const pickLen = Math.max(5, Math.round(0.5 * fr))
	let lastOnsetMs = -1e9

	let period = 0 // ms; 0 = no grid
	let next = 0 // next instant (ms)
	let last = -1 // last instant (ms), -1 = none
	let trim = 0
	let support = 0
	let muted = false
	let bid = null // best onset bid for `last`: { e, score }
	let bidNext = null // bids that arrived early for `next`
	let closed = true // `last`'s bid window has been applied
	let beats = 0
	let beatMs = -1
	let lastEmitted = -1e9

	const histAt = (h, back) => h[(histI - 1 - back + histLen * 2) % histLen] // back 0 = newest frame

	function pickOnset(t) {
		if (histN < 3) return null
		const m = Math.min(histN - 1, pickLen)
		const win = []
		for (let i = 1; i <= m; i++) win.push(histAt(odfHist, i))
		win.sort((a, b) => a - b)
		const med = win[win.length >> 1]
		const mad = win.map((v) => Math.abs(v - med)).sort((a, b) => a - b)[win.length >> 1]
		const v = histAt(odfHist, 1) // the previous frame, if it is a peak
		if (v > histAt(odfHist, 0) && v >= histAt(odfHist, 2) && v > med + 2 * mad && v > 1e-3 && t - lastOnsetMs >= 50) {
			lastOnsetMs = t - frameMs
			return { t: t - frameMs, s: v }
		}
		return null
	}

	/** Where in the period the last 4 s of `h` line up best: ms of the newest aligned instant (≤ t). */
	function bestPhase(h, t, per) {
		const perF = per / frameMs
		const n = Math.min(histN, histLen)
		let bestOff = 0
		let bestV = -1
		for (let off = 0; off < perF; off++) {
			let v = 0
			for (let b = off; b < n - 1; b += perF) {
				const i = Math.floor(b)
				v += histAt(h, i) * (1 - (b - i)) + histAt(h, i + 1) * (b - i)
			}
			if (v > bestV) {
				bestV = v
				bestOff = off
			}
		}
		return t - bestOff * frameMs
	}

	function emit(at) {
		beats++
		beatMs = at
		lastEmitted = at
	}

	/** Close `last`'s bid window: PI correction, support, mute state. */
	function settle() {
		closed = true
		const tol = Math.min(0.1 * period, 70)
		const ref = hitRing.length >= 4 ? [...hitRing].sort((a, b) => a - b)[hitRing.length >> 1] : 0
		const hit = bid && Math.abs(bid.e) <= tol && bid.s >= hitFrac * ref ? 1 : 0
		if (hit) {
			hitRing.push(bid.s)
			if (hitRing.length > 8) hitRing.shift()
		}
		if (bid) {
			next += kPhase * bid.e
			trim = Math.max(-0.02, Math.min(0.02, trim + (kTrim * bid.e) / period))
		}
		trim *= hit ? 0.85 : 0.5
		support += 0.25 * (hit - support)
		if (!muted && support < 0.2) muted = true
		else if (muted && support > 0.4) muted = false
		bid = null
	}

	return {
		/**
		 * One onset frame at stream time t (ms, end of the frame). tempo = { bpm, locked } from the tempo tracker.
		 * @returns {boolean} a beat fired this frame
		 */
		step(t, odf, tempo) {
			odfHist[histI] = odf
			histI = (histI + 1) % histLen
			if (histN < histLen) histN++
			const tt = t - delayMs // when the sound happened
			const o = pickOnset(tt)
			if (!tempo.bpm) return false
			const per = 60000 / tempo.bpm
			if (!period) {
				if (histN < fr * 2) return false
				period = per
				last = -1
				next = bestPhase(odfHist, tt, period) + period
				while (next < tt) next += period
				support = 0.5
			}
			if (Math.abs(per / period - 1) > 0.04)
				period = per // a new tempo; the phase carries over
			else period += 0.1 * (per - period)
			let fired = false
			if (o) {
				const score = (e) => Math.sqrt(o.s) * Math.exp(-0.5 * (e / SIGMA_MS) ** 2)
				if (!closed && Math.abs(o.t - last) <= 0.25 * period) {
					const e = o.t - last
					if (!bid || score(e) > bid.score) bid = { e, score: score(e), s: o.s }
				} else if (Math.abs(o.t - next) <= 0.25 * period) {
					const e = o.t - next
					if (!bidNext || score(e) > bidNext.score) bidNext = { e, score: score(e), s: o.s }
				}
				// unlocked: a beat only where the onset sits on the grid
				const tol = Math.min(0.1 * period, 70)
				const near = Math.min(Math.abs(o.t - next), last >= 0 ? Math.abs(o.t - last) : Infinity)
				if (!tempo.locked && near <= tol && o.t - lastEmitted >= 0.6 * period) {
					emit(o.t)
					fired = true
				}
			}
			if (!closed && tt >= last + 0.25 * period) settle()
			if (t >= next) {
				// instants are sound times, so a predicted beat fires as the stream reaches it; only onsets lag (delayMs)
				last = next
				next = last + period * (1 + trim)
				closed = false
				bid = bidNext
				bidNext = null
				if (tempo.locked && !muted) {
					emit(last)
					fired = true
				}
			}
			return fired
		},
		/** { n, beatMs (last emitted beat, -1 = none), period, phase 0..1 of the grid, muted } */
		state(t) {
			const phase = period && last >= 0 ? ((((t - last) / period) % 1) + 1) % 1 : 0
			return { n: beats, beatMs, period, phase, muted, support }
		},
		/** Silence: forget the grid (the beat count keeps counting). */
		drop() {
			period = 0
			last = -1
			bid = bidNext = null
			closed = true
			trim = 0
			hitRing.length = 0
			support = 0
			muted = false
		},
		reset() {
			this.drop()
			odfHist.fill(0)
			histN = histI = 0
			beatMs = -1
			lastEmitted = lastOnsetMs = -1e9
		},
	}
}

module.exports = { createBeatGrid }
