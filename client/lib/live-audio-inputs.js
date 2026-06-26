/**
 * ALSA / USB live audio inputs — each slot on its own dedicated Caspar channel (WO-53).
 */
import { liveAudioInputForSlot, listInputChannels } from './input-channels.js'

export const LIVE_AUDIO_MAX_SLOTS = 8
/** Default PGM layer for slot N when playing directly on program (slots 1→L1, 2→L2, …). */
export const LIVE_AUDIO_PGM_LAYER_BASE = 1
/** DeckLink / inputs-host route layers (legacy bus — not used for direct ALSA PGM play). */
export const LIVE_AUDIO_LAYER_BASE = 10

/** 1-based slot → layer on shared inputs host channel (DeckLink routes). */
export function liveAudioHostLayer(slot) {
	const n = parseInt(String(slot), 10)
	if (!Number.isFinite(n) || n < 1) return LIVE_AUDIO_LAYER_BASE
	return LIVE_AUDIO_LAYER_BASE + n - 1
}

/** 1-based slot → default layer on program channel for ALSA live audio. */
export function liveAudioPgmLayer(slot) {
	const n = parseInt(String(slot), 10)
	if (!Number.isFinite(n) || n < 1) return LIVE_AUDIO_PGM_LAYER_BASE
	return LIVE_AUDIO_PGM_LAYER_BASE + n - 1
}

/**
 * Route string for ALSA slot — prefer channelMap; legacy inputsCh arg is fallback for slot 1 only.
 * @param {object | number | null | undefined} channelMapOrLegacyCh
 * @param {number} [slot]
 */
export function liveAudioRouteValue(channelMapOrLegacyCh, slot = 1) {
	if (channelMapOrLegacyCh != null && typeof channelMapOrLegacyCh === 'object') {
		return liveAudioInputForSlot(channelMapOrLegacyCh, slot)?.route ?? ''
	}
	const legacyCh = channelMapOrLegacyCh
	if (legacyCh == null) return ''
	const n = Math.max(1, parseInt(String(slot), 10) || 1)
	if (n === 1) return `route://${legacyCh}`
	return ''
}

/**
 * @param {object | null | undefined} liveInputsApi
 */
export function liveAudioApiConfiguredSlice(liveInputsApi) {
	if (!liveInputsApi || typeof liveInputsApi !== 'object') return null
	const c = liveInputsApi.configured
	return c && typeof c === 'object' ? c : null
}

/**
 * Inputs host Caspar channel — channelMap first, then GET /api/audio/live-inputs.
 * @param {object | null | undefined} channelMap
 * @param {object | null | undefined} liveInputsApi
 */
