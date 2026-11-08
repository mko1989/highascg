'use strict'

/**
 * WO-999 smoke — FragCoord's `u_audio` spectrum rows computed on the box (src/audio/fft-fragcoord.js): the A-weight
 * table, Web Audio levels (|X|/N, smoothing 0.8, −90..−10 dB), weighted vs raw, reset, and the wiring into the
 * audio_fft frame and its WS broadcast.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createFragcoordAnalyser, weightTable, aWeightDb } = require('../../src/audio/fft-fragcoord')

const REPO = path.join(__dirname, '../..')
const src = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
const SR = 48000
const N = 1024

/** A sine centred on bin `k` (no leakage between bins beyond the window's own). */
function tone(k, amp) {
	const s = new Float32Array(N)
	for (let i = 0; i < N; i++) s[i] = amp * Math.sin((2 * Math.PI * k * i) / N)
	return s
}

function settle(an, samples, frames = 80) {
	let r
	for (let i = 0; i < frames; i++) r = an.rows(samples)
	return r
}

describe('WO-999 FragCoord A-weighting', () => {
	it('matches IEC 61672 at its reference points (+2 dB normalisation)', () => {
		assert.ok(Math.abs(aWeightDb(1000)) < 0.1, `0 dB at 1 kHz, got ${aWeightDb(1000)}`)
		assert.ok(Math.abs(aWeightDb(100) + 19.1) < 0.2, `−19.1 dB at 100 Hz, got ${aWeightDb(100)}`)
		assert.equal(aWeightDb(0), -Infinity)
	})

	it('the per-bin table starts at −80, never falls and is capped at 0', () => {
		const w = weightTable(SR, N)
		assert.equal(w.length, 512)
		assert.equal(w[0], -80, 'bin 0 (DC) is the floor')
		for (let k = 1; k < w.length; k++) assert.ok(w[k] >= w[k - 1], `monotonic at ${k}`)
		assert.ok(w.every((v) => v <= 0))
		assert.ok(Math.abs(w[2] - aWeightDb(93.75)) < 1e-4, 'bin 2 = A(93.75 Hz)')
		assert.equal(w[64], 0, '3 kHz passes unweighted (the A peak is capped)')
	})
})

describe('WO-999 FragCoord rows', () => {
	it('silence → all zero; wrong length throws', () => {
		const an = createFragcoordAnalyser()
		const r = an.rows(new Float32Array(N))
		assert.equal(r.raw.length, 512)
		assert.ok(r.raw.every((b) => b === 0) && r.weighted.every((b) => b === 0))
		assert.throws(() => an.rows(new Float32Array(512)), /1024 samples/)
	})

	it('full-scale tone settles at the Web Audio level (|X|/N · Blackman = −13.6 dB → byte 244)', () => {
		const an = createFragcoordAnalyser()
		const r = settle(an, tone(64, 1))
		// 0.42/2 = 0.21 → 20·log10 = −13.56 dB → (76.44 / 80)·255 = 243.6
		assert.equal(r.raw[64], 244)
		assert.equal(r.weighted[64], r.raw[64], 'no weighting at 3 kHz')
		assert.ok(r.raw[200] < 20, `far bins stay low, got ${r.raw[200]}`)
	})

	it('the loud end is kept (the Shadertoy bytes clip at −30 dB)', () => {
		const an = createFragcoordAnalyser()
		const a = settle(an, tone(64, 1)).raw[64]
		an.reset()
		const b = settle(an, tone(64, 0.5)).raw[64] // −6 dB
		assert.ok(a > b && Math.abs(a - b - Math.round((6.02 / 80) * 255)) <= 1, `6 dB apart: ${a} vs ${b}`)
	})

	it('smoothing 0.8: one frame from silence reads 20 % of the magnitude', () => {
		const an = createFragcoordAnalyser()
		const r = an.rows(tone(64, 1))
		// 0.2 · 0.21 = 0.042 → −27.5 dB → 199.3
		assert.equal(r.raw[64], 199)
	})

	it('weighted cuts the lows by the A curve', () => {
		const an = createFragcoordAnalyser()
		const r = settle(an, tone(2, 1)) // 93.75 Hz
		const cut = r.raw[2] - r.weighted[2]
		const want = (-weightTable(SR, N)[2] / 80) * 255
		assert.ok(Math.abs(cut - want) <= 1, `cut ${cut} bytes, want ≈${want.toFixed(1)}`)
	})

	it('reset clears the smoothing state', () => {
		const an = createFragcoordAnalyser()
		settle(an, tone(64, 1))
		an.reset()
		assert.equal(an.rows(tone(64, 1)).raw[64], 199, 'as from silence again')
	})
})

describe('WO-999 wiring', () => {
	it('the capture engine adds fc rows to fresh and stale frames', () => {
		const s = src('src/audio/audio-capture-fft.js')
		assert.match(s, /require\('\.\/fft-fragcoord'\)/)
		assert.match(s, /fc: fc\.rows\(ring\),/)
		assert.match(s, /fc: \{ weighted: zero, raw: zero \},/)
		assert.match(s, /fc\.reset\(\)/)
	})

	it('the WS audio_fft frame carries them base64', () => {
		const s = src('src/bootstrap/audio-capture-lifecycle.js')
		assert.match(s, /fcWeighted: frame\.fc \? Buffer\.from\(frame\.fc\.weighted\)\.toString\('base64'\)/)
		assert.match(s, /fcRaw: frame\.fc \? Buffer\.from\(frame\.fc\.raw\)\.toString\('base64'\)/)
	})
})
