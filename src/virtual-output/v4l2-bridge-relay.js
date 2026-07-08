'use strict'

const { spawn } = require('child_process')
const {
	resolveV4l2BridgeFps,
	resolveV4l2BridgeMode,
	resolveV4l2BridgeStreamPort,
} = require('./v4l2-bridge-args')
const { resolveV4l2BridgeJpgPath } = require('./v4l2-bridge-cache')

/** @type {Map<number, { proc: import('child_process').ChildProcess|null, device: string, mode: string, source: string, jpgPath: string|null, startedAt: number, lastError?: string }>} */
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
 * ffmpeg args for the relay feeding v4l2. Video source branches on virtualCamera.mode:
 * - 'jpeg' — loop the Caspar-overwritten JPEG buffer (compose-preview pattern, WO-137).
 * - 'stream' — read Caspar's mjpeg-over-NUT UDP stream; exits after 5 s without packets so the
 *   lifecycle exit handler detaches the Caspar consumers (WO-145). Audio stays on snd-aloop (-an).
 * @param {object} config
 * @param {number} channel
 * @returns {{ mode: string, device: string, source: string, jpgPath: string|null, args: string[] } | null}
 */
function buildV4l2BridgeRelayArgs(config, channel) {
	const cfg = config || {}
	const vc = cfg.virtualCamera || {}
	const ch = parseInt(String(channel), 10)
	const mode = resolveV4l2BridgeMode(cfg)
	const device = resolveV4l2Device(cfg)
	const fps = resolveV4l2BridgeFps(cfg)
	const width = Math.max(320, parseInt(String(vc.width ?? 1920), 10) || 1920)
	const height = Math.max(240, parseInt(String(vc.height ?? 1080), 10) || 1080)

	const outputArgs = [
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
	const common = ['-hide_banner', '-loglevel', 'warning', '-nostdin']

	if (mode === 'stream') {
		const port = resolveV4l2BridgeStreamPort(cfg)
		const source = `udp://127.0.0.1:${port}?timeout=5000000`
		return { mode, device, source, jpgPath: null, args: [...common, '-i', source, ...outputArgs] }
	}

	const jpgPath = resolveV4l2BridgeJpgPath(cfg, ch)
	if (!jpgPath) return null
	return {
		mode,
		device,
		source: jpgPath,
		jpgPath,
		args: [...common, '-f', 'image2', '-stream_loop', '-1', '-re', '-framerate', String(fps), '-i', jpgPath, ...outputArgs],
	}
}

/**
 * Feed v4l2 from the mode-dependent video source (video only — audio rides snd-aloop).
 * @param {object} ctx
 * @param {number} channel
 * @param {{ onExit?: () => void }} [opts]
 */
function startV4l2BridgeRelay(ctx, channel, opts = {}) {
	const ch = parseInt(String(channel), 10)
	if (!Number.isFinite(ch) || ch < 1) return
	stopV4l2BridgeRelay(ch)

	const cfg = ctx?.config || {}
	const plan = buildV4l2BridgeRelayArgs(cfg, ch)
	if (!plan) {
		ctx?.log?.('warn', `[v4l2-bridge] relay ch${ch}: JPEG path not resolved`)
		return
	}

	const proc = spawn(ffmpegBinary(cfg), plan.args, { stdio: ['ignore', 'ignore', 'pipe'] })
	const entry = {
		proc,
		device: plan.device,
		mode: plan.mode,
		source: plan.source,
		jpgPath: plan.jpgPath,
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

	ctx?.log?.('info', `[v4l2-bridge] relay ch${ch} (${plan.mode}) ${plan.source} → ${plan.device}`)
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
	const plan = buildV4l2BridgeRelayArgs(config, ch)
	return st
		? {
				running: isV4l2BridgeRelayRunning(ch),
				mode: st.mode,
				source: st.source,
				jpgPath: st.jpgPath,
				device: st.device,
				lastError: st.lastError || null,
				startedAt: st.startedAt || null,
				pid: st.proc?.pid ?? null,
			}
		: {
				running: false,
				mode: plan?.mode ?? resolveV4l2BridgeMode(config),
				source: plan?.source ?? null,
				jpgPath: plan?.jpgPath ?? null,
				device: resolveV4l2Device(config),
				lastError: null,
				startedAt: null,
				pid: null,
			}
}

module.exports = {
	buildV4l2BridgeRelayArgs,
	startV4l2BridgeRelay,
	stopV4l2BridgeRelay,
	stopAllV4l2BridgeRelays,
	isV4l2BridgeRelayRunning,
	getV4l2BridgeRelayStats,
	resolveV4l2Device,
}
