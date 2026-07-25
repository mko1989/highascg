/**
 * DeckLink / live-audio / v4l2 host-channel input detection for Device View → Screen destinations.
 * Split out of device-view-host-channels.js — everything that resolves WHICH input slots are
 * actually active on the wire and turns them into host-channel destination rows.
 */

import { decklinkInputForSlot, listInputChannels, decklinkSlotFromConnector } from './input-channels.js'
import { normalizeDecklinkIoDirection } from './decklink-io-direction.js'
import { effectiveChannelMap } from './planned-channel-map.js'
import { getAppStateStore } from './app-runtime.js'
import { normalizeHostChannelDestination } from './device-view-host-channels.js'

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
 * @param {object | null | undefined} payload
 * @returns {object}
 */
function casparSettingsFromPayload(payload) {
	return (
		payload?.settings?.casparServer ||
		payload?._settings?.casparServer ||
		payload?.live?.caspar?.channelMap ||
		{}
	)
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

	const cs = casparSettingsFromPayload(payload)
	const configuredCount = Math.max(0, parseInt(String(cs.decklink_input_count ?? 0), 10) || 0)

	const connectors = [
		...(Array.isArray(payload?.graph?.connectors) ? payload.graph.connectors : []),
		...(Array.isArray(payload?.suggested?.connectors) ? payload.suggested.connectors : []),
	]
	const ioConn = connectors.find((c) => c?.kind === 'decklink_io' && decklinkSlotFromConnector(c) === n)
	if (ioConn) return normalizeDecklinkIoDirection(ioConn.caspar) === 'in'

	if (configuredCount === 0) return false

	const dir = normalizeDecklinkIoDirection({ ioDirection: cs[`decklink_input_${n}_direction`] })
	if (dir !== 'in') return false
	const device = parseInt(String(cs[`decklink_input_${n}_device`] ?? 0), 10) || 0
	if (device <= 0) return false
	return n <= configuredCount
}

/** @param {object} cm @param {Set<number>} activeSlots */
function resolvedDecklinkSlotCount(cm, activeSlots) {
	const configured = Math.max(0, parseInt(String(cm?.decklinkCount ?? 0), 10) || 0)
	if (!activeSlots.size) return configured
	return Math.max(configured, ...activeSlots)
}

/** @param {object | null | undefined} payload */
export function channelMapForHostChannels(payload) {
	const live = getAppStateStore()?.getState?.()?.channelMap || payload?.live?.caspar?.channelMap || null
	return effectiveChannelMap({ payload, settings: payload?._settings, liveChannelMap: live })
}

/**
 * Host destinations for configured DeckLink / live-audio inputs (device view + channel map).
 * @param {object | null | undefined} payload
 * @returns {object[]}
 */
export function listDecklinkAndLiveInputHostDestinations(payload) {
	const cm = channelMapForHostChannels(payload)
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

	const v4l2Entries = listInputChannels(cm).filter((e) => e.kind === 'v4l2')
	if (v4l2Entries.length) {
		for (const entry of v4l2Entries) {
			const dest = normalizeHostChannelDestination({
				role: 'v4l2_input',
				ch: entry.channel,
				slot: entry.slot,
				label: entry.label || `USB video ${entry.slot}`,
			})
			if (dest) out.push(dest)
		}
	}

	return out
}
