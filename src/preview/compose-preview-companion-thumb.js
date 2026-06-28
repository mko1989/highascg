'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const cache = require('./compose-preview-cache')
const { resolveMonitoredChannels } = require('./compose-preview-mode')

/** @type {Map<number, string>} */
const _lastContentHash = new Map()
/** @type {Map<number, Promise<void>>} */
const _inFlight = new Map()
/** @type {Map<number, boolean>} */
const _pendingUpdate = new Map()
/** @type {Map<number, number>} */
const _latestSourceMtime = new Map()
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
	const n = parseInt(String(config?.composePreview?.companionThumbSize ?? 72), 10)
	return Number.isFinite(n) ? Math.max(32, Math.min(512, n)) : 72
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
 * @param {Buffer} buf
 * @returns {string}
 */
function hashJpegBuffer(buf) {
	return crypto.createHash('sha1').update(buf).digest('hex')
}

/**
 * Read Caspar preview JPEG (already thumb-sized when companionThumbEnabled).
 * @param {string} filePath
 * @returns {Promise<Buffer | null>}
 */
async function readPreviewJpeg(filePath) {
	try {
		const buf = await fs.promises.readFile(filePath)
		return buf.length >= 64 ? buf : null
	} catch {
		return null
	}
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
		const errChunks = []
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
				'mjpeg',
				'-q:v',
				'6',
				'pipe:1',
			],
			{ stdio: ['ignore', 'pipe', 'pipe'] },
		)
		proc.stdout.on('data', (chunk) => chunks.push(chunk))
		proc.stderr.on('data', (chunk) => errChunks.push(chunk))
		proc.on('close', (code) => {
			if (code === 0 && chunks.length) resolve(Buffer.concat(chunks))
			else {
				if (errChunks.length) proc._stderr = Buffer.concat(errChunks).toString('utf8').trim()
				resolve(null)
			}
		})
		proc.on('error', () => resolve(null))
	})
}

/**
 * @param {Buffer} img
 * @returns {string}
 */
function jpegBufferToDataUri(img) {
	return `data:image/jpeg;base64,${img.toString('base64')}`
}

/**
 * @param {object} ctx
 * @param {number} channel
 * @param {number} [sourceMtimeMs]
 */
async function processCompanionPreviewFrame(ctx, channel, sourceMtimeMs) {
	const ch = parseInt(String(channel), 10)
	const cfg = ctx?.config || {}
	if (!isCompanionThumbEnabled(cfg)) return
	const source = cache.resolvePreviewImagePath(cfg, ch)
	if (!source?.path) return

	let jpeg = await readPreviewJpeg(source.path)
	if (!jpeg) return

	const hash = hashJpegBuffer(jpeg)
	if (hash === _lastContentHash.get(ch)) return
	_lastContentHash.set(ch, hash)

	_lastJpegBuffer.set(ch, jpeg)
	_lastVarMeta.set(ch, {
		mtimeMs: sourceMtimeMs ?? Date.now(),
		updatedAt: Date.now(),
		bytes: jpeg.length,
	})

	const outPath = resolveCompanionThumbOutputPath(cfg, ch)
	if (outPath) {
		void fs.promises
			.mkdir(path.dirname(outPath), { recursive: true })
			.then(() => fs.promises.writeFile(outPath, jpeg))
			.catch(() => {})
	}

	const key = getCompanionPreviewVariableKey(ch)
	const dataUri = jpegBufferToDataUri(jpeg)
	const { splitCompanionThumbQuadrants, quadrantVariableKey } = require('./compose-preview-companion-quadrants')
	const quads = splitCompanionThumbQuadrants(jpeg)
	/** @type {Record<string, string>} */
	const batch = { [key]: dataUri }
	for (const [quad, uri] of Object.entries(quads)) {
		if (uri) batch[quadrantVariableKey(ch, quad)] = uri
	}
	if (ctx?.state && typeof ctx.state.setVariablesImmediate === 'function') {
		ctx.state.setVariablesImmediate(batch)
	} else if (ctx?.state && typeof ctx.state.setVariableImmediate === 'function') {
		for (const [k, v] of Object.entries(batch)) {
			ctx.state.setVariableImmediate(k, v)
		}
	} else if (ctx?.state && typeof ctx.state.setVariable === 'function') {
		for (const [k, v] of Object.entries(batch)) {
			ctx.state.setVariable(k, v)
		}
	} else if (typeof ctx.log === 'function') {
		ctx.log('warn', `[companion-preview] ch${ch}: ctx.state missing — variable not set`)
	}
}

/**
 * Drain pending updates for a channel (latest-wins while in flight).
 * @param {object} ctx
 * @param {number} channel
 */
async function drainCompanionPreviewUpdates(ctx, channel) {
	const ch = parseInt(String(channel), 10)
	while (_pendingUpdate.get(ch)) {
		_pendingUpdate.set(ch, false)
		const mtimeMs = _latestSourceMtime.get(ch)
		await processCompanionPreviewFrame(ctx, ch, mtimeMs)
	}
	_inFlight.delete(ch)
}

/**
 * @param {object} ctx
 * @param {number} channel
 * @param {number} [sourceMtimeMs]
 */
function onComposePreviewUpdated(ctx, channel, sourceMtimeMs) {
	const ch = parseInt(String(channel), 10)
	if (!Number.isFinite(ch) || ch < 1) return Promise.resolve()

	if (sourceMtimeMs != null) _latestSourceMtime.set(ch, sourceMtimeMs)
	_pendingUpdate.set(ch, true)
	const existing = _inFlight.get(ch)
	if (existing) return existing

	const run = drainCompanionPreviewUpdates(ctx, ch).catch(() => {
		_inFlight.delete(ch)
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
		_lastContentHash.delete(ch)
		await onComposePreviewUpdated(ctx, ch)
	}
}

/**
 * @param {object} ctx
 */
function clearCompanionPreviewVariables(ctx) {
	const cfg = ctx?.config || {}
	for (const ch of resolveMonitoredChannels(cfg)) {
		_lastContentHash.delete(ch)
		_lastJpegBuffer.delete(ch)
		_lastVarMeta.delete(ch)
		_pendingUpdate.delete(ch)
		_latestSourceMtime.delete(ch)
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
	_pendingUpdate.clear()
	_latestSourceMtime.clear()
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
	resizePreviewToPngBuffer,
	onComposePreviewUpdated,
	bootstrapCompanionPreviewVariables,
	clearCompanionPreviewVariables,
	startCompanionThumbTimer,
	stopCompanionThumbTimer,
	getCompanionPreviewJpegBuffer,
	getCompanionThumbStats,
}
