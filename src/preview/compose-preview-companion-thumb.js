'use strict'

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const cache = require('./compose-preview-cache')
const { resolveMonitoredChannels } = require('./compose-preview-mode')

/** @type {Map<number, number>} */
const _lastSourceMtime = new Map()
/** @type {Map<number, Promise<void>>} */
const _inFlight = new Map()
/** @type {Map<number, { mtimeMs: number, updatedAt: number, bytes: number }>} */
const _lastVarMeta = new Map()
/** @type {Map<number, Buffer>} */
const _lastJpegBuffer = new Map()

/**
 * @param {object} [config]
 * @returns {boolean}
 */
function isCompanionThumbEnabled(config) {
	return config?.composePreview?.companionThumbEnabled === true
}

/** @alias isCompanionThumbEnabled */
const isCompanionPreviewEnabled = isCompanionThumbEnabled

/**
 * @param {object} [config]
 * @returns {number}
 */
function companionThumbSize(config) {
	const n = parseInt(String(config?.composePreview?.companionThumbSize ?? 144), 10)
	return Number.isFinite(n) ? Math.max(32, Math.min(512, n)) : 144
}

/**
 * @deprecated Interval is ignored; updates follow compose preview frame cadence.
 * @param {object} [config]
 * @returns {number}
 */
function companionThumbIntervalMs(config) {
	const n = parseInt(String(config?.composePreview?.companionThumbIntervalMs ?? 1000), 10)
	return Number.isFinite(n) ? Math.max(250, Math.min(10000, n)) : 1000
}

/**
 * @param {number} channel
 * @returns {string}
 */
function getCompanionPreviewVariableKey(channel) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	return `compose_preview_ch${ch}_image`
}

/**
 * @param {object} config
 * @param {number} channel
 * @returns {string}
 */
function getCompanionThumbBasename(config, channel) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	const prefix = String(config?.composePreview?.basenamePrefix || 'highascg_preview').trim() || 'highascg_preview'
	return `${prefix}/ch${ch}_companion.jpg`
}

/**
 * @param {object} config
 * @param {number} channel
 * @returns {string | null}
 */
function resolveCompanionThumbOutputPath(config, channel) {
	const { getMediaIngestBasePath, resolveSafe } = require('../media/local-media-paths')
	return resolveSafe(getMediaIngestBasePath(config), getCompanionThumbBasename(config, channel))
}

/**
 * @param {object} config
 * @returns {string}
 */
function ffmpegBinary(config) {
	return config?.streaming?.ffmpeg_path || process.env.FFMPEG_PATH || 'ffmpeg'
}

/**
 * @param {object} config
 * @param {string} sourcePath
 * @param {number} size
 * @returns {Promise<Buffer | null>}
 */
function resizePreviewToPngBuffer(config, sourcePath, size) {
	const vf = `scale=${size}:${size}:force_original_aspect_ratio=decrease,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2`
	return new Promise((resolve) => {
		const chunks = []
		const proc = spawn(
			ffmpegBinary(config),
			[
				'-hide_banner',
				'-loglevel',
				'error',
				'-y',
				'-i',
				sourcePath,
				'-vf',
				vf,
				'-frames:v',
				'1',
				'-f',
				'image2pipe',
				'-vcodec',
				'png',
				'pipe:1',
			],
			{ stdio: ['ignore', 'pipe', 'pipe'] },
		)
		proc.stdout.on('data', (chunk) => chunks.push(chunk))
		proc.on('close', (code) => {
			if (code === 0 && chunks.length) resolve(Buffer.concat(chunks))
			else resolve(null)
		})
		proc.on('error', () => resolve(null))
	})
}

/**
 * @param {Buffer} png
 * @returns {string}
 */
function pngBufferToDataUri(png) {
	return `data:image/png;base64,${png.toString('base64')}`
}

/** @deprecated alias */
const jpegBufferToDataUri = pngBufferToDataUri

/**
 * @param {object} ctx
 * @param {number} channel
 * @param {number} [sourceMtimeMs]
 */
