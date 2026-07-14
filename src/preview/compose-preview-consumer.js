'use strict'

const fs = require('fs')
const cache = require('./compose-preview-cache')
const blocklist = require('./compose-preview-blocklist')
const {
	casparUdpStreamUriVariantsForRemove,
	getActiveStreamUris,
} = require('../streaming/caspar-ffmpeg-setup')
const {
	buildComposeFfmpegConsumerArgs,
	getComposePreviewJpgAmcpPath,
	getComposePreviewJpgBasename,
} = require('./compose-preview-ffmpeg-args')
const {
	isFfmpegJpegComposePreview,
	resolveMonitoredChannels,
} = require('./compose-preview-mode')

/** Dedicated AMCP slot for compose preview FILE (jpeg) consumer. */
const COMPOSE_FILE_CONSUMER_INDEX = 701
/** Legacy slots — removed on attach/detach when migrating older installs. */
const LEGACY_COMPOSE_CONSUMER_INDICES = [98, 700]
/** Stale UDP compose preview STREAM consumers (52100 + channel). */
const LEGACY_COMPOSE_UDP_PORT_BASE = 52100

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

/** @type {Map<number, { attached: boolean, signature?: string, lastError?: string, attachedAt?: number }>} */
const _channels = new Map()

/**
 * Legacy-index cleanup (REMOVE 98/700 + stale UDP STREAM) runs once per channel per
 * process instead of on every recycle (WO-144 T144.3 — was constant benign REMOVE noise).
 * @type {Set<number>}
 */
const _legacySweptChannels = new Set()

/**
 * Per-channel consumer signature = the exact ADD FILE params. Attach/detach is
 * diff-based against this (WO-144 T144.2) so an unchanged channel — especially the
 * on-air PGM channel — is never recycled (REMOVE/ADD causes a visible output hitch).
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

/**
 * Truncate `chN.jpg` to 0 bytes so the serve gates (`size <= 32` in
 * compose-preview-cache) return 404 instead of painting a stale frame (WO-159 T159.1).
 * Called on blocklist and on detach without replacement.
 * @param {object} config
 * @param {number} channel
 */
function truncateComposePreviewJpg(config, channel) {
	const outPath = cache.resolvePreviewJpgOutputPath(config, channel)
	if (!outPath) return
	try {
		if (fs.existsSync(outPath)) fs.truncateSync(outPath, 0)
	} catch {
		/* ok */
	}
}

/** @type {Set<number>} */
const _everAttachedChannels = new Set()

/**
 * Remove legacy consumer slots (98/700) + stale UDP STREAM consumers left by older
 * installs. Gated to once per channel per process (WO-144).
 * @param {object} ctx
 * @param {number} ch
 */
