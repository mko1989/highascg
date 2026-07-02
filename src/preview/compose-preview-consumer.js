'use strict'

const fs = require('fs')
const cache = require('./compose-preview-cache')
const {
	casparUdpStreamUriVariantsForRemove,
	getActiveStreamUris,
} = require('../streaming/caspar-ffmpeg-setup')
const {
	buildComposeFfmpegConsumerArgs,
	buildComposeStreamConsumerArgs,
	composePreviewStreamUri,
	composePreviewUdpPort,
	getComposePreviewJpgAmcpPath,
	getComposePreviewJpgBasename,
} = require('./compose-preview-ffmpeg-args')
const {
	isFfmpegJpegComposePreview,
	resolveMonitoredChannels,
} = require('./compose-preview-mode')

/** Dedicated AMCP slot for compose preview FILE (jpeg) consumer. */
const COMPOSE_FILE_CONSUMER_INDEX = 701
/** Legacy UDP relay slot — remove when migrating from STREAM fallback. */
const COMPOSE_STREAM_CONSUMER_INDEX = 98
/** Legacy ADD IMAGE slot — remove when switching to ffmpeg_jpeg. */
const COMPOSE_IMAGE_CONSUMER_INDEX = 700

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

/** @type {Map<number, { attached: boolean, lastError?: string, attachedAt?: number }>} */
const _channels = new Map()

/**
 * @param {object} config
 * @param {number} channel
 */
function buildComposeFileAddParams(config, channel) {
	const cp = config?.composePreview || {}
	const path = getComposePreviewJpgAmcpPath(config, channel)
	const args = buildComposeFfmpegConsumerArgs(cp)
	return `${path} ${args}`
}

/**
 * @param {object} config
 * @param {number} channel
 */
function buildComposeStreamAddParams(config, channel) {
	const cp = config?.composePreview || {}
	const uri = composePreviewStreamUri(channel)
	const args = buildComposeStreamConsumerArgs(cp)
	return `${uri} ${args}`
}

/**
 * @param {object} config
 * @param {number} channel
 */
async function ensureComposePreviewJpgStub(config, channel) {
	const outPath = cache.resolvePreviewJpgOutputPath(config, channel)
	if (!outPath) return
	await cache.ensurePreviewDir(config).catch(() => {})
	try {
		if (!fs.existsSync(outPath)) fs.writeFileSync(outPath, Buffer.alloc(0))
	} catch {
		/* ok */
	}
}

/** @type {Set<number>} */
const _everAttachedChannels = new Set()

/**
 * @param {object} ctx
 * @param {number} channel
 */
async function removeComposeConsumers(ctx, channel) {
	if (!ctx?.amcp?.isConnected) return
	const ch = parseInt(String(channel), 10)
	const port = composePreviewUdpPort(ch)
	const variants = casparUdpStreamUriVariantsForRemove(port)
	if (ctx.amcp.basic?.remove) {
		for (const idx of [
			COMPOSE_FILE_CONSUMER_INDEX,
			COMPOSE_STREAM_CONSUMER_INDEX,
			COMPOSE_IMAGE_CONSUMER_INDEX,
		]) {
			try {
				await ctx.amcp.basic.remove(ch, null, idx)
			} catch {
				/* ok if absent */
			}
		}
	}
	try {
		const active = await getActiveStreamUris(ctx.amcp, ch)
		for (const u of active) {
			if (variants.includes(u) || u.includes(`:${port}`)) {
				try {
					await ctx.amcp.raw(`REMOVE ${ch}-${COMPOSE_STREAM_CONSUMER_INDEX} STREAM ${u}`)
				} catch {
					try {
						await ctx.amcp.raw(`REMOVE ${ch} STREAM ${u}`)
					} catch {
						/* ok */
					}
				}
			}
		}
	} catch {
		/* ok */
	}
}

/**
 * @param {object} ctx
 * @param {number} channel
 */