function onComposePreviewUpdated(ctx, channel, sourceMtimeMs) {
	const ch = parseInt(String(channel), 10)
	if (!Number.isFinite(ch) || ch < 1) return Promise.resolve()
	const prev = _inFlight.get(ch)
	if (prev) return prev

	const run = (async () => {
		const cfg = ctx?.config || {}
		if (!isCompanionThumbEnabled(cfg)) return
		const source = cache.resolvePreviewImagePath(cfg, ch)
		if (!source?.path) return
		let st
		try {
			st = await fs.promises.stat(source.path)
		} catch {
			return
		}
		if (st.size < 256) return
		const mtimeMs = sourceMtimeMs ?? st.mtimeMs
		const prevMtime = _lastSourceMtime.get(ch) || 0
		if (mtimeMs <= prevMtime) return

		const png = await resizePreviewToPngBuffer(cfg, source.path, companionThumbSize(cfg))
		if (!png || png.length < 64) {
			if (typeof ctx.log === 'function') {
				ctx.log('warn', `[companion-preview] ch${ch}: ffmpeg resize failed (${source.path})`)
			}
			return
		}

		_lastSourceMtime.set(ch, mtimeMs)
		_lastJpegBuffer.set(ch, png)
		_lastVarMeta.set(ch, { mtimeMs, updatedAt: Date.now(), bytes: png.length })

		const outPath = resolveCompanionThumbOutputPath(cfg, ch)
		if (outPath) {
			try {
				await fs.promises.mkdir(path.dirname(outPath), { recursive: true })
				await fs.promises.writeFile(outPath, png)
			} catch (e) {
				if (typeof ctx.log === 'function') {
					ctx.log('debug', `[companion-preview] ch${ch}: disk write: ${e?.message || e}`)
				}
			}
		}

		const key = getCompanionPreviewVariableKey(ch)
		const dataUri = pngBufferToDataUri(png)
		if (ctx?.state && typeof ctx.state.setVariableImmediate === 'function') {
			ctx.state.setVariableImmediate(key, dataUri)
		} else if (ctx?.state && typeof ctx.state.setVariable === 'function') {
			ctx.state.setVariable(key, dataUri)
		} else if (typeof ctx.log === 'function') {
			ctx.log('warn', `[companion-preview] ch${ch}: ctx.state missing — variable not set`)
		}
	})().finally(() => {
		if (_inFlight.get(ch) === run) _inFlight.delete(ch)
	})

	_inFlight.set(ch, run)
	return run
}

/**
 * Push companion preview variables for all monitored channels (startup / reconnect).
 * @param {object} ctx
 */
async function bootstrapCompanionPreviewVariables(ctx) {
	const cfg = ctx?.config || {}
	if (!isCompanionThumbEnabled(cfg)) return
	for (const ch of resolveMonitoredChannels(cfg)) {
		_lastSourceMtime.delete(ch)
		await onComposePreviewUpdated(ctx, ch)
	}
}

/**
 * @param {object} ctx
 */
function clearCompanionPreviewVariables(ctx) {
	const cfg = ctx?.config || {}
	for (const ch of resolveMonitoredChannels(cfg)) {
		_lastSourceMtime.delete(ch)
		_lastJpegBuffer.delete(ch)
		_lastVarMeta.delete(ch)
		const key = getCompanionPreviewVariableKey(ch)
		if (ctx?.state && typeof ctx.state.setVariableImmediate === 'function') {
			ctx.state.setVariableImmediate(key, '')
		} else if (ctx?.state && typeof ctx.state.setVariable === 'function') {
			ctx.state.setVariable(key, '')
		}
	}
}

/** @deprecated Timer removed — updates are driven by compose preview frame changes. */
function startCompanionThumbTimer(_ctx) {}

/** @deprecated */
function stopCompanionThumbTimer() {
	_inFlight.clear()
}

/**
 * @param {number} channel
 * @returns {Buffer | null}
 */
function getCompanionPreviewJpegBuffer(channel) {
	return _lastJpegBuffer.get(parseInt(String(channel), 10)) || null
}

/**
 * @param {object} config
 */
function getCompanionThumbStats(config) {
	const channels = resolveMonitoredChannels(config || {})
	const byChannel = {}
	for (const ch of channels) {
		const meta = _lastVarMeta.get(ch)
		const outPath = resolveCompanionThumbOutputPath(config, ch)
		let file = null
		if (outPath) {
			try {
				const st = fs.statSync(outPath)
				file = { path: outPath, size: st.size, mtimeMs: st.mtimeMs }
			} catch {
				file = null
			}
		}
		byChannel[ch] = {
			enabled: isCompanionThumbEnabled(config),
			size: companionThumbSize(config),
			variable: getCompanionPreviewVariableKey(ch),
			url: `/api/compose-preview/${ch}/companion.jpg`,
			lastUpdateMs: meta?.updatedAt ?? null,
			lastSourceMtimeMs: meta?.mtimeMs ?? null,
			jpegBytes: meta?.bytes ?? null,
			file,
		}
	}
	return {
		enabled: isCompanionThumbEnabled(config),
		size: companionThumbSize(config),
		mode: 'variable',
		updateRate: 'compose_preview',
		byChannel,
	}
}

module.exports = {
	isCompanionThumbEnabled,
	isCompanionPreviewEnabled,
	companionThumbSize,
	companionThumbIntervalMs,
	getCompanionPreviewVariableKey,
	getCompanionThumbBasename,
	resolveCompanionThumbOutputPath,
	jpegBufferToDataUri,
	pngBufferToDataUri,
	resizePreviewToPngBuffer,
	onComposePreviewUpdated,
	bootstrapCompanionPreviewVariables,
	clearCompanionPreviewVariables,
	startCompanionThumbTimer,
	stopCompanionThumbTimer,
	getCompanionPreviewJpegBuffer,
	getCompanionThumbStats,
}
