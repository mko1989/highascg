/**
 * Virtual screen destinations for Caspar host channels (inputs bus, streaming encode bus, etc.).
 * Shown under Device View → Screen destinations for cabling to record/stream outputs.
 */

import { roleLabel } from '../components/device-view-ui-utils.js'
import { decklinkInputForSlot, listInputChannels } from './input-channels.js'

/** Roles that become cable sources under Screen destinations → Host channels. */
export const HOST_CHANNEL_DEST_ROLES = new Set([
	'inputs_host',
	'streaming_channel',
	'extra_audio',
	'decklink_input',
	'live_audio_input',
	'webpage_host',
	'ndi_host',
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
	if (r === 'webpage_host') {
		const sid = String(slot ?? ch ?? '').trim()
		return sid ? `host_webpage_${sid}` : `host_webpage_ch_${ch}`
	}
	if (r === 'ndi_host') {
		const sid = String(slot ?? ch ?? '').trim()
		return sid ? `host_ndi_${sid}` : `host_ndi_ch_${ch}`
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
	if (role === 'webpage_host') {
		const name = row?.label || row?.sourceId || 'Webpage'
		return ch != null ? `Webpage: ${name} (ch ${ch})` : `Webpage: ${name}`
	}
	if (role === 'ndi_host') {
		const name = row?.label || row?.sourceId || 'NDI'
		return ch != null ? `NDI: ${name} (ch ${ch})` : `NDI: ${name}`
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
			: role === 'webpage_host' || role === 'ndi_host'
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

/** @param {object | null | undefined} payload */
function activeDecklinkInputSlots(payload) {
	const inputs = Array.isArray(payload?.live?.decklink?.inputs) ? payload.live.decklink.inputs : []
	const slots = inputs
		.filter((i) => isDecklinkInputSlotLive(i))
		.map((i) => Number(i.slot))
		.filter((n) => Number.isFinite(n) && n >= 1)
	return new Set(slots)
}

/** @param {object | null | undefined} row — live.decklink.inputs[] entry */
function isDecklinkInputSlotLive(row) {
	if (!row || typeof row !== 'object') return false
	if (String(row.ioDirection || '').toLowerCase() !== 'in') return false
	// Only slots explicitly assigned in settings count — not hardware placeholders (device 0).
	const device = parseInt(String(row.device ?? 0), 10) || 0
	return device > 0
}

/**
 * Whether a DeckLink slot should appear as a host-channel destination.
 * @param {object | null | undefined} payload
 * @param {number} slot — 1-based
 */
export function isDecklinkInputSlotActive(payload, slot) {
	const n = parseInt(String(slot ?? ''), 10)
	if (!Number.isFinite(n) || n < 1) return false
	const inputs = Array.isArray(payload?.live?.decklink?.inputs) ? payload.live.decklink.inputs : []
	const live = inputs.find((i) => Number(i?.slot) === n)
	if (live) return isDecklinkInputSlotLive(live)
	const cs = payload?.settings?.casparServer || payload?.live?.caspar?.channelMap || {}
	const dir = String(cs[`decklink_input_${n}_direction`] || 'in').toLowerCase()
	if (dir === 'out') return false
	const count = Math.max(0, parseInt(String(cs.decklink_input_count ?? 0), 10) || 0)
	return n <= count
}

/** @param {object} cm @param {Set<number>} activeSlots */
function resolvedDecklinkSlotCount(cm, activeSlots) {
	const configured = Math.max(0, parseInt(String(cm?.decklinkCount ?? 0), 10) || 0)
	if (!activeSlots.size) return configured
	return Math.max(configured, ...activeSlots)
}

/**
 * Host destinations for configured DeckLink / live-audio inputs (device view + channel map).
 * @param {object | null | undefined} payload
 * @returns {object[]}
 */
export function listDecklinkAndLiveInputHostDestinations(payload) {
	const cm = payload?.live?.caspar?.channelMap
	if (!cm || typeof cm !== 'object') return []

	const activeSlots = activeDecklinkInputSlots(payload)
	const deckCount = resolvedDecklinkSlotCount(cm, activeSlots)
	const hasActiveDecklink = activeSlots.size > 0
	const out = []

	const decklinkEntries = []
	for (let slot = 1; slot <= deckCount; slot++) {
		if (hasActiveDecklink && !activeSlots.has(slot)) continue
		const entry = decklinkInputForSlot(cm, slot)
		if (entry?.channel != null) decklinkEntries.push(entry)
	}

	if (!decklinkEntries.length && hasActiveDecklink) {
		const orderHostCh = (Array.isArray(payload?.live?.caspar?.generatedChannelOrder)
			? payload.live.caspar.generatedChannelOrder
			: []
		).find((row) => String(row?.role || '') === 'inputs_host')?.ch
		const hostCh = cm.inputsCh ?? orderHostCh ?? cm.multiviewCh
		if (hostCh != null) {
			for (const slot of activeSlots) {
				if (!isDecklinkInputSlotActive(payload, slot)) continue
				decklinkEntries.push({ kind: 'decklink', slot, channel: hostCh, layer: slot })
			}
		}
	}

	const uniqueDeckChannels = new Set(decklinkEntries.map((e) => e.channel))
	const dedicatedPerSlot =
		uniqueDeckChannels.size > 1 ||
		(Array.isArray(cm.decklinkInputChannels) && cm.decklinkInputChannels.length > 0) ||
		(Array.isArray(cm.inputChannels) && cm.inputChannels.some((e) => e?.kind === 'decklink'))

	if (dedicatedPerSlot && decklinkEntries.length) {
		for (const entry of decklinkEntries) {
			if (!isDecklinkInputSlotActive(payload, entry.slot)) continue
			const dest = normalizeHostChannelDestination({
				role: 'decklink_input',
				ch: entry.channel,
				slot: entry.slot,
				label: `DeckLink input ${entry.slot}`,
			})
			if (dest) out.push(dest)
		}
	} else if (decklinkEntries.length || hasActiveDecklink) {
		let hostCh = cm.inputsCh
		if (hostCh == null && decklinkEntries[0]?.channel != null) hostCh = decklinkEntries[0].channel
		if (hostCh != null) {
			if (!cm.inputsOnMvr) {
				const d = normalizeHostChannelDestination({ role: 'inputs_host', ch: hostCh })
				if (d) out.push(d)
			} else if (cm.multiviewCh != null) {
				const d = normalizeHostChannelDestination({
					role: 'inputs_host',
					ch: cm.multiviewCh,
					id: 'host_inputs_mvr',
					label: `DeckLink inputs (MVR ch ${cm.multiviewCh})`,
				})
				if (d) out.push(d)
			}
		}
	}

	const audioEntries = listInputChannels(cm).filter((e) => e.kind === 'live_audio')
	const uniqueAudioChannels = new Set(audioEntries.map((e) => e.channel))
	const dedicatedAudio =
		uniqueAudioChannels.size > 1 ||
		(Array.isArray(cm.liveAudioInputChannels) && cm.liveAudioInputChannels.length > 0)

	if (dedicatedAudio && audioEntries.length) {
		for (const entry of audioEntries) {
			const dest = normalizeHostChannelDestination({
				role: 'live_audio_input',
				ch: entry.channel,
				slot: entry.slot,
				label: `Live audio input ${entry.slot}`,
			})
			if (dest) out.push(dest)
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
	const cm = payload?.live?.caspar?.channelMap
	if (!cm || typeof cm !== 'object') return []
	const hostEntries = (Array.isArray(cm.inputChannels) ? cm.inputChannels : []).filter(
		(e) => e?.kind === 'webpage_host' || e?.kind === 'ndi_host',
	)
	const out = []
	for (const entry of hostEntries) {
		const role = entry.kind === 'webpage_host' ? 'webpage_host' : 'ndi_host'
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
	return mergeHostDestinations([fromIntent, fromOrder, fromInputs, fromHostLive])
}

/**
 * Merge persisted screen destinations with virtual host-channel rows.
 * @param {object | null | undefined} payload
 * @returns {object[]}
 */
export function listAllScreenDestinationsForDeviceView(payload) {
	const raw = Array.isArray(payload?.screenDestinations?.destinations) ? payload.screenDestinations.destinations : []
	const seen = new Set()
	const user = []
	for (const d of raw) {
		const id = String(d?.id || '').trim()
		if (!id || seen.has(id)) continue
		seen.add(id)
		user.push(d)
	}
	const host = listHostChannelDestinations(payload).filter((d) => {
		if (seen.has(d.id)) return false
		seen.add(d.id)
		return true
	})
	return [...user, ...host]
}

/**
 * Token stored on recordOutputs[].source / streamingChannel.videoSource when cabled from a host destination.
 * @param {object} dest
 * @returns {string}
 */
export function hostChannelVideoSourceToken(dest) {
	const ch = parseInt(String(dest?.casparChannel ?? dest?.pgmChannel ?? ''), 10)
	if (Number.isFinite(ch) && ch >= 1) return `channel_${ch}`
	return 'program_1'
}

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
