'use strict'

/**
 * WO-333 smoke — line-in / USB audio capture → FFT frames → WS → shader texture.
 *
 * (a) DSP correctness: FFT peak lands on the driven bin, AnalyserNode byte mapping (silence → 0,
 *     full-scale tone → hot byte at its bin), S16_LE decode + stereo downmix + gain, waveform
 *     centering. (b) device resolution from `arecord -l` (USB survives re-enumeration via
 *     substring). (c) config normalize defaults + modular/replication classification.
 *     (d) wiring: index lifecycle start, shutdown hook, WS broadcast type, player.js consumes
 *     audio_fft and only falls back to OSC synthesis when frames go stale.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.join(__dirname, '../..')
const src = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')

const { fftRadix2, pcmS16leToMonoFloats, analyserFreqBytes, waveformBytes, rmsOf } = require('../../src/audio/fft.js')
const {
	normalizeAudioCaptureConfig,
	resolveCaptureDeviceFromList,
} = require('../../src/audio/audio-capture-fft.js')

const N = 1024
const BINS = N >> 1

/** @param {number} bin @param {number} [amp] */
function sineAtBin(bin, amp = 1) {
	const s = new Float32Array(N)
	for (let i = 0; i < N; i++) s[i] = amp * Math.sin((2 * Math.PI * bin * i) / N)
	return s
}

describe('WO-333 (a): DSP', () => {
	it('FFT: energy of a bin-k sine peaks at bin k', () => {
		const s = sineAtBin(37)
		const re = new Float64Array(N)
		const im = new Float64Array(N)
		re.set(s)
		fftRadix2(re, im)
		let best = 0
		for (let k = 1; k < BINS; k++) {
			if (Math.hypot(re[k], im[k]) > Math.hypot(re[best], im[best])) best = k
		}
		assert.equal(best, 37)
	})

	it('analyser bytes: silence maps to 0, a full-scale tone lights its own bin', () => {
		const smooth = new Float32Array(BINS)
		const silent = analyserFreqBytes(new Float32Array(N), smooth, { smoothing: 0 })
		assert.ok(silent.every((b) => b === 0), 'silence must be all-zero bytes')

		const loud = analyserFreqBytes(sineAtBin(37), smooth, { smoothing: 0 })
		assert.ok(loud[37] > 200, `driven bin should be hot, got ${loud[37]}`)
		assert.ok(loud[300] < loud[37] / 4, `far bin should be much colder, got ${loud[300]}`)
	})

	it('smoothing carries energy across frames (decay, not gate)', () => {
		const smooth = new Float32Array(BINS)
		analyserFreqBytes(sineAtBin(37), smooth, { smoothing: 0.6 })
		const after = analyserFreqBytes(new Float32Array(N), smooth, { smoothing: 0.6 })
		assert.ok(after[37] > 0, 'bin must decay through silence, not cut to zero')
	})

	it('PCM decode: mono passthrough, stereo downmix, gain with clamp', () => {
		const mono = Buffer.alloc(4)
		mono.writeInt16LE(16384, 0) // 0.5
		mono.writeInt16LE(-16384, 2)
		const m = pcmS16leToMonoFloats(mono, 1)
		assert.ok(Math.abs(m[0] - 0.5) < 1e-3 && Math.abs(m[1] + 0.5) < 1e-3)

		const stereo = Buffer.alloc(4)
		stereo.writeInt16LE(16384, 0) // L 0.5
		stereo.writeInt16LE(0, 2) // R 0
		const st = pcmS16leToMonoFloats(stereo, 2)
		assert.equal(st.length, 1)
		assert.ok(Math.abs(st[0] - 0.25) < 1e-3, 'stereo averages channels')

		const hot = pcmS16leToMonoFloats(mono, 1, 4)
		assert.equal(hot[0], 1, 'gain output clamps to ±1')
	})

	it('waveform bytes are 128-centered from the sample tail', () => {
		const w = waveformBytes(new Float32Array([0, 1, -1]), 3)
		assert.deepEqual(Array.from(w), [128, 255, 1])
		const padded = waveformBytes(new Float32Array(0), 4)
		assert.ok(padded.every((b) => b === 128), 'empty input → centered silence')
		assert.ok(Math.abs(rmsOf(sineAtBin(5)) - Math.SQRT1_2) < 0.01)
	})
})

