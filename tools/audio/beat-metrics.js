'use strict'

/**
 * WO-872 — beat-tracking scores, a line-for-line port of mir_eval 0.8.2 `beat.py` (trim_beats, f_measure,
 * continuity) so our numbers sit next to published ones (fosfora docs/BENCHMARKS.md, MIREX). Times in seconds,
 * sorted ascending. Pinned against the real mir_eval in smoke-wo872-beat-metrics.test.js.
 */

/** mir_eval.beat.trim_beats: the first 5 s are ignored (trackers need time to start). */
function trimBeats(beats, minBeatTime = 5) {
	return beats.filter((t) => t >= minBeatTime)
}

/**
 * Size of a maximum one-to-one matching with |ref - est| <= window (mir_eval.util.match_events). On a line with a
 * fixed window, matching the earliest compatible pair is maximal.
 */
function matchCount(ref, est, window) {
	let i = 0
	let j = 0
	let n = 0
	while (i < ref.length && j < est.length) {
		// est − w ≤ ref ≤ est + w, the way mir_eval's searchsorted tests it (|ref − est| ≤ w rounds differently at the edge)
		if (ref[i] >= est[j] - window && ref[i] <= est[j] + window) {
			n++
			i++
			j++
		} else if (ref[i] < est[j] - window) i++
		else j++
	}
	return n
}

/** mir_eval.beat.f_measure (±70 ms). */
function fMeasure(ref, est, window = 0.07) {
	if (!ref.length || !est.length) return 0
	const m = matchCount(ref, est, window)
	const p = m / est.length
	const r = m / ref.length
	return p + r ? (2 * p * r) / (p + r) : 0
}

/** mir_eval.beat._get_reference_beat_variations: original, off-beat, double, half (odd), half (even). */
function variations(ref) {
	const dbl = []
	for (let x = 0; x < ref.length - 0.5; x += 0.5) {
		const i = Math.floor(x)
		dbl.push(x === i ? ref[i] : ref[i] + (ref[i + 1] - ref[i]) * (x - i))
	}
	return [
		ref,
		dbl.filter((_, i) => i % 2 === 1),
		dbl,
		ref.filter((_, i) => i % 2 === 0),
		ref.filter((_, i) => i % 2 === 1),
	]
}

/**
 * mir_eval.beat.continuity: { cmlc, cmlt, amlc, amlt }. CML = correct metrical level (the original reference),
 * AML = allowed metrical levels (off-beat, double, half also count). "c" = longest continuous run, "t" = total.
 */
function continuity(ref, est, phaseThr = 0.175, periodThr = 0.175) {
	if (est.length <= 1 || ref.length <= 1) return { cmlc: 0, cmlt: 0, amlc: 0, amlt: 0 }
	const cont = []
	const total = []
	for (const rb of variations(ref)) {
		const n = Math.max(rb.length, est.length)
		const used = new Uint8Array(n)
		const ok = new Uint8Array(n)
		for (let m = 0; m < est.length; m++) {
			let nearest = 0
			for (let i = 1; i < rb.length; i++) if (Math.abs(est[m] - rb[i]) < Math.abs(est[m] - rb[nearest])) nearest = i
			const minDiff = Math.abs(est[m] - rb[nearest])
			if (used[nearest]) continue
			let phase
			let period
			if (m === 0 || nearest === 0) {
				const refInt = nearest + 1 < rb.length ? rb[nearest + 1] - rb[nearest] : rb[nearest] - rb[nearest - 1]
				const estInt = m + 1 < est.length ? est[m + 1] - est[m] : est[m] - est[m - 1]
				if (refInt === 0) {
					phase = minDiff === 0 ? 1 : Infinity
					period = estInt === 0 ? 0 : Infinity
				} else {
					phase = Math.abs(minDiff / refInt)
					period = Math.abs(1 - estInt / refInt)
				}
			} else {
				const refInt = rb[nearest] - rb[nearest - 1]
				phase = Math.abs(minDiff / refInt)
				period = Math.abs(1 - (est[m] - est[m - 1]) / refInt)
			}
			if (phase < phaseThr && period < periodThr) {
				used[nearest] = 1
				ok[m] = 1
			}
		}
		let longest = 0
		let run = 0
		let sum = 0
		for (let i = 0; i < n; i++) {
			run = ok[i] ? run + 1 : 0
			if (run > longest) longest = run
			sum += ok[i]
		}
		cont.push(longest / n)
		total.push(sum / n)
	}
	return { cmlc: cont[0], cmlt: total[0], amlc: Math.max(...cont), amlt: Math.max(...total) }
}

/** Tempo accuracy (MIREX): Acc1 within ±4 %, Acc2 also at ×2, ×½, ×3, ×⅓. */
function tempoAccuracy(refBpm, estBpm, tol = 0.04) {
	const near = (f) => estBpm > 0 && Math.abs(estBpm - refBpm * f) <= tol * refBpm * f
	return { acc1: near(1) ? 1 : 0, acc2: [1, 2, 0.5, 3, 1 / 3].some(near) ? 1 : 0 }
}

module.exports = { trimBeats, fMeasure, continuity, tempoAccuracy, variations, matchCount }
