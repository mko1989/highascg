'use strict'

const { spawn } = require('child_process')
const { resolveV4l2BridgeFps } = require('./v4l2-bridge-args')
const { resolveV4l2BridgeJpgPath } = require('./v4l2-bridge-cache')

/** @type {Map<number, { proc: import('child_process').ChildProcess|null, device: string, jpgPath: string, startedAt: number, lastError?: string }>} */
const _relays = new Map()

/**
 * @param {object} config
 * @returns {string}
 */
function ffmpegBinary(config) {
	return config?.streaming?.ffmpeg_path || process.env.FFMPEG_PATH || 'ffmpeg'
}

/**
 * @param {object} config
 * @returns {string}
 */
function resolveV4l2Device(config) {
	const dev = String(config?.virtualCamera?.device || '/dev/video10').trim()
	return dev || '/dev/video10'
}

/**
 * Read the overwriting JPEG buffer and feed v4l2 (video only — same as compose preview).
 * @param {object} ctx
 * @param {number} channel
 * @param {{ onExit?: () => void }} [opts]
 */
function startV4l2BridgeRelay(ctx, channel, opts = {}) {
	const ch = parseInt(String(channel), 10)
	if (!Number.isFinite(ch) || ch < 1) return
	stopV4l2BridgeRelay(ch)

	const cfg = ctx?.config || {}
	const vc = cfg.virtualCamera || {}
	const jpgPath = resolveV4l2BridgeJpgPath(cfg, ch)
	if (!jpgPath) {
		ctx?.log?.('warn', `[v4l2-bridge] relay ch${ch}: JPEG path not resolved`)
		return
	}

	const device = resolveV4l2Device(cfg)
	const fps = resolveV4l2BridgeFps(cfg)
	const width = Math.max(320, parseInt(String(vc.width ?? 1920), 10) || 1920)
	const height = Math.max(240, parseInt(String(vc.height ?? 1080), 10) || 1080)

	const args = [
		'-hide_banner',
		'-loglevel',
		'warning',
		'-nostdin',
		'-f',
		'image2',
		'-stream_loop',
		'-1',
		'-re',
		'-framerate',
		String(fps),
		'-i',
		jpgPath,
		'-vf',
		`format=yuv420p,scale=${width}:${height}`,
		'-pix_fmt',
		'yuv420p',
		'-an',
		'-f',
		'v4l2',
		'-video_size',
		`${width}x${height}`,
		device,
	]

	const proc = spawn(ffmpegBinary(cfg), args, { stdio: ['ignore', 'ignore', 'pipe'] })
	const entry = {
		proc,
		device,
		jpgPath,
		startedAt: Date.now(),
		lastError: undefined,
		onExit: opts.onExit,
	}
	_relays.set(ch, entry)

	proc.stderr?.on('data', (buf) => {
		const s = buf.toString().trim()
		if (!s) return
		if (/error|invalid|failed|cannot|busy/i.test(s)) entry.lastError = s.slice(0, 320)
		ctx?.log?.('debug', `[v4l2-bridge] relay ch${ch}: ${s.slice(0, 180)}`)
	})
	proc.on('error', (err) => {
		entry.lastError = err?.message || String(err)
		ctx?.log?.('warn', `[v4l2-bridge] relay ch${ch} spawn failed: ${entry.lastError}`)
	})
	proc.on('exit', (code, sig) => {
		if (_relays.get(ch)?.proc === proc) {
			if (code !== 0 && code != null) {
				entry.lastError = `ffmpeg exited code=${code} sig=${sig || ''}`
				ctx?.log?.('warn', `[v4l2-bridge] relay ch${ch} ${entry.lastError}`)
			}
			_relays.delete(ch)
			try {
				opts.onExit?.()
			} catch (e) {
				ctx?.log?.('warn', `[v4l2-bridge] relay ch${ch} onExit: ${e?.message || e}`)
			}
		}
	})

	ctx?.log?.('info', `[v4l2-bridge] relay ch${ch} ${jpgPath} @ ${fps}fps → ${device} (${width}x${height})`)
}

/**
 * @param {number} channel
 */
function stopV4l2BridgeRelay(channel) {
	const ch = parseInt(String(channel), 10)
	const entry = _relays.get(ch)
	if (!entry) return
	if (entry.proc && !entry.proc.killed) {
		try {
			entry.proc.kill('SIGTERM')
		} catch {
			/* ok */
		}
	}
	_relays.delete(ch)
}

function stopAllV4l2BridgeRelays() {
	for (const ch of [..._relays.keys()]) stopV4l2BridgeRelay(ch)
}

/**
 * @param {number} channel
 * @returns {boolean}
 */
function isV4l2BridgeRelayRunning(channel) {
	const ch = parseInt(String(channel), 10)
	const entry = _relays.get(ch)
	return !!(entry?.proc && entry.proc.exitCode == null && !entry.proc.killed)
}

/**
 * @param {object} config
 * @returns {object}
 */
function getV4l2BridgeRelayStats(config) {
	const vc = config?.virtualCamera || {}
	const ch = Math.max(1, parseInt(String(vc.channel ?? 1), 10) || 1)
	const st = _relays.get(ch)
	const jpgPath = resolveV4l2BridgeJpgPath(config, ch)
	return st
		? {
				running: isV4l2BridgeRelayRunning(ch),
				jpgPath: st.jpgPath,
				device: st.device,
				lastError: st.lastError || null,
				startedAt: st.startedAt || null,
				pid: st.proc?.pid ?? null,
			}
		: {
				running: false,
				jpgPath,
				device: resolveV4l2Device(config),
				lastError: null,
				startedAt: null,
				pid: null,
			}
}

module.exports = {
	startV4l2BridgeRelay,
	stopV4l2BridgeRelay,
	stopAllV4l2BridgeRelays,
	isV4l2BridgeRelayRunning,
	getV4l2BridgeRelayStats,
	resolveV4l2Device,
}