describe('WO-333 (b): capture device resolution', () => {
	const ARECORD_L = [
		'**** List of CAPTURE Hardware Devices ****',
		'card 0: PCH [HDA Intel PCH], device 0: ALC1220 Analog [ALC1220 Analog]',
		'  Subdevices: 1/1',
		'card 3: Device [USB Audio Device], device 0: USB Audio [USB Audio]',
	].join('\n')

	it('substring hits card+device and returns a plughw string', () => {
		assert.equal(resolveCaptureDeviceFromList(ARECORD_L, 'usb'), 'plughw:3,0')
		assert.equal(resolveCaptureDeviceFromList(ARECORD_L, 'alc1220'), 'plughw:0,0')
		assert.equal(resolveCaptureDeviceFromList(ARECORD_L, 'nothere'), null)
		assert.equal(resolveCaptureDeviceFromList(ARECORD_L, ''), null)
	})
})

describe('WO-333 (c): config', () => {
	it('normalize: disabled by default, sane clamps, deviceMatch empty', () => {
		const c = normalizeAudioCaptureConfig({})
		assert.equal(c.enabled, false)
		assert.equal(c.fftSize, 1024)
		assert.equal(c.channels, 2)
		assert.equal(c.emitHz, 30)
		const clamped = normalizeAudioCaptureConfig({ audioCapture: { enabled: true, emitHz: 500, channels: 99, gain: 1000 } })
		assert.equal(clamped.enabled, true)
		assert.equal(clamped.emitHz, 60)
		assert.equal(clamped.channels, 8)
		assert.equal(clamped.gain, 32)
	})

	it('modular key + device-local classification (never replicates to a backup box)', () => {
		const cm = src('src/config/config-manager.js')
		assert.match(cm, /'audioCapture',/)
		const defaults = src('src/config/defaults-core.js')
		assert.match(defaults, /audioCapture: \{/)
		const { classifyConfigKey } = require('../../src/config/config-classify.js')
		assert.equal(classifyConfigKey('audioCapture'), 'device')
	})
})

describe('WO-333 (d): wiring', () => {
	it('index starts the lifecycle; shutdown stops it', () => {
		const idx = src('index.js')
		assert.match(idx, /createAudioCaptureLifecycle\(\{ appCtx, config, logger \}\)/)
		assert.match(idx, /_audioCaptureLifecycle\.startAudioCapture\(\)/)
		const sd = src('src/bootstrap/shutdown.js')
		assert.match(sd, /_audioCaptureLifecycle\) appCtx\._audioCaptureLifecycle\.onShutdown\(\)/)
	})

	it('lifecycle broadcasts audio_fft with base64 rows', () => {
		const lc = src('src/bootstrap/audio-capture-lifecycle.js')
		assert.match(lc, /_wsBroadcast\('audio_fft', \{/)
		assert.match(lc, /toString\('base64'\)/)
	})

	it("player consumes audio_fft frames and only synthesizes from OSC when they're stale", () => {
		const player = src('template/shaders/player.js')
		assert.match(player, /msg\.type === 'audio_fft'/)
		assert.match(player, /b64ToBytes\(msg\.data\.freq, freqBytes\)/)
		assert.match(player, /Date\.now\(\) - lastFftAt < FFT_FRESH_MS\) return/)
		// The WO-266 OSC fallback must survive as the stale path.
		assert.ok(player.includes("type !== 'osc'"), 'OSC level fallback stays intact')
	})
})
