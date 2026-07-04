'use strict'

const { amcpInfoText } = require('../streaming/caspar-ffmpeg-setup')
const { listConfiguredV4l2Slots, listV4l2PlayClipVariants } = require('./v4l2-input-config')
const { isV4l2CaptureBridgeEnabled, restartV4l2InputBridge, stopV4l2InputBridge } = require('./v4l2-input-bridge')

const DEFAULT_VERIFY_MS = 1200
const DEFAULT_CLEAR_SETTLE_MS = 150

function infoHasFfmpegProducer(text) {
	const t = String(text || '')
	return (
		/<type>\s*ffmpeg\s*<\/type>/i.test(t) ||
		/\btype\s+ffmpeg\b/i.test(t) ||
		/<producer>\s*ffmpeg\s*<\/producer>/i.test(t) ||
		/\bproducer\s+ffmpeg\b/i.test(t)
	)
}

function infoForegroundBlock(text) {
	const m = String(text || '').match(/<foreground>[\s\S]*?<\/foreground>/i)
	return m ? m[0] : String(text || '')
}

/**
 * @param {string} infoText
 */
function isV4l2LayerHealthy(infoText) {
	const text = String(infoText || '')
	if (!text.trim()) return false
	const isUdpBridge = /udp:\/\/127\.0\.0\.1:\d+/i.test(text)
	const isV4l2Direct = /v4l2:\/\//i.test(text)
	if (!isUdpBridge && !isV4l2Direct) return false
	const fg = infoForegroundBlock(text)
	if (/<type>\s*empty\s*<\/type>/i.test(fg)) return false
	if (/\btype\s+empty\b/i.test(fg)) return false
	if (/<producer>\s*empty\s*<\/producer>/i.test(fg)) return false
	if (/cannot open|device or resource busy|input\/output error|protocol not found/i.test(text)) return false
	if (/non-existing PPS|decode_slice_header error|no frame!/i.test(text)) return false
	if (!infoHasFfmpegProducer(fg)) return false
	const times = [...fg.matchAll(/<time>([^<]+)<\/time>/gi)].map((m) => parseFloat(m[1]))
	const cur = times[0]
	return Number.isFinite(cur) && cur > 0.15
}

/**
 * @param {object} ctx
 * @param {number} channel
 * @param {number} layer
 */
async function isV4l2ProducerHealthy(ctx, channel, layer) {
	if (!ctx?.amcp?.isConnected) return false
	try {
		const info = await ctx.amcp.info(channel, layer)
		return isV4l2LayerHealthy(amcpInfoText(info))
	} catch {
		return false
	}
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms))
}

/**
 * @param {object} ctx
 * @param {{ slot: number, channel: number, layer: number, clip?: string }} slot
 * @param {{ verifyMs?: number, clearSettleMs?: number, log?: boolean }} [opts]
 */
async function playV4l2ClipWithRecovery(ctx, slot, opts = {}) {
	if (!ctx?.amcp?.isConnected || !slot) return { ok: false, reason: 'amcp_disconnected' }
	const ch = slot.channel
	const layer = slot.layer
	if (!Number.isFinite(ch) || !Number.isFinite(layer)) return { ok: false, reason: 'invalid_slot' }

	const variants =
		opts.clips ||
		(slot.clip
			? [slot.clip, ...listV4l2PlayClipVariants(ctx.config, slot.slot).filter((c) => c !== slot.clip)]
			: listV4l2PlayClipVariants(ctx.config, slot.slot))
	if (!variants.length) return { ok: false, reason: 'no_clips' }

	const cl = `${ch}-${layer}`
	const verifyMs = opts.verifyMs ?? DEFAULT_VERIFY_MS
	const clearSettleMs = opts.clearSettleMs ?? DEFAULT_CLEAR_SETTLE_MS
	const log = opts.log !== false && typeof ctx.log === 'function'
	const bridgeEnabled = isV4l2CaptureBridgeEnabled(ctx?.config)

	if (!bridgeEnabled) stopV4l2InputBridge(slot.slot)

	for (let i = 0; i < variants.length; i++) {
		const clip = variants[i]
		const clipLabel = String(clip).split(/\s+/)[0]
		if (bridgeEnabled) {
			const bridged = await restartV4l2InputBridge(ctx, slot.slot)
			if (!bridged) {
				if (log) ctx.log('warn', `[v4l2-input] slot ${slot.slot} ffmpeg bridge failed to start`)
				continue
			}
		}
		try {
			await ctx.amcp.raw(`CLEAR ${cl}`)
		} catch (_) {}
		await sleep(clearSettleMs)
		try {
			await ctx.amcp.raw(`PLAY ${cl} ${clip} LOOP`)
			await ctx.amcp.raw(`MIXER ${cl} FILL 0 0 1 1`)
		} catch (e) {
			const msg = e?.message || String(e)
			if (log) ctx.log('warn', `[v4l2-input] slot ${slot.slot} PLAY ${cl} failed (${clipLabel}): ${msg}`)
			continue
		}
		await sleep(verifyMs)
		if (await isV4l2ProducerHealthy(ctx, ch, layer)) {
			if (log) {
				const note = i > 0 ? ` (fallback ${i + 1}/${variants.length})` : ''
				ctx.log('info', `[v4l2-input] slot ${slot.slot} capture running on ${cl}: ${clipLabel}${note}`)
			}
			return { ok: true, clip, attempt: i + 1, channel: ch, layer }
		}
		if (log) {
			ctx.log(
				'warn',
				`[v4l2-input] slot ${slot.slot} PLAY OK but producer dead on ${clipLabel} — ${i + 1 < variants.length ? 'trying fallback' : 'no fallbacks left'}`,
			)
		}
	}

	return { ok: false, reason: 'all_variants_failed', channel: ch, layer, variantsTried: variants.length }
}

module.exports = {
	isV4l2LayerHealthy,
	isV4l2ProducerHealthy,
	playV4l2ClipWithRecovery,
	DEFAULT_VERIFY_MS,
}
