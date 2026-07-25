/**
 * Virtual screen destinations for Caspar host channels (inputs bus, streaming encode bus, etc.).
 * Shown under Device View → Screen destinations for cabling to record/stream outputs.
 */

import { roleLabel } from '../components/device-view-ui-utils.js'
import { reconcileHostChannelDestination } from './planned-channel-map.js'
import {
	isDecklinkInputSlotActive,
	channelMapForHostChannels,
	listDecklinkAndLiveInputHostDestinations,
} from './device-view-host-channels-inputs.js'

export {
	isDecklinkInputSlotActive,
	listDecklinkAndLiveInputHostDestinations,
} from './device-view-host-channels-inputs.js'

/** Roles that become cable sources under Screen destinations → Host channels. */
export const HOST_CHANNEL_DEST_ROLES = new Set([
	'inputs_host',
	'streaming_channel',
	'extra_audio',
	'decklink_input',
	'live_audio_input',
	'v4l2_input',
	'webpage_host',
	'ndi_host',
	'browser_display',
])

/**
 * Stable destination id for a host-channel row.
 * @param {string} role
 * @param {number} ch
 * @param {number} [slot] — 1-based input slot for per-input roles
 * @returns {string}
 */
export function hostChannelDestinationId(role, ch, slot) {
	const r = String(role || '').trim()
	if (r === 'inputs_host') return 'host_inputs'
	if (r === 'streaming_channel') return 'host_streaming'
	if (r === 'extra_audio') return `host_extra_audio_${ch}`
	if (r === 'decklink_input') {
		const s = parseInt(String(slot ?? ''), 10)
		return s >= 1 ? `host_decklink_input_${s}` : `host_decklink_ch_${ch}`
	}
	if (r === 'live_audio_input') {
		const s = parseInt(String(slot ?? ''), 10)
		return s >= 1 ? `host_live_audio_input_${s}` : `host_live_audio_ch_${ch}`
	}
	if (r === 'v4l2_input') {
		const s = parseInt(String(slot ?? ''), 10)
		return s >= 1 ? `host_v4l2_input_${s}` : `host_v4l2_ch_${ch}`
	}
	if (r === 'webpage_host') {
		const sid = String(slot ?? ch ?? '').trim()
		return sid ? `host_webpage_${sid}` : `host_webpage_ch_${ch}`
	}
	if (r === 'ndi_host') {
		const sid = String(slot ?? ch ?? '').trim()
		return sid ? `host_ndi_${sid}` : `host_ndi_ch_${ch}`
	}
	if (r === 'browser_display') {
		const sid = String(slot ?? ch ?? '').trim()
		return sid ? `host_browser_${sid}` : `host_browser_ch_${ch}`
	}
	return `host_${r}_${ch}`
}

/**
 * @param {{ role?: string, ch?: number, slot?: number }} row
 * @returns {string}
 */
export function defaultHostChannelLabel(row) {
	const role = String(row?.role || row?.hostRole || '')
	const ch = row?.ch ?? row?.casparChannel
	const slot = row?.slot ?? row?.inputSlot
	if (role === 'decklink_input' && slot != null) {
		return ch != null ? `DeckLink input ${slot} (ch ${ch})` : `DeckLink input ${slot}`
	}
	if (role === 'live_audio_input' && slot != null) {
		return ch != null ? `Live audio input ${slot} (ch ${ch})` : `Live audio input ${slot}`
	}
	if (role === 'v4l2_input' && slot != null) {
		const name = row?.label || 'USB video'
		return ch != null ? `USB: ${name} (ch ${ch})` : `USB: ${name}`
	}
	if (role === 'webpage_host') {
		const name = row?.label || row?.sourceId || 'Webpage'
		return ch != null ? `Webpage: ${name} (ch ${ch})` : `Webpage: ${name}`
	}
	if (role === 'ndi_host') {
		const name = row?.label || row?.sourceId || 'NDI'
		return ch != null ? `NDI: ${name} (ch ${ch})` : `NDI: ${name}`
	}
	if (role === 'browser_display') {
		const name = row?.label || row?.sourceId || 'Browser'
		return ch != null ? `Browser: ${name} (ch ${ch})` : `Browser: ${name}`
	}
	const base = roleLabel({ role, mainIndex: 0 })
	return ch != null ? `${base} (ch ${ch})` : base
}

/**
 * @param {object} item — destinationIntent item or generated row
 * @returns {object | null}
 */
