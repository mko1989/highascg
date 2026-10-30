'use strict'

/**
 * WO-875 smoke — GLava-style spectrum smoothing for every renderer of the shader audio texture.
 *
 * (a) template/shaders/player-smooth.js: off = the raw spectrum; gravity (instant rise, `fall` bytes/s drop, dt clamped);
 *     spread (bass bins untouched, upper bins box-averaged); the windowed frame average; a parity golden that
 *     godot/client/tests/test_spectrum_smooth.gd pins to the same numbers (the Godot Visuals run the GDScript twin).
 * (b) wiring: config audioCapture.spectrum → `smooth` in each WS audio_fft frame → player.js smooths per rendered frame
 *     (never in thumbnail renders) and loads the companion like player-beat.js.
 * Measured on real tracks (jitter, frozen frames, lag) in the WO-875 doc — the media is not in the repo.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.join(__dirname, '../..')
const src = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
const S = require(path.join(REPO, 'template/shaders/player-smooth.js'))

const OFF = { fall: 0, frames: 1, spread: 0 }
const frame = (v) => new Uint8Array(512).fill(v)

/** The parity input: frame f, bin k (the GDScript test builds the same bytes). */
function parityFrame(f) {
	const a = new Uint8Array(512)
	for (let k = 0; k < 512; k++) a[k] = (k * 37 + f * 101 + ((k * k) % 23) * 5) % 256
	return a
}

describe('WO-875 spectrum smoothing', () => {
	it('off is the raw spectrum', () => {
		const sm = S.create(512)
		for (let f = 0; f < 5; f++) {
			const raw = parityFrame(f)
			assert.deepEqual(Array.from(sm.step(raw, 1 / 60, OFF)), Array.from(raw))
		}
	})

	it('gravity: rises at once, falls at most `fall` per second, dt clamped to 0.1 s', () => {
		const sm = S.create(512)
		const p = { fall: 200, frames: 1, spread: 0 }
		assert.equal(sm.step(frame(200), 0.1, p)[10], 200)
		assert.equal(sm.step(frame(0), 0.1, p)[10], 180)
		assert.equal(sm.step(frame(0), 5, p)[10], 160, 'a stall counts as 0.1 s, not a drop to zero')
		assert.equal(sm.step(frame(250), 0.1, p)[10], 250, 'a new peak lands immediately')
		assert.equal(sm.step(frame(0), 0.05, { ...p, fall: 0 })[10], 0, 'fall 0 = no gravity')
	})

	it('spread: bass bins untouched, upper bins averaged over ±floor(k·spread)', () => {
		const sm = S.create(512)
		const raw = new Uint8Array(512)
		raw[40] = 255
		raw[300] = 130
		const out = sm.step(raw, 0, { fall: 0, frames: 1, spread: 0.02 })
		assert.equal(out[40], 255, 'k·spread < 1: no averaging')
		assert.equal(out[41], 0)
		assert.equal(out[300], 10, 'r = 6: 130 / 13')
		assert.equal(out[306], 10, 'the neighbour sees it too')
		assert.equal(out[310], 0)
	})

	it('frames: a GLava window over the last n gravity outputs', () => {
		assert.deepEqual([0, 1, 2].map((a) => S.weight(a, 3).toFixed(2)), ['0.40', '1.00', '0.40'])
		assert.equal(S.weight(0, 2), 1)
		const sm = S.create(512)
		const p = { fall: 0, frames: 3, spread: 0 }
		for (let i = 0; i < 3; i++) sm.step(frame(0), 1 / 60, p)
		assert.deepEqual([1, 2, 3].map(() => sm.step(frame(100), 1 / 60, p)[5]), [22, 78, 100], 'a step: 0.4·100/1.8, 1.4·100/1.8, 100')
	})

	it('params clamp like the node config', () => {
		assert.deepEqual(S.params(null), S.DEFAULTS)
		assert.deepEqual(S.params({ fall: -5, frames: 99, spread: 1 }), { fall: 0, frames: 8, spread: 0.25 })
		const { normalizeAudioCaptureConfig: norm } = require('../../src/audio/audio-capture-fft')
		assert.deepEqual(norm({}).spectrum, S.DEFAULTS)
		assert.deepEqual(norm({ audioCapture: { spectrum: false } }).spectrum, OFF)
		assert.deepEqual(norm({ audioCapture: { spectrum: { fall: 120 } } }).spectrum, { ...S.DEFAULTS, fall: 120 })
		const junk = { fall: -5, frames: 99, spread: 1 }
		assert.deepEqual(norm({ audioCapture: { spectrum: junk } }).spectrum, S.params(junk), 'the node mirrors the companion')
	})

	it('parity golden (test_spectrum_smooth.gd pins the same numbers)', () => {
		const sm = S.create(512)
		let out
		for (let f = 0; f < 8; f++) out = sm.step(parityFrame(f), 1 / 60, S.DEFAULTS)
		assert.deepEqual([0, 7, 49, 50, 200, 333, 511].map((k) => out[k]), [246, 209, 207, 195, 130, 142, 169])
	})

	it('wiring: node sends `smooth`, player.js smooths per frame (not thumbnails) via the companion', () => {
		assert.match(src('src/bootstrap/audio-capture-lifecycle.js'), /smooth: cfg\.spectrum,/)
		const player = src('template/shaders/player.js')
		assert.match(player, /el\.src = 'player-smooth\.js'/)
		assert.match(player, /smoother && !THUMB_MODE \? smoother\.frame\(freqBytes, smoothCfg\) : freqBytes/)
		assert.match(player, /gl\.texSubImage2D\(gl\.TEXTURE_2D, 0, 0, 0, AUDIO_W, 1, gl\.RED, gl\.UNSIGNED_BYTE, freq\)/)
		assert.match(player, /smoothCfg = msg\.data\.smooth/)
		assert.match(player, /if \(!THUMB_MODE\) initSmooth\(\)/)
		assert.match(src('template/shaders/player-smooth.js'), /else window\.__SHADERFX_SMOOTH__ = api/)
	})
})
