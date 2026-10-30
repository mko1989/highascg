'use strict'

/**
 * WO-861 smoke — real-time audio parts (named buses) from the live input.
 *
 * (a) drums on a synthetic 120 bpm kit (kick on beats, snare on 2 and 4, closed hats on 8ths): each drum counted once
 *     per hit, mixed and alone — a kick's click is no snare, a snare's body no kick, a hat no snare.
 * (b) steady tones: no drum hits, no onset; a chord lights tonal, a drum kit does not; a 60 Hz tone lights bass only.
 * (c) sections: quiet then a ramp → build then peak; steady loud → normal; quiet → loud → one drop; a sparse break
 *     → at most one drop; loud → silence → quiet, loudness 0.
 * (d) audio-mood.js port (CanYuzbey, MIT): arousal/valence/density formulas on fixed inputs.
 * (e) wiring: the FFT engine feeds and resets the parts; the WS frame and THIRD_PARTY_NOTICES carry them.
 *     Real-music checks (Run the Jewels track, live UDP feed on the box) are in the WO-861 doc — media is not in the repo.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.join(__dirname, '../..')
const src = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')

const { createAudioParts } = require('../../src/audio/audio-parts.js')
const { createMood, createDensity } = require('../../src/audio/audio-mood.js')

const SR = 48000

/** `sec` seconds of a 120 bpm kit; `parts` scales each drum (0 = off). */
function kit(sec, parts = { kick: 1, snare: 1, hats: 1 }) {
	let s = 2463534242
	const rnd = () => {
		s ^= s << 13
		s >>>= 0
		s ^= s >>> 17
		s ^= s << 5
		s >>>= 0
		return s / 2147483648 - 1
	}
	const x = new Float32Array(sec * SR)
	let hp1 = 0
	let hp2 = 0
	let hp3 = 0
	let lp = 0
	for (let i = 0; i < x.length; i++) {
		const t = i / SR
		const n = rnd()
		let v = 0
		const kb = t % 0.5 // pitch-dropping sine
		if (parts.kick)
			v += Math.sin(2 * Math.PI * (55 * kb + 2 * (1 - Math.exp(-kb * 30)))) * Math.exp(-kb * 12) * 0.8 * parts.kick
		const sb = (t + 0.5) % 1 // low-passed noise + 190 Hz body
		lp += 0.5 * (n - lp)
		if (parts.snare) v += (lp * 0.6 + Math.sin(2 * Math.PI * 190 * sb) * 0.4) * Math.exp(-sb * 25) * 0.5 * parts.snare
		const hb = t % 0.25 // 3rd-difference (high-passed) noise
		const d1 = n - hp1
		hp1 = n
		const d2 = d1 - hp2
		hp2 = d1
		const d3 = d2 - hp3
		hp3 = d2
		if (parts.hats) v += (d3 / 8) * Math.exp(-hb * 120) * 0.25 * parts.hats
		x[i] = v
	}
	return x
}

const tones = (sec, ...hzAmp) => {
	const x = new Float32Array(sec * SR)
	for (let i = 0; i < x.length; i++) for (const [hz, a] of hzAmp) x[i] += a * Math.sin((2 * Math.PI * hz * i) / SR)
	return x
}

/** Feed in 20 ms chunks (the UDP tee's size); returns the parts and every section seen. */
function run(x, p = createAudioParts()) {
	const sections = new Set()
	for (let i = 0; i < x.length; i += 960) {
		p.push(x.subarray(i, i + 960))
		sections.add(p.snapshot().section)
	}
	return { p, s: p.snapshot(), sections }
}

const hitsOf = (s) => [s.kick.n, s.snare.n, s.hats.n]

describe('WO-861 (a) drum hits', () => {
	it('mixed kit: 5 s at 120 bpm → 9 kicks (first one warms up), 5 snares, 18 hats', () => {
		assert.deepEqual(hitsOf(run(kit(5)).s), [9, 5, 18])
	})
	it('kick alone → no snare (its click sits ~44 dB under it in the snare band)', () => {
		const [k, sn, h] = hitsOf(run(kit(5, { kick: 1 })).s)
		assert.equal(k, 9)
		assert.equal(sn, 0)
		assert.ok(h <= 1, `hats ${h}`)
	})
	it('snare alone → no kick; hats alone → no kick, no snare', () => {
		const [k, sn] = hitsOf(run(kit(5, { snare: 1 })).s)
		assert.equal(k, 0)
		assert.equal(sn, 5)
		assert.deepEqual(hitsOf(run(kit(5, { hats: 1 })).s), [0, 0, 18])
	})
	it('a hit pulses onset 1 → 0 over 150 ms; n only counts up', () => {
		const p = createAudioParts()
		const x = kit(2, { kick: 1 })
		let peak = 0
		let last = 0
		for (let i = 0; i < x.length; i += 480) {
			p.push(x.subarray(i, i + 480))
			const k = p.snapshot().kick
			peak = Math.max(peak, k.onset)
			assert.ok(k.n >= last)
			last = k.n
		}
		assert.ok(peak > 0.85, `peak ${peak}`)
	})
})

