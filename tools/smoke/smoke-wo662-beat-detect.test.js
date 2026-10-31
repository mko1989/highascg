'use strict'

/**
 * WO-662 smoke — beat detection for shader audio reactivity.
 *
 * (a) detector on synthetic audio: kicks + 8th hi-hats at a known tempo → tempo within 1.5 %, one beat per kick
 *     once locked (hats ignored), a dropped kick bridged; noise / a held bass note → no beat stream; silence stops it.
 *     Real-music checks (click track vs backing track on the box) are in the WO-662 doc — media is not in the repo.
 * (b) bands: a low tone lights bass, a high tone lights high.
 * (c) wiring: the FFT engine feeds every sample to the detector and the WS frame carries beat + bands.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.join(__dirname, '../..')
const src = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')

const { createBeatDetector, bandsOf } = require('../../src/audio/beat-detect.js')
const { analyserFreqBytes } = require('../../src/audio/fft.js')

const SR = 48000

/** Deterministic PRNG so the noise floor is identical every run. */
function rng(seed) {
	let x = seed >>> 0
	return () => {
		x = (x * 1664525 + 1013904223) >>> 0
		return x / 2 ** 32 - 0.5
	}
}

/** `sec` seconds of noise + hats every 8th, with a 55 Hz kick (decaying, pitch-dropping) every 60/bpm s. */
function track({ bpm, sec, kicks = true, noise = 0.05 }) {
	const out = new Float32Array(Math.round(sec * SR))
	const r = rng(7)
	const period = (60 / bpm) * SR
	let n1 = 0
	for (let i = 0; i < out.length; i++) {
		let v = noise * r()
		const tHat = (i % (period / 2)) / SR
		const n0 = r()
		v += 0.3 * (n0 - n1) * Math.exp(-tHat * 60) // hats: differenced noise — bright, no low end
		n1 = n0
		if (kicks) {
			const tk = (i % period) / SR
			const f = 50 + 90 * Math.exp(-tk * 30)
			v += 0.8 * Math.sin(2 * Math.PI * f * tk) * Math.exp(-tk * 9)
		}
		out[i] = v
	}
	return out
}

/** Feed in 1024-sample chunks (the UDP tee's real chunking is uneven; the detector must not care). */
function feed(det, samples, chunk = 1024) {
	for (let i = 0; i < samples.length; i += chunk) det.push(samples.subarray(i, i + chunk))
}

describe('WO-662 (a): beat detector', () => {
	/** Beats counted between `from` and `to` seconds, plus the final snapshot. */
	function run(samples, from, to) {
		const det = createBeatDetector({ sampleRate: SR })
		feed(det, samples.subarray(0, from * SR), 997)
		const n0 = det.snapshot().n
		feed(det, samples.subarray(from * SR, to * SR), 997)
		return { det, beats: det.snapshot().n - n0, s: det.snapshot() }
	}

	for (const bpm of [96, 120, 128, 174]) {
		it(`kicks + 8th hats at ${bpm} BPM → locks the tempo, one beat per kick (hats ignored)`, () => {
			const { beats, s } = run(track({ bpm, sec: 14 }), 6, 14)
			// Above 160 BPM half time is a valid reading (drum'n'bass is felt at 87): the beats must then follow it.
			const heard = bpm > 160 && Math.abs(s.bpm - bpm / 2) / bpm < 0.01 ? bpm / 2 : bpm
			assert.ok(Math.abs(s.bpm - heard) / heard < 0.015, `bpm ${s.bpm} vs ${bpm}`)
			const kicks = (8 * heard) / 60
			assert.ok(Math.abs(beats - kicks) <= 1.5, `beats ${beats} vs kicks ${kicks}`)
			assert.ok(s.conf >= 0.3, `conf ${s.conf}`)
			assert.ok(s.phase >= 0 && s.phase < 1)
			assert.ok(s.age >= 0 && s.age < (60000 / heard) * 1.25, `age ${s.age}`)
		})
	}

	it('a dropped kick is bridged by the grid (flywheel)', () => {
		const x = track({ bpm: 120, sec: 14 })
		// silence every 4th kick after 6 s: zero the low end by muting 0.2 s around it
		for (let k = 13; k < 28; k += 4) x.fill(0, Math.round(k * 0.5 * SR), Math.round((k * 0.5 + 0.2) * SR))
		const { beats } = run(x, 6, 14)
		assert.ok(Math.abs(beats - 16) <= 1.5, `beats ${beats} vs 16`)
	})

	it('steady noise → no beats, no tempo', () => {
		const r = rng(5)
		const x = new Float32Array(8 * SR).map(() => 0.1 * r())
		const s = run(x, 0, 8).s
		assert.equal(s.n, 0)
		assert.equal(s.age, -1)
	})

	it('a held bass note is one onset, not a stream of beats', () => {
		const r = rng(3)
		const x = new Float32Array(6 * SR)
		for (let i = 0; i < x.length; i++) x[i] = 0.03 * r() + (i > 2 * SR ? 0.6 * Math.sin((2 * Math.PI * 60 * i) / SR) : 0)
		const s = run(x, 0, 6).s
		assert.ok(s.n <= 2, `beats ${s.n}`)
	})

	it('silence after music: level drops, the grid stops within 2 s', () => {
		const det = createBeatDetector({ sampleRate: SR })
		feed(det, track({ bpm: 120, sec: 8 }))
		feed(det, new Float32Array(3 * SR))
		const n = det.snapshot().n
		feed(det, new Float32Array(3 * SR))
		const s = det.snapshot()
		assert.equal(s.n, n)
		assert.equal(s.level, 0)
		assert.ok(s.age > 2500)
	})
})

