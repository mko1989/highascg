'use strict'

const { spawn } = require('child_process')
const {
	resolveV4l2InputDevice,
	resolveV4l2InputFormat,
	resolveV4l2InputGeometry,
	resolveFfmpegV4l2AudioDevice,
	isV4l2CaptureBridgeEnabled,
} = require('./v4l2-input-config')
const { normalizeInputFormat } = require('./v4l2-enumerate')

/** MPEG-TS ingest per V4L2 slot (ffmpeg → Caspar PLAY udp://). */
const V4L2_INPUT_BRIDGE_UDP_PORT_BASE = 52400
/** Warmup after bridge (re)start — allow first IDR before Caspar PLAY. */
const BRIDGE_WARMUP_MS = 700

/** @type {Map<number, { proc: import('child_process').ChildProcess|null, port: number, device: string, startedAt: number, lastError?: string }>} */
const _bridges = new Map()

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
function v4l2InputBridgeUdpPort(slot) {
	return V4L2_INPUT_BRIDGE_UDP_PORT_BASE + parseInt(String(slot), 10)
}

/**
 * @param {object} cfg
 * @param {number} slot
 * @param {string} device
 * @returns {string[]}
 */
function buildV4l2InputBridgeFfmpegArgs(cfg, slot, device) {
	const port = v4l2InputBridgeUdpPort(slot)
	const fmtRaw = resolveV4l2InputFormat(cfg, slot)
	const { width, height, fps } = resolveV4l2InputGeometry(cfg, slot)
	const audioDev = resolveFfmpegV4l2AudioDevice(cfg, slot)

	/** @type {string[]} */
	const args = [
		'-hide_banner',
		'-loglevel',
		'warning',
		'-nostdin',
		'-thread_queue_size',
		'512',
		'-f',
		'v4l2',
	]
	if (fmtRaw && fmtRaw !== 'auto') {
		args.push('-input_format', normalizeInputFormat(fmtRaw))
	}
	if (width > 0 && height > 0) {
		args.push('-video_size', `${width}x${height}`)
	}
	if (fps > 0) {
		args.push('-framerate', String(fps))
	}
	args.push('-i', device)

	if (audioDev) {
		args.push('-thread_queue_size', '512', '-f', 'alsa', '-i', audioDev)
	}

	const outFps = fps > 0 ? fps : 50
	const gop = Math.max(1, Math.min(outFps, 50))

	if (audioDev) {
		args.push('-map', '0:v', '-map', '1:a')
	} else {
		args.push('-an')
	}

	args.push(
		'-c:v',
		'libx264',
		'-preset',
		'ultrafast',
		'-tune',
		'zerolatency',
		'-pix_fmt',
		'yuv420p',
		'-r',
		String(outFps),
		'-g',
		String(gop),
		'-keyint_min',
		String(gop),
		'-x264-params',
		`min-keyint=${gop}:scenecut=0:repeat-headers=1`,
	)

	if (audioDev) {
		args.push(
			'-c:a',
			'aac',
			'-b:a',
			'128k',
			'-ar',
			'48000',
			'-ac',
			'2',
			'-af',
			'aresample=async=1:first_pts=0,aformat=channel_layouts=stereo:sample_rates=48000',
		)
	}

	args.push(
		'-muxdelay',
		'0',
		'-muxpreload',
		'0',
		'-f',
		'mpegts',
		`udp://127.0.0.1:${port}?pkt_size=1316`,
	)

	return args
}

/**
 * @param {object} ctx
 * @param {number} slot
 */
