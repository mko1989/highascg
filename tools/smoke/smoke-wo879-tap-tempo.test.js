'use strict'

/**
 * WO-879 — tap tempo (src/audio/beat-tap.js): taps set the tempo and take over the beat, one later tap re-phases it,
 * auto gives the detector back, and the frame's beat count never jumps or doubles across any of it; the FFT engine
 * keeps a tapped beat going on silent frames; POST /api/audio/tap.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createTapTempo } = require('../../src/audio/beat-tap')

const ROOT = path.join(__dirname, '..', '..')
const det = (n, extra = {}) => ({ n, age: 300, bpm: 0, conf: 0.1, phase: 0.5, level: 0.7, locked: false, ...extra })

/** Frames every 1000/30 ms from `from` to `to`; the beats (n changes) each emitted, with their times. */
function run(tt, from, to, detN = () => 4) {
	const beats = []
	let prev = null
	let out = null
	for (let t = from; t < to; t += 1000 / 30) {
		out = tt.merge(det(detN(t)), t)
		if (prev != null && out.n !== prev) beats.push({ t, d: out.n - prev, age: out.age })
		prev = out.n
	}
	return { beats, out }
}

test('taps set the tempo, the beat follows them, n counts on', () => {
	const tt = createTapTempo()
	assert.equal(tt.merge(det(4), 0).n, 4, 'untapped: the detector, n as it is')
	assert.equal(tt.tap(1000).tap, false, 'one tap: no tempo yet')
	assert.equal(tt.merge(det(4), 1001).tap, undefined)
	const st = tt.tap(1500)
	assert.deepEqual(st, { tap: true, bpm: 120, taps: 2 }, 'two taps 500 ms apart → 120 BPM')
	const first = tt.merge(det(4), 1510)
	assert.deepEqual([first.n, first.locked, first.tap, first.bpm, first.level], [5, true, true, 120, 0.7], 'the second tap is a beat')
	const { beats, out } = run(tt, 1543, 5010)
	assert.deepEqual(beats.map((b) => b.d), [1, 1, 1, 1, 1, 1, 1], 'one beat per 500 ms, never two at once')
	for (const b of beats) assert.ok(b.age < 34, 'each beat lands within a frame of the grid')
	assert.equal(out.n, 12)
	const m = createTapTempo()
	for (const t of [0, 500, 1010, 1490]) m.tap(t)
	assert.equal(m.state().bpm, 120.8, 'the mean interval of the taps (1490 ms / 3)')
})

test('a single later tap re-phases without a double beat; a bounce is ignored; auto goes back', () => {
	const tt = createTapTempo()
	tt.tap(0)
	tt.tap(500)
	let r = run(tt, 0, 3020)
	const n0 = r.out.n
	assert.equal(r.beats.length, 6, 'the tap at 500, then 1000 … 3000')
	// > 2 s after the last tap one tap re-phases. Late (30 ms after the 3000 grid beat): that beat, no extra.
	assert.equal(tt.tap(3030).bpm, 120, 'one tap keeps the tempo')
	assert.equal(tt.merge(det(4), 3031).n, n0, 'a tap just after a grid beat is that beat')
	r = run(tt, 3031, 3600)
	assert.deepEqual([r.beats.length, Math.round(r.beats[0].t)], [1, 3531], 'the grid runs from the tap')
	// off the grid (half a beat): a beat on the tap, then every 500 ms from it
	const before = run(tt, 3600, 5270).out.n
	tt.tap(5280)
	const on = tt.merge(det(4), 5281)
	assert.deepEqual([on.n, on.age], [before + 1, 1], 'the beat is on the tap')
	r = run(tt, 5281, 6300)
	assert.deepEqual(r.beats.map((x) => [Math.abs(x.t - 5780) < 34 || Math.abs(x.t - 6280) < 34, x.d]), [[true, 1], [true, 1]], 'then 5780, 6280')
	assert.deepEqual(tt.tap(5320), { tap: true, bpm: 120, taps: 1 }, 'a bounce (< 125 ms after a tap) is not a tap')
	tt.auto()
	assert.equal(tt.state().tap, false)
	const back = tt.merge(det(50), 4000)
	assert.equal(back.tap, undefined, 'the detector again')
	const n1 = back.n
	assert.equal(tt.merge(det(51), 4100).n, n1 + 1, 'its beats count on from where the tapped ones stopped')
	assert.equal(tt.merge(det(51), 4133).n, n1 + 1)
})

