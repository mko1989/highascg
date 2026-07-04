/**
 * Planned Caspar host channel map (saved config) vs live map (running Caspar).
 * Until Apply Caspar config + restart, UI uses planned numbering so it stays in sync with edits.
 */

import {
	decklinkInputForSlot,
	liveAudioInputForSlot,
	v4l2InputForSlot,
} from './input-channels.js'

/** @param {object | null | undefined} settings */
export function plannedChannelMapFromSettings(settings) {
	const cm = settings?.channelMap
	return cm && typeof cm === 'object' ? cm : null
}

/** @param {object | null | undefined} payload — GET /api/device-view (+ mergeSettingsIntoDeviceViewPayload) */
export function plannedChannelMapFromPayload(payload) {
	const fromSettings = plannedChannelMapFromSettings(payload?._settings)
	if (fromSettings) return fromSettings
	const fromSnapshot = payload?.live?.caspar?.channelMap
	return fromSnapshot && typeof fromSnapshot === 'object' ? fromSnapshot : null
}

/**
 * @param {object | null | undefined} planned
 * @param {object | null | undefined} live
 */
export function casparHostChannelsPendingApply(planned, live) {
	if (!planned) return false
	if (!live) return true
	const scalarKeys = ['decklinkCount', 'liveAudioCount', 'v4l2InputCount']
	for (const k of scalarKeys) {
		if (Number(planned[k] ?? 0) !== Number(live[k] ?? 0)) return true
	}
	const arrayKeys = ['decklinkInputChannels', 'liveAudioInputChannels', 'v4l2InputChannels']
	for (const k of arrayKeys) {
		if (JSON.stringify(planned[k] ?? []) !== JSON.stringify(live[k] ?? [])) return true
	}
	const hostKinds = new Set(['webpage_host', 'ndi_host'])
	const pickHost = (cm) =>
		(Array.isArray(cm?.inputChannels) ? cm.inputChannels : [])
			.filter((e) => hostKinds.has(String(e?.kind || '')))
			.map((e) => ({ kind: e.kind, channel: e.channel, sourceId: e.sourceId }))
			.sort((a, b) => a.channel - b.channel)
	if (JSON.stringify(pickHost(planned)) !== JSON.stringify(pickHost(live))) return true
	return false
}

/**
 * Channel map for host-channel numbering in UI.
 * @param {{ payload?: object, settings?: object, liveChannelMap?: object | null }} opts
 */
export function effectiveChannelMap({ payload, settings, liveChannelMap } = {}) {
	const planned =
		plannedChannelMapFromSettings(settings) ||
		plannedChannelMapFromPayload(payload) ||
		null
	const live = liveChannelMap && typeof liveChannelMap === 'object' ? liveChannelMap : null
	if (casparHostChannelsPendingApply(planned, live)) return planned || live
	return live || planned
}

/** @param {object | null | undefined} payload @param {object | null | undefined} [liveChannelMap] */
export function hostChannelsPendingApplyForPayload(payload, liveChannelMap) {
	const planned = plannedChannelMapFromPayload(payload)
	const live = liveChannelMap ?? null
	return casparHostChannelsPendingApply(planned, live)
}

/**
 * @param {object | null | undefined} dest
 * @param {object | null | undefined} cm
 */
export function reconcileHostChannelDestination(dest, cm) {
	if (!dest || !cm) return dest
	const role = String(dest.hostRole || '').trim()
	const slot = dest.inputSlot != null ? Number(dest.inputSlot) : NaN
	let entry = null
	if (role === 'decklink_input' && Number.isFinite(slot) && slot >= 1) {
		entry = decklinkInputForSlot(cm, slot)
	} else if (role === 'live_audio_input' && Number.isFinite(slot) && slot >= 1) {
		entry = liveAudioInputForSlot(cm, slot)
	} else if (role === 'v4l2_input' && Number.isFinite(slot) && slot >= 1) {
		entry = v4l2InputForSlot(cm, slot)
	} else if (role === 'webpage_host' || role === 'ndi_host') {
		const sid = String(dest.sourceId || '').trim()
		entry = (Array.isArray(cm.inputChannels) ? cm.inputChannels : []).find(
			(e) => String(e?.kind || '') === role && (!sid || String(e?.sourceId || '') === sid),
		)
	}
	if (entry?.channel == null) return dest
	const ch = entry.channel
	if (ch === dest.casparChannel) return dest
	const next = { ...dest, casparChannel: ch }
	if (role === 'decklink_input' && Number.isFinite(slot)) {
		next.label = `DeckLink input ${slot} (ch ${ch})`
	} else if (role === 'live_audio_input' && Number.isFinite(slot)) {
		next.label = `Live audio input ${slot} (ch ${ch})`
	} else if (role === 'v4l2_input' && Number.isFinite(slot)) {
		next.label = dest.label?.startsWith('USB:') ? dest.label.replace(/\(ch \d+\)/, `(ch ${ch})`) : `USB video ${slot} (ch ${ch})`
	}
	return next
}

/**
 * @param {object | null | undefined} source
 * @param {object | null | undefined} cm
 */
export function reconcileExtraLiveSourceChannel(source, cm) {
	if (!source || !cm) return source
	const routeType = String(source.routeType || '').toLowerCase()
	let entry = null
	if (routeType === 'decklink' && source.decklinkSlot != null) {
		entry = decklinkInputForSlot(cm, Number(source.decklinkSlot))
	} else if (routeType === 'live_audio' && source.liveAudioSlot != null) {
		entry = liveAudioInputForSlot(cm, Number(source.liveAudioSlot))
	} else if (routeType === 'v4l2' && source.v4l2Slot != null) {
		entry = v4l2InputForSlot(cm, Number(source.v4l2Slot))
	} else if (routeType === 'webpage_host' || routeType === 'ndi_host') {
		const sid = String(source.sourceId || source.hostSourceId || '').trim()
		entry = (Array.isArray(cm.inputChannels) ? cm.inputChannels : []).find(
			(e) => String(e?.kind || '') === routeType && (!sid || String(e?.sourceId || '') === sid),
		)
	}
	if (entry?.channel == null) return source
	const route = entry.route || source.value
	return {
		...source,
		inputsChannel: entry.channel,
		hostChannel: entry.channel,
		inputsLayer: entry.layer ?? source.inputsLayer,
		value: route || source.value,
	}
}