export function normalizeHostChannelDestination(item) {
	if (!item || typeof item !== 'object') return null
	const role = String(item.hostRole || item.role || '').trim()
	if (!HOST_CHANNEL_DEST_ROLES.has(role)) return null
	const ch = parseInt(String(item.casparChannel ?? item.ch ?? item.pgmChannel ?? ''), 10)
	if (!Number.isFinite(ch) || ch < 1) return null
	const slot = parseInt(String(item.slot ?? item.inputSlot ?? item.sourceId ?? ''), 10)
	const id =
		String(item.id || '').trim() ||
		(role === 'decklink_input' || role === 'live_audio_input'
			? hostChannelDestinationId(role, ch, Number.isFinite(slot) ? slot : undefined)
			: role === 'webpage_host' || role === 'ndi_host' || role === 'browser_display'
				? hostChannelDestinationId(role, ch, item.sourceId || item.id)
				: hostChannelDestinationId(role, ch))
	return {
		id,
		label: String(item.label || defaultHostChannelLabel({ role, ch, slot })).trim() || id,
		mode: 'host_channel',
		hostRole: role,
		casparChannel: ch,
		virtual: true,
		...(item.sourceId ? { sourceId: String(item.sourceId) } : {}),
		...(Number.isFinite(slot) && slot >= 1 ? { inputSlot: slot } : {}),
		...(item.devicePath ? { devicePath: String(item.devicePath) } : {}),
	}
}

/** @param {object[]} lists */
function mergeHostDestinations(lists) {
	const seen = new Set()
	const out = []
	for (const list of lists) {
		for (const dest of list || []) {
			if (!dest?.id || seen.has(dest.id)) continue
			seen.add(dest.id)
			out.push(dest)
		}
	}
	return out
}

/**
 * WO-88: host destinations for webpage / NDI live sources (dedicated Caspar channels).
 * @param {object | null | undefined} payload
 * @returns {object[]}
 */
export function listHostLiveSourceDestinations(payload) {
	const cm = channelMapForHostChannels(payload)
	if (!cm || typeof cm !== 'object') return []
	const hostEntries = (Array.isArray(cm.inputChannels) ? cm.inputChannels : []).filter(
		(e) => e?.kind === 'webpage_host' || e?.kind === 'ndi_host' || e?.kind === 'browser_display',
	)
	const out = []
	for (const entry of hostEntries) {
		const role = entry.kind === 'webpage_host' ? 'webpage_host' : entry.kind === 'ndi_host' ? 'ndi_host' : 'browser_display'
		const dest = normalizeHostChannelDestination({
			hostRole: role,
			casparChannel: entry.channel,
			sourceId: entry.sourceId,
			label: entry.label || defaultHostChannelLabel({ role, ch: entry.channel, label: entry.label, sourceId: entry.sourceId }),
			id: hostChannelDestinationId(role, entry.channel, entry.sourceId),
		})
		if (dest) out.push(dest)
	}
	return out
}

/**
 * Host-channel destinations for Device View (from API intent, generatedChannelOrder, or live inputs).
 * @param {object | null | undefined} payload — GET /api/device-view
 * @returns {object[]}
 */
export function listHostChannelDestinations(payload) {
	const intentItems = Array.isArray(payload?.live?.caspar?.destinationIntent?.items)
		? payload.live.caspar.destinationIntent.items
		: []
	const fromIntent = intentItems
		.map((item) => normalizeHostChannelDestination(item))
		.filter(Boolean)
		.filter((dest) => dest.hostRole !== 'decklink_input' || isDecklinkInputSlotActive(payload, dest.inputSlot))

	const order = Array.isArray(payload?.live?.caspar?.generatedChannelOrder)
		? payload.live.caspar.generatedChannelOrder
		: []
	const fromOrder = []
	const seenOrder = new Set()
	for (const row of order) {
		if (row?.role === 'decklink_input' && !isDecklinkInputSlotActive(payload, row.slot)) continue
		const dest = normalizeHostChannelDestination(row)
		if (!dest || seenOrder.has(dest.id)) continue
		seenOrder.add(dest.id)
		fromOrder.push(dest)
	}

	const fromInputs = listDecklinkAndLiveInputHostDestinations(payload)
	const fromHostLive = listHostLiveSourceDestinations(payload)
	const cm = channelMapForHostChannels(payload)
	return mergeHostDestinations([fromInputs, fromHostLive, fromOrder, fromIntent]).map((dest) =>
		reconcileHostChannelDestination(dest, cm),
	)
}

/**
 * Persisted screen destinations from config (excludes auto-detected host channels).
 * @param {object | null | undefined} payload
 * @returns {object[]}
 */
export function listPersistedScreenDestinations(payload) {
	const raw = Array.isArray(payload?.screenDestinations?.destinations) ? payload.screenDestinations.destinations : []
	const seen = new Set()
	const out = []
	for (const d of raw) {
		const id = String(d?.id || '').trim()
		if (!id || seen.has(id)) continue
		seen.add(id)
		out.push(d)
	}
	return out
}

