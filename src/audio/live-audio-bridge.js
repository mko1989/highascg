'use strict'

const { spawn } = require('child_process')
const {
	resolveLiveAudioCaptureBaseUri,
	parseAlsaHwIdentity,
} = require('../config/live-audio-input')
const { readCasparSetting } = require('../config/routing-map')

/** MPEG-TS ingest per live-audio slot (HighAsCG ffmpeg → Caspar PLAY udp://). */
const LIVE_AUDIO_BRIDGE_UDP_PORT_BASE = 52200
/** Warmup after bridge (re)start — allow first IDR + SPS/PPS before Caspar PLAY. */
const BRIDGE_WARMUP_MS = 700

/** @type {Map<number, { proc: import('child_process').ChildProcess|null, port: number, device: string, startedAt: number, lastError?: string }>} */
const _bridges = new Map()

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
	return [
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
}

/**
 * @param {object} ctx
 * @param {number} slot
 */
function startLiveAudioBridge(ctx, slot) {
	const n = parseInt(String(slot), 10)
	if (!Number.isFinite(n) || n < 1 || n > 8) return false
	stopLiveAudioBridge(n)
	const cfg = ctx?.config || {}
	const device = resolveFfmpegAlsaInputDevice(cfg, n)
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
	const entry = { proc, port, device, startedAt: Date.now(), lastError: undefined }
	_bridges.set(n, entry)
	proc.stderr?.on('data', (buf) => {
		const s = buf.toString().trim()
		if (!s) return
		if (/error|invalid|failed|busy/i.test(s)) entry.lastError = s.slice(0, 240)
		ctx?.log?.('debug', `[live-audio-bridge] slot ${n}: ${s.slice(0, 180)}`)
	})
	proc.on('close', (code, signal) => {
		const cur = _bridges.get(n)
		if (!cur || cur.proc !== proc) return
		cur.proc = null
		if (code !== 0 && code != null) {
			cur.lastError = `ffmpeg exited ${code}${signal ? ` (${signal})` : ''}`
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
	isLiveAudioBridgeEnabled,
	liveAudioBridgeUdpPort,
	liveAudioBridgePlayClip,
	resolveFfmpegAlsaInputDevice,
	buildLiveAudioBridgeFfmpegArgs,
	startLiveAudioBridge,
	stopLiveAudioBridge,
	stopAllLiveAudioBridges,
	ensureLiveAudioBridge,
	restartLiveAudioBridge,
	liveAudioBridgeStatus,
	BRIDGE_WARMUP_MS,
}
