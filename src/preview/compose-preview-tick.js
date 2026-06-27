'use strict'

const dirty = require('./compose-preview-dirty')
const cache = require('./compose-preview-cache')
const activity = require('./compose-preview-activity')
const {
	isCasparImageComposePreview,
	isFfmpegJpegComposePreview,
	isSnapshotComposePreview,
	resolveMonitoredChannels,
} = require('./compose-preview-mode')

/** @type {Map<number, Promise<void>>} */
const _captureLocks = new Map()

let _timer = null
let _stats = { captures: 0, skippedClean: 0, skippedInFlight: 0, errors: 0, lastTickAt: 0 }

const IMAGE_CONSUMER_INDEX = 700

function resolveTickIntervalMs(config) {
	const cp = config?.composePreview || {}
	const fromMs = parseInt(String(cp.tickIntervalMs ?? ''), 10)
	if (Number.isFinite(fromMs) && fromMs >= 100 && fromMs <= 1000) return fromMs
	const hz = Math.max(1, Math.min(20, Number(cp.tickHz) || 8))
	return Math.max(100, Math.min(1000, Math.floor(1000 / hz)))
}

function isComposePreviewEnabled(config) {
	return isCasparImageComposePreview(config)
}

function isComposePreviewTickEnabled(config) {
	return isCasparImageComposePreview(config)
}

/**
 * @param {object} ctx
 * @param {number} channel
 */
async function captureChannelOnce(ctx, channel) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	const cfg = ctx.config || {}
	const tickMs = resolveTickIntervalMs(cfg)

	if (!activity.shouldCaptureOnTick(ctx, ch, tickMs)) {
		_stats.skippedClean += 1
		return
	}

	if (_captureLocks.has(ch)) {
		_stats.skippedInFlight += 1
		return
	}

	const job = (async () => {
		dirty.markCaptureStart(ch)
		const t0 = Date.now()
		try {
			await cache.ensurePreviewDir(cfg)
			const basename = cache.getBasename(cfg, ch)
			const prevPath = cache.resolvePreviewPngPath(cfg, ch)
			let prevMtime = 0
			if (prevPath) {
				try {
					prevMtime = (await require('fs').promises.stat(prevPath)).mtimeMs
				} catch {
					prevMtime = 0
				}
			}

			if (!ctx.amcp?.basic?.addImage) {
				throw new Error('AMCP addImage not available')
			}

			const res = await ctx.amcp.basic.addImage(ch, basename, IMAGE_CONSUMER_INDEX)
			if (res && res.ok === false) {
				throw new Error(res.error || 'ADD IMAGE failed')
			}

			const expected = cache.resolvePreviewPngPath(cfg, ch)
			const sinceMs = Math.max(t0 - 100, prevMtime)
			let stable = expected ? await cache.waitForPngStable(expected, sinceMs) : null
			if (!stable) {
				// File may land slightly after first resolve attempt — poll basename again.
				await new Promise((r) => setTimeout(r, 40))
				const fp2 = cache.resolvePreviewPngPath(cfg, ch)
				if (fp2) stable = await cache.waitForPngStable(fp2, sinceMs, { timeoutMs: 1500 })
			}
			if (!stable) {
				throw new Error('ADD IMAGE produced no stable PNG')
			}

			const hash = await cache.sha256File(stable.path)
			if (hash && hash === dirty.getLastHash(ch)) {
				dirty.clearDirty(ch, hash)
				activity.onCaptureComplete(ctx, ch)
				return
			}
			dirty.clearDirty(ch, hash)
			activity.onCaptureComplete(ctx, ch)
			_stats.captures += 1

			if (typeof ctx._wsBroadcast === 'function') {
				ctx._wsBroadcast('compose.preview', {
					channel: ch,
					etag: cache.etagFromStat(stable.stat),
					url: `/api/compose-preview/${ch}.png`,
				})
			}
		} catch (e) {
			_stats.errors += 1
			dirty.markCaptureFailed(ch, e?.message || String(e))
			ctx.log?.('debug', `[compose-preview] ch${ch} capture: ${e?.message || e}`)
		}
	})()

	_captureLocks.set(ch, job)
	try {
		await job
	} finally {
		_captureLocks.delete(ch)
	}
}

/**
 * @param {object} ctx
 */
async function runComposePreviewTick(ctx) {
	if (!isComposePreviewEnabled(ctx.config)) return
	if (!ctx.amcp) return
	_stats.lastTickAt = Date.now()
	const channels = resolveMonitoredChannels(ctx.config)
	await Promise.all(channels.map((ch) => captureChannelOnce(ctx, ch)))
}

/**
 * @param {object} ctx
 */
function startComposePreviewTick(ctx) {
	stopComposePreviewTick(ctx)
	if (!isComposePreviewTickEnabled(ctx.config)) return
	const ms = resolveTickIntervalMs(ctx.config)
	ctx.log?.('info', `[compose-preview] tick started (${ms} ms, channels=${resolveMonitoredChannels(ctx.config).join(',')})`)
	void cache.ensurePreviewDir(ctx.config).catch(() => {})
	_timer = setInterval(() => {
		void runComposePreviewTick(ctx)
	}, ms)
	if (_timer.unref) _timer.unref()
}

/**
 * @param {object} ctx
 */
function stopComposePreviewTick(ctx) {
	if (_timer) {
		clearInterval(_timer)
		_timer = null
	}
	_captureLocks.clear()
	if (ctx) ctx.log?.('debug', '[compose-preview] tick stopped')
}

function restartComposePreviewTick(ctx) {
	stopComposePreviewTick(ctx)
	dirty.reset()
	activity.reset()
	if (isComposePreviewTickEnabled(ctx?.config)) {
		activity.requestInitialCapture(resolveMonitoredChannels(ctx.config))
		startComposePreviewTick(ctx)
	}
}

function getComposePreviewStats(config) {
	return {
		..._stats,
		tickIntervalMs: resolveTickIntervalMs(config || {}),
		dirty: dirty.getStats(),
		activity: activity.getStats(),
	}
}

module.exports = {
	isComposePreviewEnabled,
	isComposePreviewTickEnabled,
	isFfmpegJpegComposePreview,
	isSnapshotComposePreview,
	resolveMonitoredChannels,
	resolveTickIntervalMs,
	startComposePreviewTick,
	stopComposePreviewTick,
	restartComposePreviewTick,
	runComposePreviewTick,
	getComposePreviewStats,
	bumpDirty: dirty.bumpDirty,
	forceAllDirty: dirty.forceAllDirty,
}