const SCREEN_DEST_TYPE_OPTIONS = [
	{ value: 'pgm_prv', label: 'PGM/PRV' },
	{ value: 'pgm_only', label: 'PGM only' },
	{ value: 'multiview', label: 'Multiview' },
	// WO-242: dedicated channel + native <artnet> consumer for an LED/pixel-map fixture array.
	{ value: 'pixelmap', label: 'Pixel Map' },
	// WO-255: dedicated channel — routed preview rects shaped above fullscreen Firefox, on the operator monitor.
	{ value: 'operator_gui', label: 'Operator GUI' },
]

/** @param {HTMLSelectElement} selectEl @param {object | null | undefined} [_payload] */
export function populateDestinationTypeSelect(selectEl, _payload) {
	if (!selectEl) return
	selectEl.replaceChildren()
	for (const row of SCREEN_DEST_TYPE_OPTIONS) {
		const opt = document.createElement('option')
		opt.value = row.value
		opt.textContent = row.label
		selectEl.appendChild(opt)
	}
}

/** @param {object | null | undefined} payload @returns {object[]} */
export function listAllScreenDestinationsForDeviceView(payload) {
	const persisted = listPersistedScreenDestinations(payload)
	const persistedIds = new Set(persisted.map((d) => String(d?.id || '')))
	const screen = persisted.filter((d) => String(d?.mode || '') !== 'host_channel' && d?.virtual !== true)
	const pinnedHost = persisted.filter((d) => String(d?.mode || '') === 'host_channel' || d?.virtual === true)
	const autoHost = listHostChannelDestinations(payload).filter((h) => h?.id && !persistedIds.has(String(h.id)))
	return [...screen, ...pinnedHost, ...autoHost]
}

export {
	decklinkSlotFromHostDestination,
	liveAudioSlotFromHostDestination,
	v4l2SlotFromHostDestination,
	findExtraLiveSourceForHostDestination,
	hostChannelVideoSourceToken,
} from './device-view-host-channels-destination-utils.js'

/**
 * Map an extra live source row to its virtual host destination id (if any).
 * @param {object | null | undefined} x
 * @returns {string | null}
 */
export function hostDestinationIdForExtraLiveSource(x) {
	if (!x || typeof x !== 'object') return null
	const routeType = String(x?.routeType || '').toLowerCase()
	const ch = parseInt(String(x?.inputsChannel ?? x?.hostChannel ?? ''), 10)
	if (routeType === 'decklink' && x.decklinkSlot != null) {
		return hostChannelDestinationId('decklink_input', Number.isFinite(ch) ? ch : 1, x.decklinkSlot)
	}
	if (routeType === 'live_audio' && x.liveAudioSlot != null) {
		return hostChannelDestinationId('live_audio_input', Number.isFinite(ch) ? ch : 1, x.liveAudioSlot)
	}
	if (routeType === 'v4l2' && x.v4l2Slot != null) {
		return hostChannelDestinationId('v4l2_input', Number.isFinite(ch) ? ch : 1, x.v4l2Slot)
	}
	if (routeType === 'webpage_host' || routeType === 'ndi_host' || routeType === 'browser_display') {
		const role = routeType === 'webpage_host' ? 'webpage_host' : routeType === 'ndi_host' ? 'ndi_host' : 'browser_display'
		const sid = String(x?.sourceId || x?.hostSourceId || '').trim()
		return hostChannelDestinationId(role, Number.isFinite(ch) ? ch : 1, sid || undefined)
	}
	return null
}

/**
 * Attach GET /api/settings caspar block so host-channel detection matches server config.
 * @param {object | null | undefined} payload
 * @param {object | null | undefined} settings
 * @returns {object | null | undefined}
 */
export function mergeSettingsIntoDeviceViewPayload(payload, settings) {
	if (!payload || typeof payload !== 'object') return payload
	if (!settings || typeof settings !== 'object') return payload
	const casparServer = settings.casparServer || settings
	return {
		...payload,
		_settings: settings,
		settings: {
			...(payload.settings && typeof payload.settings === 'object' ? payload.settings : {}),
			casparServer,
			...(settings.channelMap ? { channelMap: settings.channelMap } : {}),
		},
	}
}

export { reconcileExtraLiveSourceChannel } from './planned-channel-map.js'

/**
 * @param {object | null | undefined} payload
 * @param {string} destinationId
 * @returns {object | null}
 */
export function findScreenDestinationById(payload, destinationId) {
	const id = String(destinationId || '').trim()
	if (!id) return null
	const all = listAllScreenDestinationsForDeviceView(payload)
	return all.find((d) => String(d?.id || '') === id) || null
}