async function attachComposeFileConsumer(ctx, channel) {
	const ch = parseInt(String(channel), 10)
	if (!Number.isFinite(ch) || ch < 1) return
	if (!ctx?.amcp?.isConnected) {
		_channels.set(ch, { attached: false, lastError: 'AMCP not connected' })
		return
	}
	const cfg = ctx.config || {}
	await ensureComposePreviewJpgStub(cfg, ch)
	await removeComposeConsumers(ctx, ch)
	await delay(150)
	const params = buildComposeFileAddParams(cfg, ch)
	try {
		const res = await ctx.amcp.basic.add(ch, 'FILE', params, COMPOSE_FILE_CONSUMER_INDEX)
		if (res && res.ok === false) {
			throw new Error(res.error || 'ADD FILE failed')
		}
		_channels.set(ch, { attached: true, attachedAt: Date.now(), lastError: undefined })
		_everAttachedChannels.add(ch)
		ctx.log?.(
			'info',
			`[compose-preview] ch${ch} FILE consumer → ${getComposePreviewJpgBasename(cfg, ch)} (direct image2)`,
		)
	} catch (e) {
		const msg = e?.message || String(e)
		_channels.set(ch, { attached: false, lastError: msg })
		ctx.log?.('warn', `[compose-preview] ch${ch} ADD FILE failed: ${msg}`)
	}
}

/**
 * @param {object} ctx
 */
async function attachAllComposeFileConsumers(ctx) {
	if (!isFfmpegJpegComposePreview(ctx?.config)) return
	if (!ctx?.amcp?.isConnected) return
	const channels = resolveMonitoredChannels(ctx.config)
	for (const ch of channels) {
		await attachComposeFileConsumer(ctx, ch)
	}
}

/**
 * @param {object} ctx
 */
async function detachAllComposeFileConsumers(ctx) {
	const channels = new Set(_everAttachedChannels)
	for (const ch of _channels.keys()) channels.add(ch)
	for (const ch of resolveMonitoredChannels(ctx?.config || {})) channels.add(ch)
	if (ctx?.amcp?.isConnected) {
		for (const ch of channels) {
			await removeComposeConsumers(ctx, ch)
		}
	}
	_channels.clear()
	_everAttachedChannels.clear()
	if (ctx) ctx.log?.('debug', '[compose-preview] FILE consumers removed')
}

function getComposeConsumerStats(config) {
	const channels = resolveMonitoredChannels(config || {})
	const byChannel = {}
	for (const ch of channels) {
		const st = _channels.get(ch) || { attached: false }
		const resolved = cache.resolvePreviewImagePath(config, ch)
		byChannel[ch] = {
			attached: !!st.attached,
			lastError: st.lastError || null,
			attachedAt: st.attachedAt || null,
			amcpPath: getComposePreviewJpgAmcpPath(config, ch),
			file: resolved ? { format: resolved.format, path: resolved.path } : null,
		}
	}
	return { consumerIndex: COMPOSE_FILE_CONSUMER_INDEX, transport: 'file_image2', byChannel }
}

function resetComposeConsumerState() {
	_channels.clear()
	_everAttachedChannels.clear()
}

/**
 * Drop tracked channels not in the current channel map (e.g. after new project / routing shrink).
 * @param {object} ctx
 */
async function refreshComposePreviewConsumers(ctx) {
	if (!ctx) return
	await detachAllComposeFileConsumers(ctx)
	if (isFfmpegJpegComposePreview(ctx.config)) {
		await attachAllComposeFileConsumers(ctx)
	}
}

module.exports = {
	COMPOSE_FILE_CONSUMER_INDEX,
	COMPOSE_STREAM_CONSUMER_INDEX,
	COMPOSE_IMAGE_CONSUMER_INDEX,
	buildComposeFileAddParams,
	buildComposeStreamAddParams,
	attachComposeFileConsumer,
	attachAllComposeFileConsumers,
	detachAllComposeFileConsumers,
	refreshComposePreviewConsumers,
	getComposeConsumerStats,
	resetComposeConsumerState,
}
