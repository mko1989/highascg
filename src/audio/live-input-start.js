'use strict'

/**
 * Per-input capture START (the missing half of the inspector's Stop).
 *
 * The mixer's live-input strips, the live-audio inspector and the Sources > Live tiles could all
 * STOP an input's capture producer on its dedicated channel, but nothing could start ONE input
 * again: the only start paths were the whole-rig `/api/audio/live-inputs/apply` (which re-PLAYs
 * every configured slot and re-applies every always-on PGM route — a glitch on inputs that are
 * still on air) and a Caspar restart. This module starts exactly one input.
 *
 * `resolveInputStartPlan` is pure (config in, plan out) so the offline smokes can exercise the
 * stop -> start round trip without AMCP.
 */

const { listConfiguredLiveAudioSlots } = require('../config/live-audio-input')
const routingMap = require('../config/routing-map')

/** Input kinds whose capture producer this box knows how to (re)start on its own channel. */
const INPUT_START_KINDS = Object.freeze(['live_audio', 'decklink'])

/** @param {string | null | undefined} kind */
function inputStartSupported(kind) {
	return INPUT_START_KINDS.includes(String(kind || '').trim())
}

/**
 * @param {{ kind?: string, slot?: number | string } | null | undefined} req
 * @returns {{ ok: true, kind: string, slot: number } | { ok: false, reason: string }}
 */
function normalizeInputStartRequest(req) {
	const kind = String(req?.kind ?? 'live_audio').trim() || 'live_audio'
	if (!inputStartSupported(kind)) return { ok: false, reason: 'unsupported_kind' }
	const slot = parseInt(String(req?.slot), 10)
	if (!Number.isFinite(slot) || slot < 1) return { ok: false, reason: 'invalid_slot' }
	return { ok: true, kind, slot }
}

/**
 * @param {object} cfg
 * @param {{ kind?: string, slot?: number | string }} req
 * @returns {{ ok: true, kind: string, slot: number, channel: number, layer: number, clip?: string, device?: number, alsaSlot?: object }
 *   | { ok: false, reason: string }}
 */
function resolveInputStartPlan(cfg, req) {
	const norm = normalizeInputStartRequest(req)
	if (!norm.ok) return norm

	if (norm.kind === 'live_audio') {
		const { slots } = listConfiguredLiveAudioSlots(cfg)
		const entry = slots.find((s) => Number(s?.slot) === norm.slot)
		if (!entry) return { ok: false, reason: 'slot_not_configured' }
		const channel = Number(entry.channel)
		const layer = Number(entry.layer)
		if (!Number.isFinite(channel) || !Number.isFinite(layer)) return { ok: false, reason: 'no_dedicated_channel' }
		return {
			ok: true,
			kind: 'live_audio',
			slot: norm.slot,
			channel,
			layer,
			clip: entry.clip,
			alsaSlot: { slot: norm.slot, channel, layer, clip: entry.clip },
		}
	}

	const map = routingMap.getChannelMap(cfg)
	const inputs = Array.isArray(map?.inputChannels) ? map.inputChannels : []
	const entry = inputs.find((e) => e && e.kind === 'decklink' && Number(e.slot) === norm.slot)
	const channel = Number(entry?.channel)
	if (!entry || !Number.isFinite(channel)) return { ok: false, reason: 'slot_not_configured' }
	const layer = Number.isFinite(Number(entry.layer)) ? Number(entry.layer) : norm.slot
	const device = routingMap.resolveDecklinkInputDeviceIndex(cfg, norm.slot)
	if (!Number.isFinite(Number(device)) || Number(device) < 1) return { ok: false, reason: 'no_device_configured' }
	return { ok: true, kind: 'decklink', slot: norm.slot, channel, layer, device: Number(device) }
}

/** HTTP status for a plan/start failure — bad request vs. unconfigured rig vs. Caspar down. */
function inputStartFailureStatus(reason) {
	if (reason === 'unsupported_kind' || reason === 'invalid_slot') return 400
	if (reason === 'amcp_disconnected') return 503
	if (reason === 'slot_not_configured' || reason === 'no_dedicated_channel' || reason === 'no_device_configured') {
		return 409
	}
	return 502
}

/**
 * Drop a now-running slot from the recorded live-audio failure list so the inspector stops
 * showing "PLAY failed" for an input the operator just brought back.
 * @param {object} ctx
 * @param {number} slot
 * @param {{ ok: boolean, reason?: string, channel?: number, layer?: number, clip?: string }} res
 */
function recordLiveAudioSlotStart(ctx, slot, res) {
	const cur = ctx?._liveAudioInputsStatus
	if (!cur || typeof cur !== 'object') return
	const failed = Array.isArray(cur.failed) ? cur.failed.filter((f) => Number(f?.slot) !== Number(slot)) : []
	if (!res.ok) {
		failed.push({
			slot,
			channel: res.channel,
			layer: res.layer,
			clip: res.clip,
			message: res.reason || 'play_failed',
		})
	}
	ctx._liveAudioInputsStatus = { ...cur, updatedAt: Date.now(), failed }
}

/**
 * Start (or restart) one input's capture producer on its own dedicated channel.
 * @param {object} ctx
 * @param {{ kind?: string, slot?: number | string }} req
 */
async function startInputCapture(ctx, req) {
	const plan = resolveInputStartPlan(ctx?.config, req)
	if (!plan.ok) return { ...plan, status: inputStartFailureStatus(plan.reason) }
	if (!ctx?.amcp) return { ok: false, reason: 'amcp_disconnected', status: 503 }

	if (plan.kind === 'live_audio') {
		const { playLiveAlsaClipWithRecovery } = require('./live-audio-health')
		const res = await playLiveAlsaClipWithRecovery(ctx, plan.alsaSlot, { log: true })
		recordLiveAudioSlotStart(ctx, plan.slot, { ...res, channel: plan.channel, layer: plan.layer, clip: plan.clip })
		if (!res.ok) return { ok: false, reason: res.reason || 'play_failed', status: 502, ...planShape(plan) }
		return { ok: true, ...planShape(plan), clip: res.clip ?? plan.clip, status: 200 }
	}

	const { tryPlayDecklinkInput } = require('../config/routing-setup')
	const cl = `${plan.channel}-${plan.layer}`
	try {
		await ctx.amcp.raw(`STOP ${cl}`)
	} catch (_) {
		/* a layer that is already empty is a fine starting point */
	}
	try {
		await ctx.amcp.raw(`MIXER ${cl} CLEAR`)
	} catch (_) {
		/* ditto */
	}
	const res = await tryPlayDecklinkInput(ctx, { channel: plan.channel, layer: plan.layer, device: plan.device })
	if (!res.ok) {
		return { ok: false, reason: res.entry?.message || 'play_failed', status: 502, ...planShape(plan) }
	}
	return { ok: true, ...planShape(plan), status: 200 }
}

/** @param {object} plan */
function planShape(plan) {
	return { kind: plan.kind, slot: plan.slot, channel: plan.channel, layer: plan.layer }
}

module.exports = {
	INPUT_START_KINDS,
	inputStartSupported,
	normalizeInputStartRequest,
	resolveInputStartPlan,
	inputStartFailureStatus,
	startInputCapture,
}
