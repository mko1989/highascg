'use strict'

const { spawn } = require('child_process')
const {
	resolveLiveAudioCaptureBaseUri,
	parseAlsaHwIdentity,
} = require('../config/live-audio-input')
const { readCasparSetting } = require('../config/routing-map')

/** MPEG-TS ingest per live-audio slot (HighAsCG ffmpeg → Caspar PLAY udp://). */
const LIVE_AUDIO_BRIDGE_UDP_PORT_BASE = 52200
/** WO-333b: raw PCM tee per slot (bridge ffmpeg → shader-FFT engine, s16le 48k stereo). */
const AUDIO_FFT_PCM_UDP_PORT_BASE = 52220
/** Warmup after bridge (re)start — allow first IDR + SPS/PPS before Caspar PLAY. */
const BRIDGE_WARMUP_MS = 700

/** @type {Map<number, { proc: import('child_process').ChildProcess|null, port: number, device: string, startedAt: number, lastError?: string }>} */
const _bridges = new Map()

/* Slot -> device string that actually opened. Once a card has rejected the configured form we go
 * straight to the working one on every later start, instead of re-spawning a doomed ffmpeg first.
 * Cleared by stopLiveAudioBridge so a re-cabled or swapped device is re-probed from scratch. */
const _workingDeviceBySlot = new Map()

/**
 * @param {object} cfg
 * @returns {boolean}
 */
function isLiveAudioBridgeEnabled(cfg) {
	const raw = readCasparSetting(cfg, 'live_audio_capture_bridge')
	if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false
	return true
}

/**
 * @param {object} config
 * @returns {string}
 */
function ffmpegBinary(config) {
	return config?.streaming?.ffmpeg_path || process.env.FFMPEG_PATH || 'ffmpeg'
}

/**
 * @param {number} slot 1–8
 * @returns {number}
 */
function liveAudioBridgeUdpPort(slot) {
	return LIVE_AUDIO_BRIDGE_UDP_PORT_BASE + parseInt(String(slot), 10)
}

/**
 * @param {number} slot 1–8
 * @returns {number}
 */
function audioFftPcmUdpPort(slot) {
	return AUDIO_FFT_PCM_UDP_PORT_BASE + parseInt(String(slot), 10)
}

/**
 * Caspar ffmpeg producer PLAY clip for a bridged live input.
 * @param {number} slot
 * @returns {string}
 */
function liveAudioBridgePlayClip(slot) {
	const port = liveAudioBridgeUdpPort(slot)
	return `udp://127.0.0.1:${port}?overrun_nonfatal=1&fifo_size=65536`
}

/**
 * ALSA device string for external ffmpeg `-f alsa -i …` (not alsa:// URL).
 * @param {object} cfg
 * @param {number} slot
 * @returns {string|null}
 */
