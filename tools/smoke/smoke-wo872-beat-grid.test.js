'use strict'

/**
 * WO-872 — the rebuilt beat tracker (src/audio/beat-detect.js → beat-onset / beat-tempo / beat-grid, after fosfora).
 * GTZAN scores live in the WO (holdout F .387 → .608); these pin the behaviours the score does not show:
 *  - beats fire on the predicted grid, so a breakdown (no kick) mutes the grid without losing its phase and the
 *    returning kicks land on the old grid — no re-acquisition, no half-beat jump;
 *  - the published phase runs on through the breakdown (Godot's visuals_sync.gd extrapolates from it);
 *  - the lock is reported, and the tempo holds through a breakdown;
 *  - the WO-662 API is unchanged (smoke-wo662-beat-detect.test.js still passes on the new inside).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createBeatDetector } = require('../../src/audio/beat-detect.js')

const SR = 48000

function rng(seed) {
	let x = seed >>> 0
	return () => {
		x = (x * 1664525 + 1013904223) >>> 0
		return x / 2 ** 32 - 0.5
	}
}

/** Kick every beat and 8th hats, both silent inside `gap` (a breakdown: only the noise pad is left). */
function track({ bpm, sec, gap = null }) {
	const out = new Float32Array(Math.round(sec * SR))
	const r = rng(11)
	const period = (60 / bpm) * SR
	let n1 = 0
	for (let i = 0; i < out.length; i++) {
		let v = 0.05 * r()
		const n0 = r()
		const s = i / SR
		const drums = !gap || s < gap[0] || s >= gap[1]
		if (drums) v += 0.2 * (n0 - n1) * Math.exp(-((i % (period / 2)) / SR) * 60)
		n1 = n0
		if (drums) {
			const tk = (i % period) / SR
			v += 0.8 * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-tk * 30)) * tk) * Math.exp(-tk * 9)
		}
		out[i] = v
	}
	return out
}

/** Push in 512-sample hops; collect announced beat times (s) and snapshots at given times. */
function run(samples, at = []) {
	const d = createBeatDetector({ sampleRate: SR })
	const beats = []
	const snaps = {}
	let n = 0
	for (let i = 0; i + 512 <= samples.length; i += 512) {
		d.push(samples.subarray(i, i + 512))
		const s = d.snapshot()
		if (s.n !== n) {
			n = s.n
			beats.push((d.nowMs() - s.age) / 1000)
		}
		for (const t of at) if (!snaps[t] && d.nowMs() / 1000 >= t) snaps[t] = s
	}
	return { beats, snaps }
}

/** Distance of t from the nearest kick of a grid with this period (s), as a share of the period. */
const offGrid = (t, per) => {
	const f = (t / per) % 1
	return Math.min(f, 1 - f)
}

describe('WO-872: beat grid', () => {
	it('locks within 6 s at 120 BPM and fires on the kicks', () => {
		const { beats, snaps } = run(track({ bpm: 120, sec: 12 }), [6, 11.9])
		assert.equal(snaps[6].locked, true, JSON.stringify(snaps[6]))
		assert.ok(Math.abs(snaps[11.9].bpm - 120) < 1.5, `bpm ${snaps[11.9].bpm}`)
		const late = beats.filter((t) => t >= 6)
		assert.ok(late.length >= 11 && late.length <= 13, `beats ${late.length}`)
		for (const t of late) assert.ok(offGrid(t, 0.5) < 0.06, `beat at ${t.toFixed(3)} is off the kick grid`)
	})

	it('a 4 s breakdown mutes the grid, keeps its phase, and the kicks come back on the same grid', () => {
		const { beats, snaps } = run(track({ bpm: 120, sec: 20, gap: [9, 13] }), [12.5, 19.9])
		const inGap = beats.filter((t) => t >= 10.5 && t < 13)
		assert.ok(inGap.length <= 2, `beats inside the breakdown: ${inGap.map((t) => t.toFixed(2))}`)
		assert.ok(Math.abs(snaps[12.5].bpm - 120) < 1.5, `tempo held through the breakdown: ${snaps[12.5].bpm}`)
		// the published phase kept running on the kick grid through the breakdown
		const ph = snaps[12.5].phase
		const expect = (12.5 / 0.5) % 1
		assert.ok(Math.min(Math.abs(ph - expect), 1 - Math.abs(ph - expect)) < 0.1, `phase ${ph} vs ${expect}`)
		const back = beats.filter((t) => t >= 14.5)
		assert.ok(back.length >= 9, `beats after the drop: ${back.length}`)
		for (const t of back) assert.ok(offGrid(t, 0.5) < 0.06, `beat at ${t.toFixed(3)} is off the old grid`)
		assert.equal(snaps[19.9].locked, true)
	})

	it('the tracker is split into three stages, each after the fosfora stage it ports', () => {
		const dir = path.join(__dirname, '../../src/audio')
		const det = fs.readFileSync(path.join(dir, 'beat-detect.js'), 'utf8')
		for (const m of ['beat-onset', 'beat-tempo', 'beat-grid']) {
			assert.match(det, new RegExp(`require\\('\\./${m}'\\)`))
			assert.match(fs.readFileSync(path.join(dir, m + '.js'), 'utf8'), /fosfora/)
		}
	})

	it('test music reaches the detectors at wall-clock rate (ffmpeg -re ran up to 0.57 s ahead)', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/audio/audio-capture-fft.js'), 'utf8')
		assert.match(src, /t\.pace = pacePcm\(cfg\.sampleRate, /)
		assert.match(src, /if \(test === t\) t\.pace\.write\(chunk\)/)
	})
})