function startV4l2InputBridge(ctx, slot) {
	const n = parseInt(String(slot), 10)
	if (!Number.isFinite(n) || n < 1 || n > 8) return false
	stopV4l2InputBridge(n)
	const cfg = ctx?.config || {}
	if (!isV4l2CaptureBridgeEnabled(cfg)) return false
	const device = resolveV4l2InputDevice(cfg, n)
	if (!device) {
		_bridges.set(n, {
			proc: null,
			port: v4l2InputBridgeUdpPort(n),
			device: '',
			startedAt: Date.now(),
			lastError: 'no_v4l2_device',
		})
		return false
	}
	const port = v4l2InputBridgeUdpPort(n)
	const args = buildV4l2InputBridgeFfmpegArgs(cfg, n, device)
	const proc = spawn(ffmpegBinary(cfg), args, { stdio: ['ignore', 'ignore', 'pipe'] })
	const entry = { proc, port, device, startedAt: Date.now(), lastError: undefined }
	_bridges.set(n, entry)
	proc.on('error', (err) => {
		entry.lastError = err?.message || String(err)
		ctx?.log?.('warn', `[v4l2-input-bridge] slot ${n} spawn failed: ${entry.lastError}`)
	})
	proc.stderr?.on('data', (buf) => {
		const s = buf.toString().trim()
		if (!s) return
		if (/error|invalid|failed|busy|No such file/i.test(s)) entry.lastError = s.slice(0, 240)
		ctx?.log?.('debug', `[v4l2-input-bridge] slot ${n}: ${s.slice(0, 180)}`)
	})
	proc.on('close', (code, signal) => {
		const cur = _bridges.get(n)
		if (!cur || cur.proc !== proc) return
		cur.proc = null
		if (code !== 0 && code != null) {
			cur.lastError = `ffmpeg exited ${code}${signal ? ` (${signal})` : ''}`
			ctx?.log?.('warn', `[v4l2-input-bridge] slot ${n} stopped: ${cur.lastError}`)
		}
	})
	ctx?.log?.('info', `[v4l2-input-bridge] slot ${n} capture ${device} → udp://127.0.0.1:${port}`)
	return true
}

/**
 * @param {number} slot
 */
function stopV4l2InputBridge(slot) {
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

function stopAllV4l2InputBridges() {
	for (const slot of [..._bridges.keys()]) stopV4l2InputBridge(slot)
}

/**
 * @param {object} ctx
 * @param {number} slot
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
async function ensureV4l2InputBridge(ctx, slot, opts = {}) {
	if (!isV4l2CaptureBridgeEnabled(ctx?.config)) return false
	const n = parseInt(String(slot), 10)
	if (!opts.force) {
		const entry = _bridges.get(n)
		if (entry?.proc && entry.proc.exitCode == null && !entry.proc.killed) return true
	}
	startV4l2InputBridge(ctx, n)
	await new Promise((r) => setTimeout(r, BRIDGE_WARMUP_MS))
	const next = _bridges.get(n)
	return !!(next?.proc && next.proc.exitCode == null && !next.proc.killed)
}

async function restartV4l2InputBridge(ctx, slot) {
	return ensureV4l2InputBridge(ctx, slot, { force: true })
}

/**
 * @param {number} slot
 */
function v4l2InputBridgeStatus(slot) {
	const entry = _bridges.get(parseInt(String(slot), 10))
	if (!entry) return { running: false }
	const running = !!(entry.proc && entry.proc.exitCode == null && !entry.proc.killed)
	return {
		running,
		port: entry.port,
		device: entry.device,
		lastError: entry.lastError,
		pid: entry.proc?.pid ?? null,
	}
}

function listV4l2InputBridgeStatuses() {
	/** @type {Record<number, object>} */
	const out = {}
	for (const slot of _bridges.keys()) {
		out[slot] = v4l2InputBridgeStatus(slot)
	}
	return out
}

module.exports = {
	V4L2_INPUT_BRIDGE_UDP_PORT_BASE,
	BRIDGE_WARMUP_MS,
	isV4l2CaptureBridgeEnabled,
	v4l2InputBridgeUdpPort,
	buildV4l2InputBridgeFfmpegArgs,
	startV4l2InputBridge,
	stopV4l2InputBridge,
	stopAllV4l2InputBridges,
	ensureV4l2InputBridge,
	restartV4l2InputBridge,
	v4l2InputBridgeStatus,
	listV4l2InputBridgeStatuses,
}