function resolveFfmpegAlsaInputDevice(cfg, slot) {
	const uri = resolveLiveAudioCaptureBaseUri(cfg, slot)
	if (!uri) return null
	const body = uri.replace(/^alsa:\/\//i, '')
	if (/^(?:plug)?hw:|^dsnoop:|^plughw:|^default/i.test(body)) return body
	const hw = parseAlsaHwIdentity(uri)
	return hw ? `hw:${hw}` : body
}

/**
 * `dsnoop:`/`hw:` hand the device format straight through, so a card that does not offer the
 * format ffmpeg asks for fails outright with "cannot set sample format" — observed on a Yamaha DM3,
 * which is S32_LE only. `plughw:` runs ALSA's plug converter, which negotiates format/rate. We keep
 * dsnoop first (it is the only form that lets several readers share one capture device) and fall
 * back to plughw only after a format failure, so sharing is preserved on cards that support it.
 * @param {string} device
 * @returns {string|null} plug-converting equivalent, or null when there is no sensible one
 */
function plugFallbackDevice(device) {
	const d = String(device || '')
	let m = d.match(/^dsnoop:(.+)$/i)
	if (m) return `plughw:${m[1]}`
	m = d.match(/^hw:(.+)$/i)
	if (m) return `plughw:${m[1]}`
	return null
}

/** ALSA format-negotiation failure — the case plugFallbackDevice() exists to recover from. */
function isAlsaFormatError(text) {
	return /cannot set sample format|sample format .*invalid|snd_pcm_hw_params/i.test(String(text || ''))
}

/**
 * @param {object} cfg
 * @param {number} slot
 * @param {string} device
 * @returns {string[]}
 */
function buildLiveAudioBridgeFfmpegArgs(cfg, slot, device) {
	const port = liveAudioBridgeUdpPort(slot)
	const buf = parseInt(String(readCasparSetting(cfg, 'live_audio_alsa_buffer_size') ?? 131072), 10)
	const queue = Number.isFinite(buf) && buf > 0 ? Math.max(512, Math.min(buf, 1048576)) : 131072
	// Caspar ffmpeg producer needs a video track in MPEG-TS to advance time; audio-only TS stays at 0/0.
	// GOP=1 + repeat-headers so each Caspar PLAY/reconnect starts on a decodable IDR (avoids PPS errors).
	const args = [
		'-hide_banner',
		'-loglevel',
		'warning',
		'-nostdin',
		'-thread_queue_size',
		String(queue),
		'-f',
		'alsa',
		'-i',
		device,
		'-f',
		'lavfi',
		'-i',
		'color=c=black:s=320x240:r=25',
		'-map',
		'0:a',
		'-map',
		'1:v',
		'-af',
		'aresample=async=1:first_pts=0,aformat=channel_layouts=stereo:sample_rates=48000',
		'-c:a',
		'aac',
		'-b:a',
		'128k',
		'-ar',
		'48000',
		'-ac',
		'2',
		'-c:v',
		'libx264',
		'-preset',
		'ultrafast',
		'-tune',
		'zerolatency',
		'-pix_fmt',
		'yuv420p',
		'-r',
		'25',
		'-g',
		'1',
		'-keyint_min',
		'1',
		'-b:v',
		'64k',
		'-x264-params',
		'min-keyint=1:scenecut=0:repeat-headers=1:keyint=1',
		'-muxdelay',
		'0',
		'-muxpreload',
		'0',
		'-f',
		'mpegts',
		`udp://127.0.0.1:${port}?pkt_size=1316`,
	]
	// WO-333b: when this slot is the shader-FFT source, tee the SAME capture as raw PCM to the
	// FFT engine — the capture host stays the single opener of the ALSA device. Unconnected UDP
	// sendto: a missing listener can never error the on-air ingest output above. Format is pinned
	// (s16le / 48k / stereo) by this output's own -af, independent of the card's native format.
	const { resolveAudioFftSourceSlot } = require('../config/live-audio-input')
	if (resolveAudioFftSourceSlot(cfg) === parseInt(String(slot), 10)) {
		args.push(
			'-map',
			'0:a',
			'-af',
			'aresample=async=1:first_pts=0,aformat=channel_layouts=stereo:sample_rates=48000',
			'-c:a',
			'pcm_s16le',
			'-f',
			's16le',
			`udp://127.0.0.1:${audioFftPcmUdpPort(slot)}?pkt_size=1316`,
		)
	}
	return args
}

/**
 * @param {object} ctx
 * @param {number} slot
 */
function startLiveAudioBridge(ctx, slot, opts = {}) {
	const n = parseInt(String(slot), 10)
	if (!Number.isFinite(n) || n < 1 || n > 8) return false
	/* Read the remembered device BEFORE stopping — stopLiveAudioBridge clears the memo (so an
	 * explicit stop re-probes a possibly swapped card), and start() calls it on the way in. */
	const remembered = _workingDeviceBySlot.get(n)
	stopLiveAudioBridge(n)
	const cfg = ctx?.config || {}
	const configured = resolveFfmpegAlsaInputDevice(cfg, n)
	const device = opts.deviceOverride || remembered || configured
	if (!device) {
		_bridges.set(n, {
			proc: null,
			port: liveAudioBridgeUdpPort(n),
			device: '',
			startedAt: Date.now(),
			lastError: 'no_alsa_device',
		})
		return false
	}
	const port = liveAudioBridgeUdpPort(n)
	const args = buildLiveAudioBridgeFfmpegArgs(cfg, n, device)
	const proc = spawn(ffmpegBinary(cfg), args, { stdio: ['ignore', 'ignore', 'pipe'] })
	const entry = { proc, port, device, startedAt: Date.now(), lastError: undefined, plugRetried: !!opts.plugRetried }
	_bridges.set(n, entry)
	/* Re-arm the memo whenever we are running on something other than the configured device: the
	 * stop above cleared it, and without this the remembered value is consumed once and every
	 * later start re-probes the device we already know is broken. */
	if (device !== configured) _workingDeviceBySlot.set(n, device)
	proc.on('error', (err) => {
		entry.lastError = err?.message || String(err)
		ctx?.log?.('warn', `[live-audio-bridge] slot ${n} spawn failed: ${entry.lastError}`)
	})
	proc.stderr?.on('data', (buf) => {
		const s = buf.toString().trim()
		if (!s) return
		if (/error|invalid|failed|busy/i.test(s)) entry.lastError = s.slice(0, 240)
		if (isAlsaFormatError(s)) {
			entry.formatError = true
			_workingDeviceBySlot.delete(n)
		}
		ctx?.log?.('debug', `[live-audio-bridge] slot ${n}: ${s.slice(0, 180)}`)
	})
	proc.on('close', (code, signal) => {
		const cur = _bridges.get(n)
		if (!cur || cur.proc !== proc) return
		cur.proc = null
		if (code !== 0 && code != null) {
			cur.lastError = `ffmpeg exited ${code}${signal ? ` (${signal})` : ''}`
			/* One retry through the plug converter when the card rejected the format (see
			 * plugFallbackDevice). Guarded by cur.plugRetried so a genuinely broken device
			 * cannot produce a respawn loop. */
			const fallback = cur.formatError && !cur.plugRetried ? plugFallbackDevice(cur.device) : null
			if (fallback) {
				cur.plugRetried = true
				ctx?.log?.(
					'warn',
					`[live-audio-bridge] slot ${n}: ${cur.device} rejected the capture format — retrying via ${fallback}`,
				)
				_workingDeviceBySlot.set(n, fallback)
				startLiveAudioBridge(ctx, n, { deviceOverride: fallback, plugRetried: true })
				return
			}
			ctx?.log?.('warn', `[live-audio-bridge] slot ${n} stopped: ${cur.lastError}`)
		}
	})
	if (typeof ctx?.log === 'function') {
		ctx.log('info', `[live-audio-bridge] slot ${n} capture ${device} → udp://127.0.0.1:${port}`)
	}
	return true
}

/**
 * @param {number} slot
 */
function stopLiveAudioBridge(slot) {
	const n = parseInt(String(slot), 10)
	const entry = _bridges.get(n)
	if (!entry) return
	if (entry.proc && !entry.proc.killed) {
		try {
			entry.proc.kill('SIGTERM')
		} catch (_) {}
	}
	_bridges.delete(n)
	_workingDeviceBySlot.delete(n)
}

function stopAllLiveAudioBridges() {
	for (const slot of [..._bridges.keys()]) stopLiveAudioBridge(slot)
}

/**
 * @param {object} ctx
 * @param {number} slot
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
async function ensureLiveAudioBridge(ctx, slot, opts = {}) {
	if (!isLiveAudioBridgeEnabled(ctx?.config)) return false
	const n = parseInt(String(slot), 10)
	if (!opts.force) {
		const entry = _bridges.get(n)
		if (entry?.proc && entry.proc.exitCode == null && !entry.proc.killed) return true
	}
	startLiveAudioBridge(ctx, n)
	await new Promise((r) => setTimeout(r, BRIDGE_WARMUP_MS))
	const next = _bridges.get(n)
	return !!(next?.proc && next.proc.exitCode == null && !next.proc.killed)
}

/** Stop + start bridge so the next Caspar PLAY joins at stream origin (IDR + SPS/PPS). */
async function restartLiveAudioBridge(ctx, slot) {
	return ensureLiveAudioBridge(ctx, slot, { force: true })
}

/**
 * @param {number} slot
 * @returns {{ running: boolean, port?: number, device?: string, lastError?: string }}
 */
function liveAudioBridgeStatus(slot) {
	const entry = _bridges.get(parseInt(String(slot), 10))
	if (!entry) return { running: false }
	const running = !!(entry.proc && entry.proc.exitCode == null && !entry.proc.killed)
	return {
		running,
		port: entry.port,
		device: entry.device,
		lastError: entry.lastError,
	}
}

module.exports = {
	LIVE_AUDIO_BRIDGE_UDP_PORT_BASE,
	AUDIO_FFT_PCM_UDP_PORT_BASE,
	isLiveAudioBridgeEnabled,
	liveAudioBridgeUdpPort,
	audioFftPcmUdpPort,
	liveAudioBridgePlayClip,
	resolveFfmpegAlsaInputDevice,
	plugFallbackDevice,
	isAlsaFormatError,
	buildLiveAudioBridgeFfmpegArgs,
	startLiveAudioBridge,
	stopLiveAudioBridge,
	stopAllLiveAudioBridges,
	ensureLiveAudioBridge,
	restartLiveAudioBridge,
	liveAudioBridgeStatus,
	BRIDGE_WARMUP_MS,
}