describe('WO-662 (b): bands', () => {
	const toneBytes = (hz) => {
		const x = new Float32Array(1024)
		for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / SR)
		return analyserFreqBytes(x, new Float32Array(512), { smoothing: 0, minDb: -100, maxDb: -30 })
	}
	it('a 80 Hz tone is bass, a 9 kHz tone is high', () => {
		const lo = bandsOf(toneBytes(80))
		const hi = bandsOf(toneBytes(9000))
		assert.ok(lo[0] > lo[2] && lo[0] > 0.3, `lo ${lo}`)
		assert.ok(hi[2] > hi[0], `hi ${hi}`)
		for (const v of [...lo, ...hi]) assert.ok(v >= 0 && v <= 1)
	})
})

describe('WO-662 (c): wiring', () => {
	it('FFT engine feeds the detector per sample and frames carry beat + bands', () => {
		const eng = src('src/audio/audio-capture-fft.js')
		assert.match(eng, /require\('\.\/beat-detect'\)/)
		assert.match(eng, /function pushSamples\(f32\) \{\n\t\tbeat\.push\(f32\)/)
		assert.match(eng, /beat: tapTempo\.merge\(beat\.snapshot\(\), Date\.now\(\)\),\s*bands: bandsOf\(freq, cfg\.sampleRate\)/) // WO-879: through the tap merge
		const life = src('src/bootstrap/audio-capture-lifecycle.js')
		assert.match(life, /beat: frame\.beat,\n\t+bands: frame\.bands,/)
	})
})

describe('WO-662 (d): shader runtime + knobs', () => {
	it('ShaderToyLite declares and feeds iBeat / iAudioBands / iBeatFx (Image-pass fx only); vendor stays pristine', () => {
		const toy = src('template/shaders/ShaderToyLite.js')
		for (const u of ['iBeat', 'iAudioBands', 'iBeatFx']) {
			assert.match(toy, new RegExp(`uniform vec4\\s+${u};`))
			assert.match(toy, new RegExp(`gl\\.getUniformLocation\\(program, "${u}"\\)`))
		}
		assert.match(toy, /gl\.uniform4fv\(location\[key\]\["iBeatFx"\], key === "Image" \? beatU\.iBeatFx : noFx\)/)
		assert.match(toy, /this\.setBeat = \(beat, bands, fx\)/)
		assert.match(toy, /this\.addTime = \(sec\)/)
		assert.ok(!src('vendor/shadertoy/ShaderToyLite.js').includes('WO-662'))
	})

	it('player loads the beat companion, feeds it WS frames, draws it, and takes live { beat } updates', () => {
		const player = src('template/shaders/player.js')
		assert.match(player, /el\.src = 'player-beat\.js'/)
		assert.match(player, /if \(beatFeed\) beatFeed\.onFrame\(msg\.data\)/)
		assert.match(player, /if \(beatFeed\) beatFeed\.update\(\)/)
		assert.match(player, /if \(beatFeed\) beatFeed\.setFx\(data\.beat\)/)
		const beat = src('template/shaders/player-beat.js')
		assert.match(beat, /window\.__SHADERFX_BEAT__ = \{/)
		assert.match(beat, /toy\.setBeat\(/)
		assert.match(beat, /toy\.addTime\(fx\.kick/)
	})

	it('store keeps beat knobs clamped, drops them when all off', () => {
		const { normalizeShaderConfig } = require('../../src/shaderfx/shader-store.js')
		const base = { name: 'Beat test', passes: { image: { source: 'void mainImage(out vec4 c, in vec2 f){c=vec4(1);}' } } }
		const on = normalizeShaderConfig({ ...base, audio: { enabled: true, beat: { flash: 0.5, bump: 7, kick: -1 } } })
		assert.deepEqual(on.audio.beat, { flash: 0.5, bump: 1, kick: 0 })
		const off = normalizeShaderConfig({ ...base, audio: { enabled: true, beat: { flash: 0, bump: 0, kick: 0 } } })
		assert.equal('beat' in off.audio, false)
	})

	it('save pushes the knobs to shaders on air; both UIs edit them', () => {
		const routes = src('src/api/routes-shaders.js')
		assert.match(routes, /const live = await pushBeatKnobs\(ctx, config\)/)
		assert.match(routes, /pushPayload\(ctx, targets, \{ beat \}\)/)
		const modal = src('client/components/shader-fx-modal.js')
		for (const k of ['flash', 'bump', 'kick']) assert.match(modal, new RegExp(`data-beat="${k}"`))
	})
})
