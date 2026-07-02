'use strict'

const { amcpInfoText } = require('../streaming/caspar-ffmpeg-setup')
const { listConfiguredLiveAudioSlots, listLiveAudioPlayClipVariants } = require('../config/live-audio-input')
const { isLiveAudioBridgeEnabled, restartLiveAudioBridge } = require('./live-audio-bridge')

const DEFAULT_VERIFY_MS = 450
const DEFAULT_CLEAR_SETTLE_MS = 150

/**
 * Caspar returns PLAY OK before ffmpeg finishes opening; detect dead producers via INFO.
 * @param {string} infoText
 */
function isLiveAlsaLayerHealthy(infoText) {
	const text = String(infoText || '')
	if (!text.trim()) return false
	const isUdpBridge = /udp:\/\/127\.0\.0\.1:\d+/i.test(text)
	if (!/alsa:\/\//i.test(text) && !isUdpBridge) return false
	if (/<type>\s*empty\s*<\/type>/i.test(text)) return false
	if (/\btype\s+empty\b/i.test(text)) return false
	if (/cannot open audio device|device or resource busy|input\/output error|protocol not found/i.test(text)) return false
	if (/non-existing PPS|decode_slice_header error|no frame!/i.test(text)) return false
	if (isUdpBridge) {
		if (!/<type>\s*ffmpeg\s*<\/type>/i.test(text) && !/\btype\s+ffmpeg\b/i.test(text)) return false
		const times = [...text.matchAll(/<time>([^<]+)<\/time>/gi)].map((m) => parseFloat(m[1]))
		const cur = times[0]
		return Number.isFinite(cur) && cur > 0.15
	}
	if (/<type>\s*ffmpeg\s*<\/type>/i.test(text)) return true
	if (/\btype\s+ffmpeg\b/i.test(text)) return true
	if (/\bffmpeg\b/i.test(text) && /alsa:\/\//i.test(text)) return true
	return false
}

/**
 * @param {object} ctx
 * @param {number} channel
 * @param {number} layer
 */
async function isLiveAlsaProducerHealthy(ctx, channel, layer) {
	if (!ctx?.amcp?.isConnected) return false
	try {
		const info = await ctx.amcp.info(channel, layer)
		return isLiveAlsaLayerHealthy(amcpInfoText(info))
	} catch {
		return false
	}
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms))
}

/**
 * CLEAR → PLAY (with fallbacks) → verify INFO. Used at startup and by the health watchdog.
 * @param {object} ctx
 * @param {{ slot: number, channel: number, layer: number, clip?: string }} slot
 * @param {{ verifyMs?: number, clearSettleMs?: number, log?: boolean }} [opts]
 */
