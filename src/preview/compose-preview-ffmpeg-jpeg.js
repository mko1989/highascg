'use strict'

const cache = require('./compose-preview-cache')
const consumer = require('./compose-preview-consumer')
const companionThumb = require('./compose-preview-companion-thumb')
const composeActivity = require('./compose-preview-activity')
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
/** Deferred broadcast while channel is settling (WO-110). @type {Map<number, number>} */
const _deferredMtime = new Map()
/** Serializes start/stop so async stop cannot kill receivers after a overlapping start. */
let _lifecycleChain = Promise.resolve()
/**
 * Signature of the currently running consumer setup. Config saves trigger subsystem
 * reloads several times per show; a REMOVE/ADD FILE cycle on the live PGM channel
 * causes a visible output hitch, so restarts are skipped when nothing relevant changed.
 * @type {string | null}
 */
let _runningSignature = null

/**
 * @param {object} [config]
 * @returns {string | null}
 */
function computeComposeRunSignature(config) {
	if (!isFfmpegJpegComposePreview(config)) return null
	const cp = config?.composePreview || {}
	const channelParts = resolveMonitoredChannels(config).map(
		(ch) => `${ch}:${consumer.buildComposeFileAddParams(config, ch)}`,
	)
	const thumb = companionThumb.isCompanionThumbEnabled(config)
		? `on:${cp.companionThumbSize ?? ''}`
		: 'off'
	return `${channelParts.join('|')};poll=${resolveMtimePollMs(config)};thumb=${thumb}`
}

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
	_runningSignature = null
	if (_watchTimer) {
		clearInterval(_watchTimer)
		_watchTimer = null
	}
	companionThumb.stopCompanionThumbTimer()
	companionThumb.clearCompanionPreviewVariables(ctx)
	_lastMtime.clear()
	_deferredMtime.clear()
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
		const wantFfmpeg = isFfmpegJpegComposePreview(ctx?.config)
		const sig = computeComposeRunSignature(ctx?.config)
		if (
			wantFfmpeg &&
			sig &&
			sig === _runningSignature &&
			_watchTimer &&
			consumer.allComposeConsumersAttached(ctx?.config)
		) {
			ctx?.log?.('debug', '[compose-preview] ffmpeg_jpeg unchanged — skipping consumer recycle')
			return
		}
		await stopFfmpegJpegComposePreviewInternal(ctx)
		if (!wantFfmpeg) {
			ctx?.log?.('debug', '[compose-preview] ffmpeg_jpeg not enabled after stop — skip attach')
			return
		}
		if (!ctx?.amcp?.isConnected) {
			ctx?.log?.('warn', '[compose-preview] ffmpeg_jpeg start skipped — AMCP not connected')
			return
		}
		await cache.ensurePreviewDir(ctx.config).catch(() => {})
		const cp = ctx.config?.composePreview || {}
		const channels = resolveMonitoredChannels(ctx.config)
		ctx.log?.(
			'info',
			`[compose-preview] ffmpeg_jpeg starting (channels=${channels.join(',')}, fps=${cp.fps ?? 2}, scale=${cp.resolutionScale ?? 'half'}, companionThumb=${cp.companionThumbEnabled ? cp.companionThumbSize ?? 144 : 'off'}, pollMs=${resolveMtimePollMs(ctx.config)}, direct FILE)`,
		)
		await consumer.attachAllComposeFileConsumers(ctx)
		startMtimeWatch(ctx)
		_runningSignature = sig
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
 * Poll interval aligned with compose preview fps (25 fps → 40 ms).
 * @param {object} [config]
 * @returns {number}
 */
function resolveMtimePollMs(config) {
	const cp = config?.composePreview || {}
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
 * @param {object} cfg
 * @param {number} ch
 * @param {{ format: string, path: string }} resolved
 * @param {import('fs').Stats} st
 */
function broadcastComposePreviewFrame(ctx, cfg, ch, resolved, st) {
	_lastMtime.set(ch, st.mtimeMs)
	_deferredMtime.delete(ch)
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
			const deferred = _deferredMtime.get(ch) || 0
			const hasNewFrame = st.mtimeMs > prev
			const hasDeferred = deferred > 0

			if (!hasNewFrame && !hasDeferred) continue

			if (!composeActivity.isComposePreviewSettled(ch)) {
				if (hasNewFrame) _deferredMtime.set(ch, Math.max(deferred, st.mtimeMs))
				continue
			}

			const mtimeMs = Math.max(st.mtimeMs, deferred)
			if (mtimeMs <= prev) {
				_deferredMtime.delete(ch)
				continue
			}

			broadcastComposePreviewFrame(ctx, cfg, ch, resolved, { ...st, mtimeMs })
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
