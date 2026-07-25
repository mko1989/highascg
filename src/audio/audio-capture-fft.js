'use strict'

/**
 * WO-333 — line-in / USB audio capture → FFT frames for shader reactivity.
 *
 * Keeps a rolling fftSize-sample mono ring and emits AnalyserNode-shaped frames (512 freq
 * bytes + 512 waveform bytes, see src/audio/fft.js) at `emitHz`. The bootstrap lifecycle
 * broadcasts each frame on the playout WS as `type:'audio_fft'`; template/shaders/player.js
 * prefers those frames over the coarse OSC-level synthesis.
 *
 * PCM sources (config.source):
 *  - 'slot' (WO-333b, the production path): listen on a loopback UDP port for the raw s16le
 *    48k stereo tee that the slot's live-audio bridge ffmpeg emits
 *    (src/audio/live-audio-bridge.js buildLiveAudioBridgeFfmpegArgs) — the existing capture
 *    host stays the only opener of the ALSA device, and the FFT source is just routed in the
 *    live-audio inspector. Bridge down → frames go stale → one zeroed frame (silence decay).
 *  - 'device': spawn `arecord` on a dedicated ALSA capture device (a card nothing else uses).
 *
 * Device selection: `device` is an exact ALSA string (`plughw:1,0`, `hw:CARD=Device`, …).
 * `deviceMatch` instead resolves a substring against `arecord -l` card/device names at every
 * (re)spawn — so "usb" keeps working when a USB interface re-enumerates to another card index.
 * The capture opens the device exclusively on plain hw devices: don't point it at a card an
 * on-air live-audio bridge slot is using (the lifecycle logs a warning if it detects that).
 *
 * Resilience: arecord exit / missing device → retry with backoff (2s → 30s cap), re-resolving
 * deviceMatch each attempt (USB hotplug). No PCM for `staleMs` → one zeroed frame (shaders
 * decay to silence instead of freezing on the last loud frame).
 */

const { spawn, execFileSync } = require('child_process')
const dgram = require('dgram')
const { pcmS16leToMonoFloats, analyserFreqBytes, waveformBytes, rmsOf } = require('./fft')

const ARECORD_BINS = ['arecord', '/usr/bin/arecord']

/**
 * @param {Record<string, unknown>} [cfg] merged app config (`config.audioCapture`)
 */
function normalizeAudioCaptureConfig(cfg) {
	const o = (cfg && cfg.audioCapture) || {}
	const env = process.env
	const num = (v, fb) => {
		const n = Number(v)
		return Number.isFinite(n) ? n : fb
	}
	const enabled =
		o.enabled === true || env.HIGHASCG_AUDIO_FFT === '1' || env.HIGHASCG_AUDIO_FFT === 'true'
	return {
		enabled,
		/** 'slot' = UDP PCM tee from a live-audio bridge; 'device' = own arecord capture. */
		source: 'device',
		/** Loopback UDP port for source:'slot' (set by the lifecycle from the routed slot). */
		udpPort: 0,
		/** Exact ALSA capture device. */
		device: String(env.HIGHASCG_AUDIO_FFT_DEVICE || o.device || 'plughw:0,0'),
		/** Substring resolved against `arecord -l` at spawn time; wins over `device` when it hits. */
		deviceMatch: String(o.deviceMatch || ''),
		sampleRate: Math.max(8000, num(o.sampleRate, 48000)),
		channels: Math.max(1, Math.min(8, num(o.channels, 2))),
		/** Linear pre-gain — line-in feeds often sit well below full scale. */
		gain: Math.max(0.1, Math.min(32, num(o.gain, 1))),
		/** 1024 → 512 bins, the shader runtime's AUDIO_W. Must stay a power of two. */
		fftSize: 1024,
		emitHz: Math.max(5, Math.min(60, num(o.emitHz, 30))),
		smoothing: Math.max(0, Math.min(0.99, num(o.smoothing, 0.6))),
		minDb: num(o.minDb, -100),
		maxDb: num(o.maxDb, -30),
		staleMs: Math.max(500, num(o.staleMs, 2000)),
	}
}

