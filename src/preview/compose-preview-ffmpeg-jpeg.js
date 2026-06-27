'use strict'

const cache = require('./compose-preview-cache')
const consumer = require('./compose-preview-consumer')
const companionThumb = require('./compose-preview-companion-thumb')
const {
	isFfmpegJpegComposePreview,
	resolveMonitoredChannels,
} = require('./compose-preview-mode')

/** @type {NodeJS.Timeout | null} */
let _watchTimer = null
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
			`[compose-preview] ffmpeg_jpeg starting (channels=${channels.join(',')}, fps=${cp.fps ?? 2}, scale=${cp.resolutionScale ?? 'half'}, direct FILE)`,
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
 * @param {object} ctx
 */
function startMtimeWatch(ctx) {
	if (_watchTimer) return
	_watchTimer = setInterval(() => {
		void pollMtimeAndBroadcast(ctx)
	}, 50)
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
