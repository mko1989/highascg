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
/** Truncation generation counter when stat-ing (WO-198 T198.2) — skip broadcast if changed. @type {Map<number, number>} */
const _statGenerationAt = new Map()
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
 * Diff-based start/reconcile (WO-144 T144.2): never detach-all/attach-all on config
 * save / project load — only channels whose per-channel ADD signature changed are
 * recycled by {@link consumer.syncComposeFileConsumers}. An unchanged on-air PGM
 * channel therefore produces zero REMOVE/ADD (no output hitch).
 * @param {object} ctx
 */
function startFfmpegJpegComposePreview(ctx) {
	return enqueueComposePreviewLifecycle(async () => {
		const wantFfmpeg = isFfmpegJpegComposePreview(ctx?.config)
		if (!wantFfmpeg) {
			await stopFfmpegJpegComposePreviewInternal(ctx)
			ctx?.log?.('debug', '[compose-preview] ffmpeg_jpeg not enabled — stopped')
			return
		}
		if (!ctx?.amcp?.isConnected) {
			ctx?.log?.('warn', '[compose-preview] ffmpeg_jpeg start skipped — AMCP not connected')
			return
		}
		const sig = computeComposeRunSignature(ctx?.config)
		if (sig && sig === _runningSignature && _watchTimer && consumer.composeConsumersSettled(ctx?.config)) {
			ctx?.log?.('debug', '[compose-preview] ffmpeg_jpeg unchanged — skipping consumer recycle')
			return
		}
		await cache.ensurePreviewDir(ctx.config).catch(() => {})
		const cp = ctx.config?.composePreview || {}
		const channels = resolveMonitoredChannels(ctx.config)
		const res = await consumer.syncComposeFileConsumers(ctx)
		pruneMtimeState(channels)
		syncMtimeWatch(ctx)
		_runningSignature = sig
		ctx.log?.(
			'info',
			`[compose-preview] ffmpeg_jpeg sync (channels=${channels.join(',')}, fps=${cp.fps ?? 2}, scale=${cp.resolutionScale ?? 'half'}, companionThumb=${cp.companionThumbEnabled ? cp.companionThumbSize ?? 144 : 'off'}, pollMs=${resolveMtimePollMs(ctx.config)}, attached=${res.attached}, unchanged=${res.unchanged}, detached=${res.detached}, blocked=${res.blocked})`,
		)
		if (companionThumb.isCompanionThumbEnabled(ctx.config)) {
			await companionThumb.bootstrapCompanionPreviewVariables(ctx)
		} else {
			companionThumb.stopCompanionThumbTimer()
			companionThumb.clearCompanionPreviewVariables(ctx)
		}
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
 * Keep the mtime watch running across diff-based reconciles; restart only when the
 * poll interval actually changed.
 * @param {object} ctx
 */
function syncMtimeWatch(ctx) {
	const pollMs = resolveMtimePollMs(ctx?.config)
	if (_watchTimer && _watchPollMs === pollMs) return
	if (_watchTimer) {
		clearInterval(_watchTimer)
		_watchTimer = null
	}
	startMtimeWatch(ctx)
}

/**
 * Drop mtime bookkeeping for channels no longer monitored (routing shrink).
 * @param {number[]} channels
 */
function pruneMtimeState(channels) {
	const keep = new Set(channels)
	for (const ch of [..._lastMtime.keys()]) if (!keep.has(ch)) _lastMtime.delete(ch)
	for (const ch of [..._deferredMtime.keys()]) if (!keep.has(ch)) _deferredMtime.delete(ch)
	for (const ch of [..._statGenerationAt.keys()]) if (!keep.has(ch)) _statGenerationAt.delete(ch)
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
			// 0-byte stub / truncated-on-blocklist file (WO-159 T159.1) — never push it as a
			// frame: the client's etag path would clear its blocklist badge and fetch a 404.
			if (st.size <= 32) continue
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

			// WO-198 T198.2: record the truncation generation at stat time; skip broadcast
			// if it changed before we get here (indicates the file was truncated).
			const genAtStat = consumer.getTruncationGeneration(ch)
			_statGenerationAt.set(ch, genAtStat)

			// Guard 1: check if generation changed since stat (WO-198 T198.2).
			if (consumer.getTruncationGeneration(ch) !== genAtStat) {
				continue
			}

			// Guard 2: re-stat and skip if size changed to <=32 (simpler fallback).
			const reSt = await require('fs').promises.stat(resolved.path)
			if (reSt.size <= 32) {
				continue
			}

			broadcastComposePreviewFrame(ctx, cfg, ch, resolved, { ...reSt, mtimeMs })
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
	resolveMtimePollMs,
}
