'use strict'

const { spawn } = require('child_process')
const cache = require('./compose-preview-cache')
const {
	COMPOSE_PREVIEW_UDP_PORT_BASE,
	clampComposePreviewFps,
	clampJpegQuality,
	composePreviewUdpPort,
} = require('./compose-preview-ffmpeg-args')
const { isFfmpegJpegComposePreview, resolveMonitoredChannels } = require('./compose-preview-mode')

/** @type {Map<number, { proc: import('child_process').ChildProcess, port: number, outPath: string, startedAt: number, lastError?: string }>} */
const _receivers = new Map()

/**
 * @param {object} config
 * @returns {string}
 */
function ffmpegBinary(config) {
	return config?.streaming?.ffmpeg_path || process.env.FFMPEG_PATH || 'ffmpeg'
}

/**
 * @param {object} ctx
 * @param {number} channel
 */
function startComposePreviewReceiver(ctx, channel) {
	const ch = parseInt(String(channel), 10)
	if (!Number.isFinite(ch) || ch < 1) return
	stopComposePreviewReceiver(ch)
	const cfg = ctx?.config || {}
	const outPath = cache.resolvePreviewJpgPath(cfg, ch)
	if (!outPath) {
		_receivers.set(ch, {
			proc: null,
			port: composePreviewUdpPort(ch),
			outPath: '',
			startedAt: Date.now(),
			lastError: 'preview JPG path not resolved',
		})
		return
	}
	const port = composePreviewUdpPort(ch)
	const cp = cfg.composePreview || {}
	const q = clampJpegQuality(cp.jpegQuality, 10)
	const fps = clampComposePreviewFps(cp.fps, 2)
	const input = `udp://0.0.0.0:${port}?overrun_nonfatal=1&fifo_size=5000000`
	const args = [
		'-hide_banner',
		'-loglevel',
		'warning',
		'-nostdin',
		'-fflags',
		'nobuffer',
		'-flags',
		'low_delay',
		'-i',
		input,
		'-an',
		'-vf',
		`fps=${fps}`,
		'-q:v',
		String(q),
		'-update',
		'1',
		outPath,
	]
	const proc = spawn(ffmpegBinary(cfg), args, { stdio: ['ignore', 'ignore', 'pipe'] })
	const entry = { proc, port, outPath, startedAt: Date.now(), lastError: undefined }
	_receivers.set(ch, entry)
	proc.stderr?.on('data', (buf) => {
		const s = buf.toString().trim()
		if (!s) return
		if (/error|invalid|failed/i.test(s)) entry.lastError = s.slice(0, 240)
		ctx?.log?.('debug', `[compose-preview] receiver ch${ch}: ${s.slice(0, 180)}`)
	})
	proc.on('error', (err) => {
		entry.lastError = err?.message || String(err)
		ctx?.log?.('warn', `[compose-preview] receiver ch${ch} spawn failed: ${entry.lastError}`)
	})
	proc.on('exit', (code, sig) => {
		if (code !== 0 && code != null && _receivers.get(ch)?.proc === proc) {
			entry.lastError = `ffmpeg exited code=${code} sig=${sig || ''}`
			ctx?.log?.('warn', `[compose-preview] receiver ch${ch} ${entry.lastError}`)
		}
	})
	ctx?.log?.('info', `[compose-preview] receiver ch${ch} listening udp:${port} → ${outPath}`)
}

/**
 * @param {number} channel
 */
function stopComposePreviewReceiver(channel) {
	const ch = parseInt(String(channel), 10)
	const entry = _receivers.get(ch)
	if (!entry) return
	if (entry.proc && !entry.proc.killed) {
		try {
			entry.proc.kill('SIGTERM')
		} catch {
			/* ok */
		}
	}
	_receivers.delete(ch)
}

/**
 * @param {object} ctx
 */
function startAllComposePreviewReceivers(ctx) {
	if (!isFfmpegJpegComposePreview(ctx?.config)) return
	void cache.ensurePreviewDir(ctx.config).catch(() => {})
	for (const ch of resolveMonitoredChannels(ctx.config)) {
		startComposePreviewReceiver(ctx, ch)
	}
}

/**
 * @param {object} [ctx]
 */
function stopAllComposePreviewReceivers(ctx) {
	const channels = [..._receivers.keys()]
	for (const ch of channels) stopComposePreviewReceiver(ch)
	if (ctx && channels.length) ctx.log?.('debug', '[compose-preview] receivers stopped')
}

/**
 * @param {object} config
 */
function getComposeReceiverStats(config) {
	const channels = resolveMonitoredChannels(config || {})
	const byChannel = {}
	for (const ch of channels) {
		const st = _receivers.get(ch)
		byChannel[ch] = st
			? {
					running: !!(st.proc && !st.proc.killed),
					port: st.port,
					outPath: st.outPath || null,
					lastError: st.lastError || null,
					startedAt: st.startedAt || null,
				}
			: { running: false, port: composePreviewUdpPort(ch), outPath: null, lastError: null, startedAt: null }
	}
	return { udpPortBase: COMPOSE_PREVIEW_UDP_PORT_BASE, byChannel }
}

function resetComposeReceiverState() {
	stopAllComposePreviewReceivers()
}

module.exports = {
	startComposePreviewReceiver,
	stopComposePreviewReceiver,
	startAllComposePreviewReceivers,
	stopAllComposePreviewReceivers,
	getComposeReceiverStats,
	resetComposeReceiverState,
}