export function resolveInputsHostChannel(channelMap, liveInputsApi) {
	const first = listInputChannels(channelMap)[0]?.channel
	if (first != null) return first
	const raw =
		channelMap?.inputsCh ??
		liveInputsApi?.inputsCh ??
		liveAudioApiConfiguredSlice(liveInputsApi)?.inputsCh ??
		liveInputsApi?.status?.hostingChannel
	const n = parseInt(String(raw ?? ''), 10)
	return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * @param {object | null | undefined} channelMap
 * @param {object | null | undefined} liveInputsApi
 * @param {{ count?: number } | null | undefined} [casparUi]
 */
export function resolveLiveAudioSlotCount(channelMap, liveInputsApi, casparUi) {
	const cfg = liveAudioApiConfiguredSlice(liveInputsApi)
	const slots = Array.isArray(cfg?.slots) ? cfg.slots : []
	const activeFromSlots = slots.filter((s) => s && (s.device || s.clip || s.slot)).length
	const explicit =
		parseInt(
			String(
				channelMap?.liveAudioCount ??
					liveInputsApi?.liveAudioCount ??
					cfg?.count ??
					casparUi?.count ??
					'0',
			),
			10,
		) || 0
	return Math.max(0, Math.min(LIVE_AUDIO_MAX_SLOTS, Math.max(explicit, activeFromSlots)))
}

/**
 * @param {object | null | undefined} slotData
 * @param {number} slotNum
 */
export function liveAudioSlotDisplayLabel(slotData, slotNum) {
	const label = String(slotData?.label || '').trim()
	if (label) return label
	const device = String(slotData?.device || slotData?.clip || '').trim()
	if (device.startsWith('alsa://')) return device.slice('alsa://'.length) || `Live audio ${slotNum}`
	if (device) return device
	return `Live audio ${slotNum}`
}

/**
 * Rows for mixer strips / configured live-audio sources.
 * @param {object | null | undefined} channelMap
 * @param {object | null | undefined} liveInputsApi
 * @param {{ count?: number } | null | undefined} [casparUi]
 * @returns {{ slot: number, channel: number, layer: number, label: string, device: string }[]}
 */
export function enumerateLiveAudioMixerSlots(channelMap, liveInputsApi, casparUi) {
	const count = resolveLiveAudioSlotCount(channelMap, liveInputsApi, casparUi)
	if (count <= 0) return []

	const ui = casparUi && typeof casparUi === 'object' ? casparUi : {}
	const uiSlots = Array.isArray(ui.slots) ? ui.slots : []
	const cfg = liveAudioApiConfiguredSlice(liveInputsApi)
	const apiSlots = Array.isArray(cfg?.slots) ? cfg.slots.filter((s) => s && Number(s.slot) > 0) : []
	const entries = apiSlots.length > 0 ? apiSlots : Array.from({ length: count }, (_, i) => ({ slot: i + 1 }))

	return entries
		.map((row) => {
			const slot = Math.max(1, parseInt(String(row.slot), 10) || 1)
			const device = String(row.device || row.clip || uiSlots[slot - 1] || '').trim()
			const entry = liveAudioInputForSlot(channelMap, slot)
			const channel = entry?.channel ?? row.channel
			const layer = entry?.layer ?? row.layer ?? LIVE_AUDIO_LAYER_BASE
			return {
				slot,
				channel,
				layer,
				label: liveAudioSlotDisplayLabel({ ...row, label: entry?.label, device }, slot),
				device,
				route: entry?.route ?? row.route,
			}
		})
		.filter((row) => row.device && row.channel != null)
}

/**
 * @param {Record<string, unknown>} cs - casparServer settings slice
 */
export function readLiveAudioCasparSettings(cs) {
	const c = cs && typeof cs === 'object' ? cs : {}
	const count = Math.max(0, Math.min(LIVE_AUDIO_MAX_SLOTS, parseInt(String(c.live_audio_input_count ?? '0'), 10) || 0))
	const slots = []
	for (let i = 1; i <= LIVE_AUDIO_MAX_SLOTS; i++) {
		slots.push(String(c[`live_audio_input_${i}_device`] ?? '').trim())
	}
	const ar = c.audioRouting && typeof c.audioRouting === 'object' ? c.audioRouting : {}
	const ap = ar.audioPreview && typeof ar.audioPreview === 'object' ? ar.audioPreview : {}
	return {
		count,
		slots,
		pgmAlwaysOn: c.live_audio_pgm_always_on !== false && c.live_audio_pgm_always_on !== 'false',
		pgmScreen: parseInt(String(c.live_audio_pgm_screen ?? '1'), 10) || 1,
		pgmLayer: parseInt(String(c.live_audio_pgm_layer ?? '2'), 10) || 2,
		pgmAudioOnly: c.live_audio_pgm_audio_only !== false && c.live_audio_pgm_audio_only !== 'false',
		hostChannelEnabled:
			c.live_audio_inputs_host_channel_enabled === true || c.live_audio_inputs_host_channel_enabled === 'true',
		inputsChannelMode: String(c.live_audio_inputs_channel_mode || '1080p5000'),
		audioPreviewEnabled:
			ap.enabled === true ||
			ap.enabled === 'true' ||
			c.audio_preview_enabled === true ||
			c.audio_preview_enabled === 'true',
		audioPreviewBus: String(ap.bus || c.audio_preview_bus || 'preview_1'),
		audioPreviewScreen: parseInt(String(ap.screenIndex ?? c.audio_preview_screen ?? '1'), 10) || 1,
		audioPreviewDevice: String(ap.deviceName || c.audio_preview_device_name || '').trim(),
		audioPreviewDefaultSource: String(ap.defaultSource || c.audio_preview_default_source || 'preview_1'),
	}
}

/**
 * @param {ReturnType<typeof readLiveAudioCasparSettings>} ui
 */
export function buildLiveAudioConfigBody(ui) {
	const body = {
		live_audio_input_count: ui.count,
		live_audio_pgm_always_on: ui.pgmAlwaysOn,
		live_audio_pgm_screen: ui.pgmScreen,
		live_audio_pgm_layer: ui.pgmLayer,
		live_audio_pgm_audio_only: ui.pgmAudioOnly,
		live_audio_inputs_host_channel_enabled: ui.hostChannelEnabled,
		live_audio_inputs_channel_mode: ui.inputsChannelMode,
		audio_preview_enabled: ui.audioPreviewEnabled,
		audio_preview_bus: ui.audioPreviewBus,
		audio_preview_screen: ui.audioPreviewScreen,
		audio_preview_device_name: ui.audioPreviewDevice,
		audio_preview_default_source: ui.audioPreviewDefaultSource,
	}
	for (let i = 1; i <= LIVE_AUDIO_MAX_SLOTS; i++) {
		body[`live_audio_input_${i}_device`] = ui.slots[i - 1] || ''
	}
	return body
}

/**
 * @param {Array<{ id?: string, name?: string, card?: number, device?: number, type?: string }>} devices
 * @returns {{ value: string, label: string }[]}
 */
export function alsaCaptureDeviceOptions(devices) {
	const out = [{ value: '', label: '— none —' }]
	const seen = new Set()
	for (const d of devices || []) {
		if (!d || d.type !== 'alsa') continue
		const id = String(d.id || '').trim()
		if (!id || seen.has(id)) continue
		seen.add(id)
		const name = String(d.name || id).trim()
		out.push({ value: id, label: name === id ? id : `${name} (${id})` })
	}
	return out
}

/**
 * @param {object | null | undefined} status - liveAudioInputsStatus
 * @param {number} slot - 1-based
 * @param {{ channel?: number, layer?: number } | null} [target]
 */
export function liveAudioSlotStatusMessage(status, slot, target) {
	if (status == null || typeof status !== 'object') return ''
	if (status.enabled === false && status.reason === 'amcp_disconnected') {
		return 'AMCP offline — live audio not started'
	}
	const layer = target?.layer
	const channel = target?.channel
	const failed = Array.isArray(status.failed)
		? status.failed.find(
				(x) =>
					x &&
					(x.slot === slot ||
						(channel != null && layer != null && x.channel === channel && x.layer === layer)),
			)
		: null
	if (failed) return (failed.message && String(failed.message)) || 'PLAY failed on this slot'
	const ok = Array.isArray(status.started)
		? status.started.find(
				(x) =>
					x &&
					(x.slot === slot ||
						(channel != null && layer != null && x.channel === channel && x.layer === layer)),
			)
		: null
	if (ok) {
		const cl = channel != null && layer != null ? `${channel}-${layer}` : ''
		return cl ? `Running on ${cl}` : 'Running'
	}
	return ''
}
