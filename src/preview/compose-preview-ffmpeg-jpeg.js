'use strict'

const cache = require('./compose-preview-cache')
const consumer = require('./compose-preview-consumer')
const receiver = require('./compose-preview-receiver')
const {
	isFfmpegJpegComposePreview,
	resolveMonitoredChannels,
} = require('./compose-preview-mode')

/** @type {NodeJS.Timeout | null} */
let _watchTimer = null
/** @type {Map<number, number>} */
const _lastMtime = new Map()

/**
 * @param {object} ctx
 */
function startFfmpegJpegComposePreview(ctx) {
	stopFfmpegJpegComposePreview(ctx)
	if (!isFfmpegJpegComposePreview(ctx?.config)) return
	void cache.ensurePreviewDir(ctx.config).catch(() => {})
	const cp = ctx.config?.composePreview || {}
	const channels = resolveMonitoredChannels(ctx.config)
	ctx.log?.(
		'info',
		`[compose-preview] ffmpeg_jpeg starting (channels=${channels.join(',')}, fps=${cp.fps ?? 2}, scale=${cp.resolutionScale ?? 'half'}, udp+receiver)`,
	)
	receiver.startAllComposePreviewReceivers(ctx)
	void consumer.attachAllComposeFileConsumers(ctx).then(() => {
		startMtimeWatch(ctx)
	})
}

/**
 * @param {object} [ctx]
 */
async function stopFfmpegJpegComposePreview(ctx) {
	if (_watchTimer) {
		clearInterval(_watchTimer)
		_watchTimer = null
	}
	_lastMtime.clear()
	if (ctx) {
		await consumer.detachAllComposeFileConsumers(ctx)
		receiver.stopAllComposePreviewReceivers(ctx)
		ctx.log?.('debug', '[compose-preview] ffmpeg_jpeg stopped')
	} else {
		consumer.resetComposeConsumerState()
		receiver.resetComposeReceiverState()
	}
}

/**
 * @param {object} ctx
 */
function startMtimeWatch(ctx) {
	if (_watchTimer) return
	_watchTimer = setInterval(() => {
		void pollMtimeAndBroadcast(ctx)
	}, 150)
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
		receivers: receiver.getComposeReceiverStats(config),
		consumers: consumer.getComposeConsumerStats(config),
	}
}

module.exports = {
	startFfmpegJpegComposePreview,
	stopFfmpegJpegComposePreview,
	getFfmpegJpegComposePreviewStats,
}