/**
 * Parse `arecord -l` and resolve a substring to a `plughw:card,device` string.
 * Exported for tests.
 * @param {string} listText
 * @param {string} match
 * @returns {string|null}
 */
function resolveCaptureDeviceFromList(listText, match) {
	const want = String(match || '').toLowerCase()
	if (!want) return null
	const re = /^card (\d+): ([^,]+), device (\d+): (.+)$/gm
	let m
	while ((m = re.exec(String(listText))) !== null) {
		const hay = `${m[2]} ${m[4]}`.toLowerCase()
		if (hay.includes(want)) return `plughw:${m[1]},${m[3]}`
	}
	return null
}

/** @returns {string|null} */
function listCaptureDevices() {
	for (const bin of ARECORD_BINS) {
		try {
			return execFileSync(bin, ['-l'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
		} catch {
			/* try next */
		}
	}
	return null
}

/**
 * @param {object} opts
 * @param {ReturnType<typeof normalizeAudioCaptureConfig>} opts.config
 * @param {(level: string, msg: string) => void} opts.log
 * @param {(frame: { freq: Uint8Array, wave: Uint8Array, rms: number, device: string }) => void} opts.onFrame
 */
function createAudioCaptureFft({ config, log, onFrame }) {
	const cfg = config
	/** @type {import('child_process').ChildProcess|null} */
	let proc = null
	/** @type {ReturnType<typeof setInterval>|null} */
	let emitTimer = null
	/** @type {ReturnType<typeof setTimeout>|null} */
	let retryTimer = null
	let retryMs = 2000
	let stopped = false
	let lastPcmAt = 0
	let staleFrameSent = false
	let activeDevice = cfg.device

	const ring = new Float32Array(cfg.fftSize)
	let ringFill = 0
	const smoothState = new Float32Array(cfg.fftSize >> 1)
	/** S16 frame alignment across chunk boundaries. */
	let pending = Buffer.alloc(0)

	function resolveDevice() {
		if (cfg.deviceMatch) {
			const listed = listCaptureDevices()
			const hit = listed ? resolveCaptureDeviceFromList(listed, cfg.deviceMatch) : null
			if (hit) return hit
			log('warn', `[AudioFFT] no capture device matching "${cfg.deviceMatch}" — falling back to ${cfg.device}`)
		}
		return cfg.device
	}

	function pushSamples(f32) {
		const n = f32.length
		if (n >= ring.length) {
			ring.set(f32.subarray(n - ring.length))
			ringFill = ring.length
			return
		}
		ring.copyWithin(0, n)
		ring.set(f32, ring.length - n)
		ringFill = Math.min(ring.length, ringFill + n)
	}

	function onPcm(chunk) {
		lastPcmAt = Date.now()
		staleFrameSent = false
		const frameBytes = 2 * cfg.channels
		let buf = pending.length ? Buffer.concat([pending, chunk]) : chunk
		const usable = buf.length - (buf.length % frameBytes)
		pending = buf.subarray(usable)
		if (usable > 0) pushSamples(pcmS16leToMonoFloats(buf.subarray(0, usable), cfg.channels, cfg.gain))
	}

	function emitFrame() {
		const fresh = Date.now() - lastPcmAt < cfg.staleMs
		if (!fresh) {
			if (staleFrameSent) return
			staleFrameSent = true
			smoothState.fill(0)
			onFrame({
				freq: new Uint8Array(cfg.fftSize >> 1),
				wave: waveformBytes(new Float32Array(0), cfg.fftSize >> 1),
				rms: 0,
				device: activeDevice,
			})
			return
		}
		if (ringFill < ring.length) return
		const freq = analyserFreqBytes(ring, smoothState, cfg)
		const wave = waveformBytes(ring, cfg.fftSize >> 1)
		onFrame({ freq, wave, rms: rmsOf(ring), device: activeDevice })
	}

	function scheduleRetry(why) {
		if (stopped || retryTimer) return
		log('warn', `[AudioFFT] capture on ${activeDevice} ${why} — retrying in ${Math.round(retryMs / 1000)}s`)
		retryTimer = setTimeout(() => {
			retryTimer = null
			startSource()
		}, retryMs)
		if (retryTimer.unref) retryTimer.unref()
		retryMs = Math.min(30000, retryMs * 2)
	}

	function spawnCapture() {
		if (stopped) return
		activeDevice = resolveDevice()
		pending = Buffer.alloc(0)
		let stderrTail = ''
		let p
		try {
			p = spawn(
				ARECORD_BINS[0],
				['-q', '-D', activeDevice, '-f', 'S16_LE', '-r', String(cfg.sampleRate), '-c', String(cfg.channels), '-t', 'raw'],
				{ stdio: ['ignore', 'pipe', 'pipe'] },
			)
		} catch (e) {
			scheduleRetry(`spawn failed (${e?.message || e})`)
			return
		}
		proc = p
		p.stdout.on('data', onPcm)
		p.stderr.on('data', (d) => {
			stderrTail = (stderrTail + String(d)).slice(-400)
		})
		p.on('error', (e) => {
			if (proc === p) proc = null
			scheduleRetry(`error (${e?.message || e})`)
		})
		p.on('exit', (code, sig) => {
			if (proc === p) proc = null
			if (stopped) return
			scheduleRetry(`exited (${sig || `code ${code}`})${stderrTail ? `: ${stderrTail.trim().split('\n').pop()}` : ''}`)
		})
		log('info', `[AudioFFT] capturing ${activeDevice} @ ${cfg.sampleRate}Hz x${cfg.channels}, ${cfg.emitHz}Hz frames`)
		// A healthy 10s of PCM resets the backoff so a later one-off failure retries quickly again.
		setTimeout(() => {
			if (proc === p && Date.now() - lastPcmAt < 2000) retryMs = 2000
		}, 10000).unref?.()
	}

	/** @type {import('dgram').Socket|null} */
	let udpSock = null

	function startUdpSource() {
		activeDevice = `udp:${cfg.udpPort}`
		const sock = dgram.createSocket('udp4')
		udpSock = sock
		sock.on('message', onPcm)
		sock.on('error', (e) => {
			log('warn', `[AudioFFT] UDP PCM listener :${cfg.udpPort} error: ${e?.message || e}`)
			try {
				sock.close()
			} catch {
				/* already closed */
			}
			if (udpSock === sock) udpSock = null
			scheduleRetry('udp listener died')
		})
		sock.bind(cfg.udpPort, '127.0.0.1', () => {
			log('info', `[AudioFFT] listening for bridge PCM tee on udp://127.0.0.1:${cfg.udpPort} (${cfg.emitHz}Hz frames)`)
		})
	}

	function startSource() {
		if (cfg.source === 'slot' && cfg.udpPort > 0) startUdpSource()
		else spawnCapture()
	}

	return {
		start() {
			stopped = false
			startSource()
			emitTimer = setInterval(emitFrame, Math.round(1000 / cfg.emitHz))
			if (emitTimer.unref) emitTimer.unref()
		},
		stop() {
			stopped = true
			if (emitTimer) clearInterval(emitTimer)
			emitTimer = null
			if (retryTimer) clearTimeout(retryTimer)
			retryTimer = null
			if (proc) {
				try {
					proc.kill('SIGTERM')
				} catch {
					/* already gone */
				}
				proc = null
			}
			if (udpSock) {
				try {
					udpSock.close()
				} catch {
					/* already closed */
				}
				udpSock = null
			}
		},
		getStatus() {
			return {
				source: cfg.source,
				device: activeDevice,
				capturing: !!(proc || udpSock),
				pcmFresh: Date.now() - lastPcmAt < cfg.staleMs,
			}
		},
	}
}

module.exports = { normalizeAudioCaptureConfig, resolveCaptureDeviceFromList, createAudioCaptureFft }
