'use strict'

/**
 * WO-872 step 5 — the audio-parts level buses (bass / mid / high / tonal) ranged by percentile over 4 s, and the
 * BS.1770 silence gate with hysteresis (src/audio/level-norm.js, after fosfora's normalizer.rs / loudness.rs).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { createAudioParts } = require('../../src/audio/audio-parts.js')
const { createSilenceGate } = require('../../src/audio/level-norm.js')

const SR = 48000

function rng(seed) {
	let x = seed >>> 0
	return () => {
		x = (x * 1664525 + 1013904223) >>> 0
		return x / 2 ** 32 - 0.5
	}
}

/** A 120 BPM kick + a noise pad; `hit` = one 30 ms full-scale noise burst (s). */
function music(sec, { gain = 1, hit = -1 } = {}) {
	const out = new Float32Array(Math.round(sec * SR))
	const r = rng(5)
	for (let i = 0; i < out.length; i++) {
		const tk = (i % (SR / 2)) / SR
		let v = 0.3 * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-tk * 30)) * tk) * Math.exp(-tk * 9) + 0.03 * r()
		if (hit >= 0 && i / SR >= hit && i / SR < hit + 0.03) v += 0.9 * Math.sign(r())
		out[i] = v * gain
	}
	return out
}

const noise = (sec, amp) => {
	const r = rng(9)
	return Float32Array.from({ length: Math.round(sec * SR) }, () => amp * r() * 2)
}

/** Mean of each level bus between t0 and t1 (s). */
function levels(x, t0, t1) {
	const p = createAudioParts({ sampleRate: SR })
	const acc = { bass: 0, mid: 0, high: 0, n: 0 }
	for (let i = 0; i + 480 <= x.length; i += 480) {
		p.push(x.subarray(i, i + 480))
		const t = (i + 480) / SR
		if (t < t0 || t >= t1) continue
		const s = p.snapshot()
		acc.bass += s.bass
		acc.mid += s.mid
		acc.high += s.high
		acc.n++
	}
	return { bass: acc.bass / acc.n, mid: acc.mid / acc.n, high: acc.high / acc.n }
}

describe('WO-872 step 5: level ranging and the silence gate', () => {
	it('one loud hit does not pump the levels afterwards (the WO-861 peak AGC dropped them for 8 s+)', () => {
		const clean = levels(music(12), 7, 11)
		const hit = levels(music(12, { hit: 6 }), 7, 11)
		for (const k of ['bass', 'mid', 'high'])
			assert.ok(Math.abs(hit[k] - clean[k]) < 0.05, `${k}: ${hit[k].toFixed(3)} after the hit vs ${clean[k].toFixed(3)}`)
	})

	it('a quiet passage re-ranges within 4 s', () => {
		const x = music(16)
		for (let i = 8 * SR; i < x.length; i++) x[i] *= 0.1 // −20 dB from 8 s
		const loud = levels(x, 4, 8)
		const quiet = levels(x, 13, 16)
		assert.ok(quiet.bass > 0.6 * loud.bass, `bass ${quiet.bass.toFixed(3)} vs ${loud.bass.toFixed(3)}`)
	})

	it('a quiet room (−57 LUFS noise) stays gated: levels 0, not its noise stretched to full scale', () => {
		const g = createSilenceGate(SR)
		const x = noise(3, 0.0017)
		for (const v of x) g.push(v)
		assert.ok(g.lufs > -60 && g.lufs < -55, `noise reads ${g.lufs.toFixed(1)} LUFS`)
		assert.equal(g.silent, true)
		const s = levels(x, 1, 3)
		assert.deepEqual([s.bass, s.mid, s.high], [0, 0, 0])
	})

	it('hysteresis: music opens the gate, a dip to −57 LUFS keeps it open, −70 closes it after the hold', () => {
		const g = createSilenceGate(SR)
		for (const v of music(2)) g.push(v)
		assert.equal(g.silent, false)
		for (const v of noise(2, 0.0017)) g.push(v)
		assert.equal(g.silent, false, `dip at ${g.lufs.toFixed(1)} LUFS`)
		const q = noise(1, 0.0001)
		let closedAt = -1
		for (let i = 0; i < q.length; i++) {
			g.push(q[i])
			if (closedAt < 0 && g.silent) closedAt = i / SR
		}
		assert.ok(closedAt > 0.25 && closedAt < 0.7, `closed ${closedAt.toFixed(2)} s into the quiet`)
	})

	it('BS.1770 calibration: a 997 Hz sine at −20 dBFS reads −23.0 LUFS', () => {
		const g = createSilenceGate(SR)
		for (let i = 0; i < SR; i++) g.push(0.1 * Math.sin((2 * Math.PI * 997 * i) / SR))
		assert.ok(Math.abs(g.lufs + 23.01) < 0.05, `${g.lufs}`)
	})
})
