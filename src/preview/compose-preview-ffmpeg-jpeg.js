'use strict'

const cache = require('./compose-preview-cache')
const consumer = require('./compose-preview-consumer')
const companionThumb = require('./compose-preview-companion-thumb')
const {
	isFfmpegJpegComposePreview,
	resolveMonitoredChannels,
} = require('./compose-preview-mode')
const { clampComposePreviewFps } = require('./compose-preview-ffmpeg-args')

/** @type {NodeJS.Timeout | null} */
let _watchTimer = null
/** @type {number} */
let _watchPollMs = 40
/** @type {Map<number, number>} */
const _lastMtime = new Map()
/** Serializes start/stop so async stop cannot kill receivers after a overlapping start. */
let _lifecycleChain = Promise.resolve()

/**
 * @param {() => Promise<void>} fn
 * @returns {Promise<void>}
 */
function enqueueComposePreviewLifecycle(fn) {
	const run = () => fn()
	_lifecycleChain = _lifecycleChain.then(run, run)
	return _lifecycleChain
}

/**
 * @param {object} [ctx]
 */
async function stopFfmpegJpegComposePreviewInternal(ctx) {
	if (_watchTimer) {
		clearInterval(_watchTimer)
		_watchTimer = null
	}
	companionThumb.stopCompanionThumbTimer()
	companionThumb.clearCompanionPreviewVariables(ctx)
	_lastMtime.clear()
	if (ctx) {
		await consumer.detachAllComposeFileConsumers(ctx)
		ctx.log?.('debug', '[compose-preview] ffmpeg_jpeg stopped')
	} else {
		consumer.resetComposeConsumerState()
	}
}

/**
 * @param {object} ctx
 */
function startFfmpegJpegComposePreview(ctx) {
	return enqueueComposePreviewLifecycle(async () => {
		await stopFfmpegJpegComposePreviewInternal(ctx)
		if (!isFfmpegJpegComposePreview(ctx?.config)) return
		await cache.ensurePreviewDir(ctx.config).catch(() => {})
		const cp = ctx.config?.composePreview || {}
		const channels = resolveMonitoredChannels(ctx.config)
		ctx.log?.(
			'info',
			`[compose-preview] ffmpeg_jpeg starting (channels=${channels.join(',')}, fps=${cp.fps ?? 2}, scale=${cp.companionThumbEnabled ? `thumb${cp.companionThumbSize ?? 144}` : cp.resolutionScale ?? 'half'}, pollMs=${resolveMtimePollMs(ctx.config)}, direct FILE)`,
		)
		await consumer.attachAllComposeFileConsumers(ctx)
		startMtimeWatch(ctx)
		await companionThumb.bootstrapCompanionPreviewVariables(ctx)
	})
}

/**
 * @param {object} [ctx]
 */
function stopFfmpegJpegComposePreview(ctx) {
	return enqueueComposePreviewLifecycle(() => stopFfmpegJpegComposePreviewInternal(ctx))
}

/**
 * Poll interval aligned with compose preview fps / tickIntervalMs (25 fps → 40 ms).
 * @param {object} [config]
 * @returns {number}
 */
function resolveMtimePollMs(config) {
	const cp = config?.composePreview || {}
	const tickMs = parseInt(String(cp.tickIntervalMs ?? ''), 10)
	if (Number.isFinite(tickMs) && tickMs >= 40 && tickMs <= 1000) return tickMs
	const fps = clampComposePreviewFps(cp.fps, 25)
	return Math.max(40, Math.floor(1000 / fps))
}

/**
 * @param {object} ctx
 */
function startMtimeWatch(ctx) {
	if (_watchTimer) return
	_watchPollMs = resolveMtimePollMs(ctx?.config)
	_watchTimer = setInterval(() => {
		void pollMtimeAndBroadcast(ctx)
	}, _watchPollMs)
	if (_watchTimer.unref) _watchTimer.unref()
}

/**
 * @param {object} ctx
 */
async function pollMtimeAndBroadcast(ctx) {
	if (!isFfmpegJpegComposePreview(ctx?.config)) return
	const cfg = ctx.config || {}
	for (const ch of resolveMonitoredChannels(cfg)) {
		const resolved = cache.resolvePreviewImagePath(cfg, ch)
		if (!resolved) continue
		try {
			const st = await require('fs').promises.stat(resolved.path)
			const prev = _lastMtime.get(ch) || 0
			if (st.mtimeMs <= prev) continue
			_lastMtime.set(ch, st.mtimeMs)
			if (typeof ctx._wsBroadcast === 'function') {
				ctx._wsBroadcast('compose.preview', {
					channel: ch,
					format: resolved.format,
					etag: cache.etagFromStat(st),
					url: `/api/compose-preview/${ch}.${resolved.format === 'jpeg' ? 'jpg' : 'png'}`,
				})
			}
			if (companionThumb.isCompanionThumbEnabled(cfg)) {
				void companionThumb.onComposePreviewUpdated(ctx, ch, st.mtimeMs)
			}
		} catch {
			/* file not ready */
		}
	}
}

/**
 * @param {object} config
 * @returns {object}
 */
function getFfmpegJpegComposePreviewStats(config) {
	const channels = resolveMonitoredChannels(config)
	const files = {}
	for (const ch of channels) {
		const resolved = cache.resolvePreviewImagePath(config, ch)
		files[ch] = resolved
			? { format: resolved.format, path: resolved.path }
			: { format: null, path: null }
	}
	return {
		mode: 'ffmpeg_jpeg',
		channels,
		pollIntervalMs: _watchPollMs,
		files,
		consumers: consumer.getComposeConsumerStats(config),
		companionThumb: companionThumb.getCompanionThumbStats(config),
	}
}

module.exports = {
	startFfmpegJpegComposePreview,
	stopFfmpegJpegComposePreview,
	getFfmpegJpegComposePreviewStats,
}
