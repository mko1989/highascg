'use strict'

/**
 * WO-866 smoke — drum detection against real music: capture tool, MDB Drums scorer, the retuned detector, per-drum
 * sensitivity and the server test-music source.
 *
 * (a) eval-drum-detector.js matching: one-to-one within ±tol, greedy nearest, offsets signed (est − ref).
 * (b) audio-parts.js defaults are the WO-866 tuning; `tune` overrides per drum; sensitivity moves the threshold (a busier
 *     kit at 1 than at 0). Synthetic voices trip any flux detector (a sung syllable is an onset), so the real-music
 *     evidence is the MDB Drums score, not a unit test.
 * (c) capture: WAV header; replayHits on a 120 bpm kick counts each kick once.
 * (d) routes: sensitivity clamps / stores in audioCapture / applies live; test-music refuses ".." and runs only with an
 *     engine; all four routes are registered in router.js.
 * MDB Drums scores (the dataset is CC BY-NC-SA, never in the repo) are in the WO-866 doc.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.join(__dirname, '../..')
const src = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
const { createAudioParts } = require('../../src/audio/audio-parts.js')
const { match } = require('../../tools/audio/eval-drum-detector.js')
const { replayHits, wavOf, handleSensitivity, handleTestMusic } = require('../../src/api/routes-audio-parts-capture.js')

const SR = 48000

/** Kicks every `period` s (pitch-dropping sine) with soft noise under it; `amps` cycles the kick levels (ghost notes). */
function kicks(sec, period = 0.5, noise = 0.02, amps = [1]) {
	const x = new Float32Array(sec * SR)
	let s = 99
	for (let i = 0; i < x.length; i++) {
		const t = i / SR
		const kb = t % period
		s = (s * 1103515245 + 12345) >>> 0
		x[i] =
			amps[Math.floor(t / period) % amps.length] *
				Math.sin(2 * Math.PI * (55 * kb + 2 * (1 - Math.exp(-kb * 30)))) *
				Math.exp(-kb * 12) *
				0.8 +
			(s / 2 ** 32 - 0.5) * noise
	}
	return x
}

describe('WO-866 (a) scorer', () => {
	it('matches one-to-one within tolerance', () => {
		const m = match([100, 600, 1100], [130, 140, 590, 2000], 50)
		assert.equal(m.tp, 2)
		assert.equal(m.fp, 2)
		assert.equal(m.fn, 1)
		assert.deepEqual(m.offsets, [30, -10])
	})
})

describe('WO-866 (b) detector tuning', () => {
	it('ships the measured tuning and per-drum overrides merge over it', () => {
		const s = src('src/audio/audio-parts.js')
		assert.match(s, /perc: \['kick', 'snare'\]/)
		assert.match(s, /kick: \{ k: 3, ratio: 2 \}/)
		assert.match(s, /snare: \{ k: 3\.5, ratio: 1\.5 \}/)
		assert.match(s, /hats: \{ k: 1\.2, ratio: 3 \}/)
		assert.match(s, /kick: \{ \.\.\.TUNE\.kick, \.\.\.tIn\.kick \}/)
	})

	const count = (x, sens) => {
		const p = createAudioParts({ sampleRate: SR })
		p.sensitivity({ kick: sens })
		for (let i = 0; i + 960 <= x.length; i += 960) p.push(x.subarray(i, i + 960))
		return p.snapshot().kick.n
	}

	it('counts each kick once', () => {
		const n = count(kicks(6), 0.5)
		assert.ok(n >= 10 && n <= 12, `12 kicks in 6 s (the first second warms up), got ${n}`)
	})

	it('sensitivity: 0 drops hits, 1 takes ghost notes 18 dB down (threshold and near-peak range both move)', () => {
		const x = kicks(8, 0.25, 0, [1, 0.12])
		const [lo, mid, hi] = [0, 0.5, 1].map((s) => count(x, s))
		assert.ok(lo < mid && mid < hi, `0 / 0.5 / 1 → ${lo} / ${mid} / ${hi}`)
		assert.ok(mid >= 14 && mid <= 16, `0.5 takes the 16 loud kicks only, got ${mid}`)
	})
})

describe('WO-866 (c) capture', () => {
	it('writes a 16-bit mono WAV', () => {
		const b = wavOf(new Float32Array([0, 1, -1]), SR)
		assert.equal(b.toString('ascii', 0, 4), 'RIFF')
		assert.equal(b.readUInt32LE(24), SR)
		assert.equal(b.readUInt16LE(34), 16)
		assert.equal(b.readInt16LE(46), 32767)
		assert.equal(b.length, 44 + 6)
	})

	it('replays hits with decision times', () => {
		const h = replayHits(kicks(4), SR)
		assert.ok(h.kick.length >= 6 && h.kick.length <= 8, `kicks: ${h.kick}`)
		for (const t of h.kick) assert.ok(t % 500 < 80, `decided within 80 ms of the kick, got ${t}`)
	})
})

describe('WO-866 (d) routes', () => {
	it('sensitivity clamps, stores and applies', () => {
		let saved = null
		let applied = null
		const ctx = {
			config: { audioCapture: { enabled: true } },
			configManager: { get: () => ({ other: 1 }), save: (c) => (saved = c) },
			audioPartsSensitivity: (m) => (applied = m),
		}
		const r = handleSensitivity(ctx, { kick: 2, snare: '0.25', hats: 'x' })
		const body = JSON.parse(r.body)
		assert.deepEqual(body.sensitivity, { kick: 1, snare: 0.25, hats: 0.5 })
		assert.deepEqual(saved.audioCapture, { enabled: true, partsSensitivity: { kick: 1, snare: 0.25, hats: 0.5 } })
		assert.equal(saved.other, 1)
		assert.deepEqual(applied, body.sensitivity)
		assert.deepEqual(JSON.parse(handleSensitivity(ctx, null).body).sensitivity, body.sensitivity)
	})

	it('test music needs an engine and a media file inside the root', () => {
		assert.equal(handleTestMusic({}, { file: 'a.mp3' }).status, 503)
		const ctx = { config: {}, audioTestMusic: () => ({ file: 'x' }) }
		assert.equal(handleTestMusic(ctx, { file: '../etc/passwd' }).status, 404)
		assert.equal(handleTestMusic(ctx, { stop: true }).status, 200)
	})

	it('routes are registered and the engine honours them', () => {
		const r = src('src/api/router.js')
		for (const p of [
			"post('/api/audio/parts-capture'",
			"post('/api/audio/test-music'",
			"get('/api/audio/parts-sensitivity'",
			"post('/api/audio/parts-sensitivity'",
		]) {
			assert.ok(r.includes('routes.' + p), p)
		}
		const e = src('src/audio/audio-capture-fft.js')
		assert.match(e, /parts\.sensitivity\(cfg\.partsSensitivity\)/)
		assert.match(e, /if \(test\) return/)
	})
})
