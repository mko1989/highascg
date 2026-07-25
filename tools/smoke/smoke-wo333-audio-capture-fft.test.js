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

describe('WO-333b: live-audio slot routed as the FFT source (bridge PCM tee)', () => {
	const { buildLiveAudioBridgeFfmpegArgs, audioFftPcmUdpPort } = require('../../src/audio/live-audio-bridge.js')
	const { resolveAudioFftSourceSlot } = require('../../src/config/live-audio-input.js')

	it('resolveAudioFftSourceSlot: 1–8 pass, junk/0/out-of-range → 0', () => {
		assert.equal(resolveAudioFftSourceSlot({ casparServer: { audio_fft_source_slot: 3 } }), 3)
		assert.equal(resolveAudioFftSourceSlot({ casparServer: { audio_fft_source_slot: '2' } }), 2)
		assert.equal(resolveAudioFftSourceSlot({ casparServer: { audio_fft_source_slot: 0 } }), 0)
		assert.equal(resolveAudioFftSourceSlot({ casparServer: { audio_fft_source_slot: 9 } }), 0)
		assert.equal(resolveAudioFftSourceSlot({ casparServer: { audio_fft_source_slot: 'x' } }), 0)
		assert.equal(resolveAudioFftSourceSlot({}), 0)
	})

	it('bridge args grow the s16le tee ONLY for the routed slot', () => {
		const cfg = { casparServer: { audio_fft_source_slot: 3 } }
		const teed = buildLiveAudioBridgeFfmpegArgs(cfg, 3, 'hw:1,0')
		const teeUrl = `udp://127.0.0.1:${audioFftPcmUdpPort(3)}?pkt_size=1316`
		assert.ok(teed.includes('s16le'), 'routed slot carries the raw PCM output')
		assert.ok(teed.includes(teeUrl), `tee targets ${teeUrl}`)
		assert.ok(teed.indexOf('mpegts') < teed.indexOf('s16le'), 'Caspar ingest output stays first')

		const plain = buildLiveAudioBridgeFfmpegArgs(cfg, 2, 'hw:2,0')
		assert.ok(!plain.includes('s16le'), 'other slots keep the exact pre-WO-333b outputs')
		const off = buildLiveAudioBridgeFfmpegArgs({}, 3, 'hw:1,0')
		assert.ok(!off.includes('s16le'), 'no tee when no slot is routed')
	})

	it('tee port range stays clear of the MPEG-TS ingest ports', () => {
		const { LIVE_AUDIO_BRIDGE_UDP_PORT_BASE, AUDIO_FFT_PCM_UDP_PORT_BASE } = require('../../src/audio/live-audio-bridge.js')
		assert.ok(AUDIO_FFT_PCM_UDP_PORT_BASE >= LIVE_AUDIO_BRIDGE_UDP_PORT_BASE + 9, 'ingest uses base+1..8')
	})

	it('engine in slot mode: UDP PCM in → analyser frames out (behavioral)', async () => {
		const dgram = require('node:dgram')
		const { createAudioCaptureFft, normalizeAudioCaptureConfig } = require('../../src/audio/audio-capture-fft.js')
		const port = 53977
		const cfg = normalizeAudioCaptureConfig({ audioCapture: { enabled: true } })
		cfg.source = 'slot'
		cfg.udpPort = port
		cfg.channels = 2
		const frames = []
		const eng = createAudioCaptureFft({ config: cfg, log: () => {}, onFrame: (f) => frames.push(f) })
		eng.start()
		const tx = dgram.createSocket('udp4')
		// 2048 stereo frames of a bin-32 sine (relative to the 1024-pt FFT window @48k)
		const pcm = Buffer.alloc(2048 * 4)
		for (let i = 0; i < 2048; i++) {
			const v = Math.round(32000 * Math.sin((2 * Math.PI * 32 * i) / 1024))
			pcm.writeInt16LE(v, i * 4)
			pcm.writeInt16LE(v, i * 4 + 2)
		}
		const send = setInterval(() => tx.send(pcm, port, '127.0.0.1'), 25)
		try {
			await new Promise((resolve, reject) => {
				const t0 = Date.now()
				const poll = setInterval(() => {
					if (frames.some((f) => f.rms > 0.1)) {
						clearInterval(poll)
						resolve()
					} else if (Date.now() - t0 > 4000) {
						clearInterval(poll)
						reject(new Error(`no live frame in 4s (${frames.length} frames)`))
					}
				}, 20)
			})
		} finally {
			clearInterval(send)
			tx.close()
			eng.stop()
		}
		const live = frames.find((f) => f.rms > 0.1)
		assert.ok(live.freq[32] > 150, `bin 32 hot, got ${live.freq[32]}`)
		assert.ok(live.freq[300] < 40, `far bin cold, got ${live.freq[300]}`)
		assert.equal(live.device, `udp:${port}`)
	})

	it('API + lifecycle + inspector wiring', () => {
		const routes = src('src/api/routes-audio.js')
		assert.match(routes, /audio_fft_source_slot != null/)
		assert.match(routes, /_audioCaptureLifecycle\?\.restartAudioCapture\?\.\(\)/)
		const lc = src('src/bootstrap/audio-capture-lifecycle.js')
		assert.match(lc, /resolveAudioFftSourceSlot\(config\)/)
		assert.match(lc, /cfg\.source = 'slot'/)
		assert.match(lc, /restartAudioCapture/)
		const insp = src('client/components/inspector-live-audio-input.js')
		assert.match(insp, /data-live-audio-fft-source/)
		assert.match(insp, /audio_fft_source_slot: on \? slot : 0/)
		assert.match(insp, /\/api\/audio\/live-inputs\/apply/)
	})
})
