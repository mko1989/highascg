'use strict'

const cache = require('./compose-preview-cache')
const {
	casparUdpStreamUriVariantsForRemove,
	getActiveStreamUris,
} = require('../streaming/caspar-ffmpeg-setup')
const {
	buildComposeStreamConsumerArgs,
	composePreviewStreamUri,
	composePreviewUdpPort,
	getComposePreviewJpgBasename,
} = require('./compose-preview-ffmpeg-args')
const {
	isFfmpegJpegComposePreview,
	resolveMonitoredChannels,
} = require('./compose-preview-mode')

/** Dedicated AMCP slot for compose preview STREAM (below DMX 97; 701 is ignored by this Caspar build). */
const COMPOSE_FILE_CONSUMER_INDEX = 98
/** Legacy ADD IMAGE slot — remove when switching to ffmpeg_jpeg. */
const COMPOSE_IMAGE_CONSUMER_INDEX = 700

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

/** @type {Map<number, { attached: boolean, lastError?: string, attachedAt?: number }>} */
const _channels = new Map()

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

/** @deprecated use buildComposeStreamAddParams */
function buildComposeFileAddParams(config, channel) {
	return buildComposeStreamAddParams(config, channel)
}

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
		for (const idx of [COMPOSE_FILE_CONSUMER_INDEX, COMPOSE_IMAGE_CONSUMER_INDEX]) {
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
					await ctx.amcp.raw(`REMOVE ${ch}-${COMPOSE_FILE_CONSUMER_INDEX} STREAM ${u}`)
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
	await cache.ensurePreviewDir(cfg).catch(() => {})
	await removeComposeConsumers(ctx, ch)
	await delay(150)
	const params = buildComposeStreamAddParams(cfg, ch)
	try {
		const res = await ctx.amcp.basic.add(ch, 'STREAM', params, COMPOSE_FILE_CONSUMER_INDEX)
		if (res && res.ok === false) {
			throw new Error(res.error || 'ADD STREAM failed')
		}
		_channels.set(ch, { attached: true, attachedAt: Date.now(), lastError: undefined })
		ctx.log?.(
			'info',
			`[compose-preview] ch${ch} STREAM consumer → ${getComposePreviewJpgBasename(cfg, ch)} (udp ${composePreviewUdpPort(ch)})`,
		)
	} catch (e) {
		const msg = e?.message || String(e)
		_channels.set(ch, { attached: false, lastError: msg })
		ctx.log?.('warn', `[compose-preview] ch${ch} ADD STREAM failed: ${msg}`)
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
	if (!ctx?.amcp?.isConnected) {
		_channels.clear()
		return
	}
	const channels = [..._channels.keys()]
	if (channels.length === 0) {
		for (const ch of resolveMonitoredChannels(ctx?.config || {})) {
			await removeComposeConsumers(ctx, ch)
		}
	} else {
		for (const ch of channels) {
			await removeComposeConsumers(ctx, ch)
		}
	}
	_channels.clear()
	if (ctx) ctx.log?.('debug', '[compose-preview] STREAM consumers removed')
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
			udpPort: composePreviewUdpPort(ch),
			file: resolved ? { format: resolved.format, path: resolved.path } : null,
		}
	}
	return { consumerIndex: COMPOSE_FILE_CONSUMER_INDEX, transport: 'udp_stream', byChannel }
}

function resetComposeConsumerState() {
	_channels.clear()
}

module.exports = {
	COMPOSE_FILE_CONSUMER_INDEX,
	COMPOSE_IMAGE_CONSUMER_INDEX,
	buildComposeStreamAddParams,
	buildComposeFileAddParams,
	attachComposeFileConsumer,
	attachAllComposeFileConsumers,
	detachAllComposeFileConsumers,
	getComposeConsumerStats,
	resetComposeConsumerState,
}