async function playLiveAlsaClipWithRecovery(ctx, slot, opts = {}) {
	if (!ctx?.amcp?.isConnected || !slot) return { ok: false, reason: 'amcp_disconnected' }
	const ch = slot.channel
	const layer = slot.layer
	if (!Number.isFinite(ch) || !Number.isFinite(layer)) return { ok: false, reason: 'invalid_slot' }

	const variants =
		opts.clips ||
		(slot.clip ? [slot.clip, ...listLiveAudioPlayClipVariants(ctx.config, slot.slot).filter((c) => c !== slot.clip)] : listLiveAudioPlayClipVariants(ctx.config, slot.slot))
	if (!variants.length) return { ok: false, reason: 'no_clips' }

	const cl = `${ch}-${layer}`
	const verifyMs = opts.verifyMs ?? DEFAULT_VERIFY_MS
	const clearSettleMs = opts.clearSettleMs ?? DEFAULT_CLEAR_SETTLE_MS
	const log = opts.log !== false && typeof ctx.log === 'function'
	const bridgeEnabled = isLiveAudioBridgeEnabled(ctx?.config)

	for (let i = 0; i < variants.length; i++) {
		const clip = variants[i]
		const clipLabel = String(clip).split(/\s+/)[0]
		if (bridgeEnabled) {
			const bridged = await restartLiveAudioBridge(ctx, slot.slot)
			if (!bridged) {
				if (log) ctx.log('warn', `[live-audio] slot ${slot.slot} ffmpeg ALSA bridge failed to start`)
				continue
			}
		}
		try {
			await ctx.amcp.raw(`CLEAR ${cl}`)
		} catch (_) {}
		await sleep(clearSettleMs)
		try {
			await ctx.amcp.raw(`PLAY ${cl} ${clip} LOOP`)
			await ctx.amcp.raw(`MIXER ${cl} VOLUME 1`)
		} catch (e) {
			const msg = e?.message || String(e)
			if (log) ctx.log('warn', `[live-audio] slot ${slot.slot} PLAY ${cl} failed (${clipLabel}): ${msg}`)
			continue
		}
		await sleep(verifyMs)
		if (await isLiveAlsaProducerHealthy(ctx, ch, layer)) {
			if (log) {
				const note = i > 0 ? ` (fallback ${i + 1}/${variants.length})` : ''
				ctx.log('info', `[live-audio] slot ${slot.slot} capture running on ${cl}: ${clipLabel}${note}`)
			}
			return { ok: true, clip, attempt: i + 1, channel: ch, layer }
		}
		if (log) {
			ctx.log(
				'warn',
				`[live-audio] slot ${slot.slot} PLAY OK but producer dead on ${clipLabel} — ${i + 1 < variants.length ? 'trying fallback' : 'no fallbacks left'}`,
			)
		}
	}

	return { ok: false, reason: 'all_variants_failed', channel: ch, layer, variantsTried: variants.length }
}

/**
 * Repair all configured live inputs (meters stale, producer dead, or forced).
 * @param {object} ctx
 * @param {{ force?: boolean, staleMs?: number, slots?: object[] }} [opts]
 */
async function ensureLiveAudioInputsHealthy(ctx, opts = {}) {
	if (!ctx?.amcp?.isConnected) return { ok: false, reason: 'amcp_disconnected' }

	const { slots } = opts.slots ? { slots: opts.slots } : listConfiguredLiveAudioSlots(ctx?.config)
	if (!slots.length) return { ok: true, skipped: 'no_inputs' }

	const staleMs = opts.staleMs ?? 8000
	const now = Date.now()
	const snap = ctx.oscState?.getSnapshot?.()
	const channels = snap?.channels || {}
	const repaired = []
	const failed = []

	for (const slot of slots) {
		const ch = slot.channel
		if (!Number.isFinite(ch)) continue
		const audio = channels[String(ch)]?.audio
		const lastAt = audio?._lastUpdateAt || 0
		const oscStale = !lastAt || now - lastAt > staleMs
		const healthy = await isLiveAlsaProducerHealthy(ctx, ch, slot.layer)

		if (!opts.force && !oscStale && healthy) continue

		const res = await playLiveAlsaClipWithRecovery(ctx, slot, { log: true })
		if (res.ok) repaired.push({ slot: slot.slot, channel: ch, clip: res.clip, attempt: res.attempt })
		else failed.push({ slot: slot.slot, channel: ch, reason: res.reason })
	}

	if (repaired.length && typeof ctx.log === 'function') {
		ctx.log('info', `[live-audio] repaired ${repaired.length} input(s)`)
	}
	if (failed.length && typeof ctx.log === 'function') {
		ctx.log('warn', `[live-audio] failed to start: ${JSON.stringify(failed)}`)
	}

	return { ok: failed.length === 0, repaired, failed }
}

module.exports = {
	isLiveAlsaLayerHealthy,
	isLiveAlsaProducerHealthy,
	playLiveAlsaClipWithRecovery,
	ensureLiveAudioInputsHealthy,
	DEFAULT_VERIFY_MS,
}