describe('WO-861 (b) tones and levels', () => {
	it('a held chord: no hits, no onset, tonal lit; the kit leaves tonal near 0', () => {
		const { s } = run(tones(5, [220, 0.3], [440, 0.2], [660, 0.1]))
		assert.deepEqual(hitsOf(s), [0, 0, 0])
		assert.equal(s.onset, 0)
		assert.ok(s.tonal > 0.5, `tonal ${s.tonal}`)
		assert.ok(run(kit(5)).s.tonal < 0.2)
	})
	it('a 60 Hz tone lights bass, not high', () => {
		const { s } = run(tones(3, [60, 0.5]))
		assert.ok(s.bass > 0.9 && s.high === 0, JSON.stringify(s))
	})
})

describe('WO-861 (c) sections', () => {
	const scaled = (x, f) => x.map((v, i) => v * f(i / SR))
	it('12 s quiet, then a 20 s volume ramp → build, then peak; no drop', () => {
		const { s, sections } = run(scaled(kit(32), (t) => (t < 12 ? 0.03 : 0.03 + (0.8 * (t - 12)) / 20)))
		assert.ok(sections.has('build'), [...sections].join())
		assert.equal(s.section, 'peak')
		assert.equal(s.drop.n, 0)
	})
	it('a steadily loud kit is normal, not peak (the range of the last 2 min decides)', () => {
		const { s, sections } = run(kit(20))
		assert.equal(s.section, 'normal')
		assert.ok(!sections.has('peak'), [...sections].join())
		assert.ok(s.energy > 0.8)
	})
	it('quiet for 6 s, then full level → one drop', () => {
		const { s } = run(scaled(kit(10), (t) => (t < 6 ? 0.03 : 1)))
		assert.equal(s.drop.n, 1)
		assert.ok(s.drop.age > 3000 && s.drop.age < 4500, `age ${s.drop.age}`)
	})
	it('a sparse break (one kick every 1.5 s after a loud kit) fires at most one drop — box 30.10 fired 10 in 15 s', () => {
		const x = kit(30)
		for (let i = 12 * SR; i < 26 * SR; i++) if (((i - 12 * SR) / SR) % 1.5 > 0.4) x[i] = 0
		const { s } = run(x)
		assert.ok(s.drop.n <= 1, `drops ${s.drop.n}`)
	})
	it('loud, then 10 s of silence → loudness 0, quiet; reset() keeps the counters', () => {
		const x = new Float32Array(16 * SR)
		x.set(kit(6))
		const { p, s } = run(x)
		assert.equal(s.loudness, 0)
		assert.equal(s.section, 'quiet')
		p.reset()
		const after = p.snapshot()
		assert.equal(after.kick.n, s.kick.n)
		const mid = createAudioParts()
		mid.push(kit(2).subarray(0, Math.round(1.56 * SR))) // just after the kick + snare at 1.5 s
		assert.ok(mid.snapshot().kick.onset > 0.5)
		mid.reset()
		assert.equal(mid.snapshot().kick.onset + mid.snapshot().snare.onset, 0) // no pulse frozen on the stale frame
		assert.equal(after.energy, 0)
	})
})

describe('WO-861 (d) CanYuzbey mood port', () => {
	it('arousal → 0.5·loudness + 0.4·density + 0.1·onset; mid/high dominance → valence above 0.5', () => {
		const m = createMood()
		let r
		for (let i = 0; i < 300; i++) r = m.step({ loudness: 0.8, onset: 0, density: 0.5, low: 0.2, mid: 0.4, high: 0.4 })
		assert.ok(Math.abs(r.arousal - 0.6) < 0.01, `arousal ${r.arousal}`)
		const v = createMood()
		for (let i = 0; i < 300; i++) r = v.step({ loudness: 0.8, onset: 0, density: 0.5, low: 0.05, mid: 0.5, high: 0.45 })
		assert.ok(r.valence > 0.5, `valence ${r.valence}`)
	})
	it('density: onsets every 0.25 s → 1 − (0.25 − 0.1)/0.9; a break lowers it', () => {
		const d = createDensity()
		for (let i = 0; i <= 20; i++) d.onset(i * 0.25)
		assert.ok(Math.abs(d.value(5) - (1 - 0.15 / 0.9)) < 1e-9)
		assert.ok(d.value(9) < d.value(5.2))
	})
})

describe('WO-861 (e) wiring', () => {
	it('the FFT engine pushes every sample, resets on a stale feed and puts parts in each frame', () => {
		const e = src('src/audio/audio-capture-fft.js')
		assert.match(e, /require\('\.\/audio-parts'\)/)
		assert.match(e, /beat\.push\(f32\)\n\t\tparts\.push\(f32\)/)
		assert.match(e, /beat\.reset\(\)\n\t\t\tparts\.reset\(\)/)
		assert.equal((e.match(/parts: parts\.snapshot\(\)/g) || []).length, 2)
	})
	it('the WS audio_fft broadcast carries parts; the MIT notice names the ported files', () => {
		assert.match(src('src/bootstrap/audio-capture-lifecycle.js'), /parts: frame\.parts,/)
		const n = src('THIRD_PARTY_NOTICES')
		assert.match(n, /CanYuzbey\/music-reactive-lighting/)
		assert.match(n, /68880191d8c232e92ec7e3a80bbe39941709d749/)
		assert.match(n, /src\/audio\/audio-mood\.js/)
	})
})