async function sweepLegacyComposeConsumers(ctx, ch) {
	if (_legacySweptChannels.has(ch)) return
	_legacySweptChannels.add(ch)
	if (!ctx?.amcp?.isConnected) return
	if (ctx.amcp.basic?.remove) {
		for (const idx of LEGACY_COMPOSE_CONSUMER_INDICES) {
			try {
				await ctx.amcp.basic.remove(ch, null, idx)
			} catch {
				/* ok if absent */
			}
		}
	}
	const legacyPort = LEGACY_COMPOSE_UDP_PORT_BASE + ch
	const variants = casparUdpStreamUriVariantsForRemove(legacyPort)
	try {
		const active = await getActiveStreamUris(ctx.amcp, ch)
		for (const u of active) {
			if (variants.includes(u) || u.includes(`:${legacyPort}`)) {
				try {
					await ctx.amcp.raw(`REMOVE ${ch} STREAM ${u}`)
				} catch {
					/* ok */
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
async function removeComposeConsumers(ctx, channel) {
	if (!ctx?.amcp?.isConnected) return
	const ch = parseInt(String(channel), 10)
	await sweepLegacyComposeConsumers(ctx, ch)
	if (ctx.amcp.basic?.remove) {
		try {
			await ctx.amcp.basic.remove(ch, null, COMPOSE_FILE_CONSUMER_INDEX)
		} catch {
			/* ok if absent */
		}
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
	const params = buildComposeFileAddParams(cfg, ch)
	if (blocklist.isComposeChannelBlocklisted(ch, params)) {
		ctx.log?.('debug', `[compose-preview] ch${ch} blocklisted — skipping ADD (preview unavailable)`)
		return
	}
	if (blocklist.isComposeChannelBlocklisted(ch)) {
		// Signature changed since rejection — config change re-arms one probe.
		blocklist.clearComposeChannelBlocklist(ch)
		blocklist.broadcastComposeBlocklistChange(ctx, ch, false)
		ctx.log?.('info', `[compose-preview] ch${ch} blocklist cleared (consumer args changed) — reprobing`)
	}
	await ensureComposePreviewJpgStub(cfg, ch)
	await removeComposeConsumers(ctx, ch)
	await delay(150)
	try {
		const res = await ctx.amcp.basic.add(ch, 'FILE', params, COMPOSE_FILE_CONSUMER_INDEX)
		if (res && res.ok === false) {
			throw new Error(res.error || res.data || 'ADD FILE failed')
		}
		_channels.set(ch, { attached: true, signature: params, attachedAt: Date.now(), lastError: undefined })
		_everAttachedChannels.add(ch)
		ctx.log?.(
			'info',
			`[compose-preview] ch${ch} FILE consumer → ${getComposePreviewJpgBasename(cfg, ch)} (direct image2)`,
		)
	} catch (e) {
		const msg = e?.message || String(e)
		_channels.set(ch, { attached: false, lastError: msg })
		if (blocklist.isPermanentAddRejection(msg)) {
			blocklist.blocklistComposeChannel(ch, { reason: msg, signature: params })
			// Stale on-disk frame would otherwise be served forever (WO-159 T159.1).
			truncateComposePreviewJpg(cfg, ch)
			blocklist.broadcastComposeBlocklistChange(ctx, ch, true, msg)
			ctx.log?.(
				'warn',
				`[compose-preview] ch${ch} ADD FILE rejected (${msg}) — blocklisted, preview unavailable on ch ${ch} until config change or restart`,
			)
		} else {
			ctx.log?.('warn', `[compose-preview] ch${ch} ADD FILE failed: ${msg}`)
		}
	}
}

/**
 * Diff-based reconcile of desired vs running FILE consumers (WO-144 T144.2).
 * Only channels whose ADD params changed (or that are new/missing) get REMOVE/ADD;
 * channels with an unchanged signature — including the on-air PGM channel — produce
 * zero AMCP commands. Blocklisted channels are not retried while their signature
 * is unchanged.
 * @param {object} ctx
 * @returns {Promise<{ attached: number, detached: number, unchanged: number, blocked: number }>}
 */
async function syncComposeFileConsumers(ctx) {
	const out = { attached: 0, detached: 0, unchanged: 0, blocked: 0 }
	if (!isFfmpegJpegComposePreview(ctx?.config)) return out
	if (!ctx?.amcp?.isConnected) return out
	const cfg = ctx.config || {}
	const desired = resolveMonitoredChannels(cfg)
	const desiredSet = new Set(desired)
	const known = new Set([..._channels.keys(), ..._everAttachedChannels])
	for (const ch of known) {
		if (desiredSet.has(ch)) continue
		await removeComposeConsumers(ctx, ch)
		// Detach without replacement — clear the last frame so it cannot go stale (WO-159 T159.1).
		truncateComposePreviewJpg(cfg, ch)
		_channels.delete(ch)
		_everAttachedChannels.delete(ch)
		out.detached++
	}
	for (const ch of desired) {
		const sig = buildComposeFileAddParams(cfg, ch)
		const st = _channels.get(ch)
		if (st?.attached && st.signature === sig) {
			out.unchanged++
			continue
		}
		if (blocklist.isComposeChannelBlocklisted(ch, sig)) {
			out.blocked++
			continue
		}
		await attachComposeFileConsumer(ctx, ch)
		if (_channels.get(ch)?.attached) out.attached++
		else if (blocklist.isComposeChannelBlocklisted(ch)) out.blocked++
	}
	return out
}

/**
 * @param {object} ctx
 */
async function attachAllComposeFileConsumers(ctx) {
	if (!isFfmpegJpegComposePreview(ctx?.config)) return
	if (!ctx?.amcp?.isConnected) return
	await syncComposeFileConsumers(ctx)
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
			// No replacement follows — leave a 0-byte stub, not a stale frame (WO-159 T159.1).
			truncateComposePreviewJpg(ctx?.config || {}, ch)
		}
	}
	_channels.clear()
	_everAttachedChannels.clear()
	if (ctx) ctx.log?.('debug', '[compose-preview] FILE consumers removed')
}

/**
 * True when every monitored channel is settled: FILE consumer attached with the
 * current signature, or blocklisted for the current signature (nothing to retry).
 * @param {object} config
 * @returns {boolean}
 */
function composeConsumersSettled(config) {
	const channels = resolveMonitoredChannels(config || {})
	if (!channels.length) return false
	return channels.every((ch) => {
		const sig = buildComposeFileAddParams(config, ch)
		const st = _channels.get(ch)
		if (st?.attached && st.signature === sig) return true
		return blocklist.isComposeChannelBlocklisted(ch, sig)
	})
}

/**
 * True when the channel's FILE consumer is currently attached (live-writing chN.jpg).
 * Used by the meta staleness gate (WO-159 T159.1).
 * @param {number} channel
 * @returns {boolean}
 */
function isComposeConsumerAttached(channel) {
	return !!_channels.get(parseInt(String(channel), 10))?.attached
}

/**
 * True when every monitored channel currently has its FILE consumer attached.
 * @param {object} config
 * @returns {boolean}
 */
function allComposeConsumersAttached(config) {
	const channels = resolveMonitoredChannels(config || {})
	if (!channels.length) return false
	return channels.every((ch) => !!_channels.get(ch)?.attached)
}

function getComposeConsumerStats(config) {
	const channels = resolveMonitoredChannels(config || {})
	const byChannel = {}
	for (const ch of channels) {
		const st = _channels.get(ch) || { attached: false }
		const resolved = cache.resolvePreviewImagePath(config, ch)
		const blockEntry = blocklist.getComposeBlocklistEntry(ch)
		byChannel[ch] = {
			attached: !!st.attached,
			lastError: st.lastError || null,
			attachedAt: st.attachedAt || null,
			blocklisted: !!blockEntry,
			blocklistReason: blockEntry ? blockEntry.reason : null,
			amcpPath: getComposePreviewJpgAmcpPath(config, ch),
			file: resolved ? { format: resolved.format, path: resolved.path } : null,
		}
	}
	return {
		consumerIndex: COMPOSE_FILE_CONSUMER_INDEX,
		transport: 'file_image2',
		blocklistedChannels: blocklist.getComposeBlocklistedChannels(),
		byChannel,
	}
}

function resetComposeConsumerState() {
	_channels.clear()
	_everAttachedChannels.clear()
}

/** Test-only: re-arm the once-per-process legacy sweep. */
function resetComposeLegacySweep() {
	_legacySweptChannels.clear()
}

/**
 * Reconcile consumers after config save / project load / routing shrink.
 * Delegates to the diff-based ffmpeg_jpeg start (zero AMCP traffic when unchanged).
 * @param {object} ctx
 */
async function refreshComposePreviewConsumers(ctx) {
	if (!ctx) return
	const { startFfmpegJpegComposePreview } = require('./compose-preview-ffmpeg-jpeg')
	await startFfmpegJpegComposePreview(ctx)
}

module.exports = {
	COMPOSE_FILE_CONSUMER_INDEX,
	buildComposeFileAddParams,
	attachComposeFileConsumer,
	attachAllComposeFileConsumers,
	syncComposeFileConsumers,
	isComposeConsumerAttached,
	allComposeConsumersAttached,
	truncateComposePreviewJpg,
	composeConsumersSettled,
	detachAllComposeFileConsumers,
	refreshComposePreviewConsumers,
	getComposeConsumerStats,
	resetComposeConsumerState,
	resetComposeLegacySweep,
}