test('a gap of more than 2 s starts a new tempo; limits', () => {
	const tt = createTapTempo()
	tt.tap(0)
	tt.tap(400)
	assert.equal(tt.state().bpm, 150)
	tt.tap(5000) // re-phase only (one tap after a gap)
	assert.equal(tt.state().bpm, 150)
	tt.tap(5250)
	assert.equal(tt.state().bpm, 240, 'two fast taps → the 240 BPM limit')
	const slow = createTapTempo()
	slow.tap(0)
	slow.tap(1900)
	assert.equal(slow.state().bpm, 40, 'slow → 40 BPM')
})

test('the engine, route and Godot client carry it', () => {
	const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
	const eng = src('src/audio/audio-capture-fft.js')
	assert.equal((eng.match(/beat: tapTempo\.merge\(beat\.snapshot\(\), Date\.now\(\)\)/g) || []).length, 2, 'both frame paths')
	assert.match(eng, /if \(staleFrameSent && !tapTempo\.state\(\)\.tap\) return/)
	assert.match(src('src/api/router.js'), /routes\.post\('\/api\/audio\/tap', \(\{ body, ctx \}\) => routesAudioParts\.handleTap\(ctx, parseBody\(body\)\)/)
	assert.match(src('src/bootstrap/audio-capture-lifecycle.js'), /appCtx\.audioTap = \(b\) => \(engine \? engine\.tap\(b\) : null\)/)
	const R = require('../../src/api/routes-audio-parts-capture')
	assert.equal(R.handleTap({}, {}).status, 503, 'no capture → 503')
	const got = []
	const res = R.handleTap({ audioTap: (b) => (got.push(b), { tap: false, bpm: 0, taps: 1 }) }, null)
	assert.equal(res.status, 200)
	assert.deepEqual(JSON.parse(res.body), { ok: true, tap: false, bpm: 0, taps: 1 })
	assert.deepEqual(got, [{}])
	assert.match(src('godot/client/features/visuals/visuals_show_ctl.gd'), /api\.post_json\("\/api\/audio\/tap", \{"auto": true\} if auto else \{\}\)/)
})

test('engine: a tapped beat keeps coming on silent frames', async () => {
	const { createAudioCaptureFft, normalizeAudioCaptureConfig } = require('../../src/audio/audio-capture-fft')
	const frames = []
	const config = { ...normalizeAudioCaptureConfig({ audioCapture: { emitHz: 60 } }), source: 'slot', udpPort: 40000 + Math.floor(Math.random() * 20000) }
	const eng = createAudioCaptureFft({ config, onFrame: (f) => frames.push(f), log: () => {} })
	eng.start()
	try {
		eng.tap({})
		await new Promise((r) => setTimeout(r, 300))
		eng.tap({})
		await new Promise((r) => setTimeout(r, 400))
		const tapped = frames.filter((f) => f.beat?.tap)
		assert.ok(tapped.length > 5, `silent frames carry the tapped beat (${tapped.length})`)
		assert.ok(tapped.every((f) => f.rms === 0 && f.beat.locked))
		eng.tap({ auto: true })
		const n = frames.length
		await new Promise((r) => setTimeout(r, 150))
		assert.ok(frames.length - n <= 1, 'auto: the silent frames stop again')
	} finally {
		eng.stop()
	}
})
