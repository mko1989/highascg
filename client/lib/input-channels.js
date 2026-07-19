/**
 * Per-input dedicated Caspar channels (WO-53).
 * @see from_server/PER_INPUT_DEDICATED_CHANNELS.md
 */

export const LIVE_AUDIO_INPUT_LAYER = 10

/**
 * @param {object | null | undefined} cm — state.channelMap
 * @param {number} slot — 1-based DeckLink slot
 */
export function decklinkInputForSlot(cm, slot) {
	const n = Number(slot)
	if (!Number.isFinite(n) || n < 1) return null
	const entry = (cm?.inputChannels || []).find((e) => e && e.kind === 'decklink' && e.slot === n)
	if (entry) return entry
	const ch = cm?.decklinkInputChannels?.[n - 1]
	if (ch != null) {
		return { kind: 'decklink', slot: n, channel: ch, layer: n, route: `route://${ch}-${n}` }
	}
	// Legacy shared inputs host: all DeckLink slots play on inputsCh as layers 1…N.
	const sharedHost = cm?.inputsCh
	const deckCount = Math.max(0, parseInt(String(cm?.decklinkCount ?? 0), 10) || 0)
	if (sharedHost != null && n <= deckCount) {
		return { kind: 'decklink', slot: n, channel: sharedHost, layer: n, route: `route://${sharedHost}-${n}` }
	}
	return null
}

export const V4L2_HOST_LAYER = 1

/**
 * @param {object | null | undefined} cm
 * @param {number} slot
 */
export function v4l2InputForSlot(cm, slot) {
	const n = Number(slot)
	if (!Number.isFinite(n) || n < 1) return null
	const entry = (cm?.inputChannels || []).find((e) => e && e.kind === 'v4l2' && e.slot === n)
	if (entry) return entry
	const ch = cm?.v4l2InputChannels?.[n - 1]
	if (ch == null) return null
	return {
		kind: 'v4l2',
		slot: n,
		channel: ch,
		layer: V4L2_HOST_LAYER,
		route: `route://${ch}-${V4L2_HOST_LAYER}`,
	}
}

/** @param {object | null | undefined} cm */
export function routeForV4l2Slot(cm, slot) {
	return v4l2InputForSlot(cm, slot)?.route ?? null
}

/**
 * @param {object | null | undefined} cm
 * @param {number} slot — 1-based live-audio slot
 */
export function liveAudioInputForSlot(cm, slot) {
	const n = Number(slot)
	if (!Number.isFinite(n) || n < 1) return null
	const entry = (cm?.inputChannels || []).find((e) => e && e.kind === 'live_audio' && e.slot === n)
	if (entry) return entry
	const ch = cm?.liveAudioInputChannels?.[n - 1]
	if (ch == null) return null
	return {
		kind: 'live_audio',
		slot: n,
		channel: ch,
		layer: LIVE_AUDIO_INPUT_LAYER,
		route: `route://${ch}`,
	}
}

/** Prefer inputChannels[].route; never hard-code inputsCh-N for slot > 1. */
export function routeForDecklinkSlot(cm, slot) {
	return decklinkInputForSlot(cm, slot)?.route ?? null
}

/** @param {object | null | undefined} cm */
export function routeForLiveAudioSlot(cm, slot) {
	return liveAudioInputForSlot(cm, slot)?.route ?? null
}

/**
 * Unified input channel list — prefer inputChannels, else synthesize from arrays.
 * @param {object | null | undefined} cm
 */
export function listInputChannels(cm) {
	if (!cm || typeof cm !== 'object') return []
	if (Array.isArray(cm.inputChannels) && cm.inputChannels.length > 0) {
		return cm.inputChannels.filter((e) => e && e.channel != null)
	}
	const out = []
	const deckCount = Math.max(0, parseInt(String(cm.decklinkCount ?? '0'), 10) || 0)
	for (let i = 1; i <= deckCount; i++) {
		const e = decklinkInputForSlot(cm, i)
		if (e) out.push(e)
	}
	const audioCount = Math.max(0, parseInt(String(cm.liveAudioCount ?? '0'), 10) || 0)
	for (let i = 1; i <= audioCount; i++) {
		const e = liveAudioInputForSlot(cm, i)
		if (e) out.push(e)
	}
	const v4l2Count = Math.max(0, parseInt(String(cm.v4l2InputCount ?? '0'), 10) || 0)
	for (let i = 1; i <= v4l2Count; i++) {
		const e = v4l2InputForSlot(cm, i)
		if (e) out.push(e)
	}
	return out
}

/**
 * @param {object | null | undefined} cm
 * @param {number} channel
 */
export function isDecklinkInputChannel(cm, channel) {
	const ch = Number(channel)
	if (!Number.isFinite(ch)) return false
	if (Array.isArray(cm?.decklinkInputChannels) && cm.decklinkInputChannels.includes(ch)) return true
	return (cm?.inputChannels || []).some((e) => e?.kind === 'decklink' && e.channel === ch)
}

/**
 * @param {object | null | undefined} cm
 * @param {number} channel
 */
export function isLiveAudioInputChannel(cm, channel) {
	const ch = Number(channel)
	if (!Number.isFinite(ch)) return false
	if (Array.isArray(cm?.liveAudioInputChannels) && cm.liveAudioInputChannels.includes(ch)) return true
	return (cm?.inputChannels || []).some((e) => e?.kind === 'live_audio' && e.channel === ch)
}

export function isV4l2InputChannel(cm, channel) {
	const ch = Number(channel)
	if (!Number.isFinite(ch)) return false
	if (Array.isArray(cm?.v4l2InputChannels) && cm.v4l2InputChannels.includes(ch)) return true
	return (cm?.inputChannels || []).some((e) => e?.kind === 'v4l2' && e.channel === ch)
}

/**
 * @param {object | null | undefined} cm
 * @param {number} channel
 */
export function isAnyInputChannel(cm, channel) {
	return isDecklinkInputChannel(cm, channel) || isLiveAudioInputChannel(cm, channel) || isV4l2InputChannel(cm, channel)
}

/**
 * Resolution for a dedicated input channel (from entry or channelMap fallbacks).
 * @param {object | null | undefined} cm
 * @param {number} channel
 */
export function inputChannelResolution(cm, channel) {
	const ch = Number(channel)
	const entry = (cm?.inputChannels || []).find((e) => e && e.channel === ch)
	if (entry?.resolution?.w && entry?.resolution?.h) {
		return { w: entry.resolution.w, h: entry.resolution.h, fps: entry.resolution.fps }
	}
	if (isDecklinkInputChannel(cm, ch) && cm?.inputsResolution?.w) {
		return { w: cm.inputsResolution.w, h: cm.inputsResolution.h, fps: cm.inputsResolution.fps }
	}
	return { w: 1920, h: 1080 }
}

/**
 * Re-resolve legacy shared-host routes (route://oldInputsCh-N) to per-slot routes.
 * @param {object | null | undefined} cm
 * @param {string} routeValue
 */
export function migrateLegacyInputRoute(cm, routeValue) {
	const val = String(routeValue || '').trim()
	const m = val.match(/^route:\/\/(\d+)(?:-(\d+))?$/i)
	if (!m) return val
	const ch = parseInt(m[1], 10)
	const layer = m[2] != null ? parseInt(m[2], 10) : null
	const legacyHost = cm?.inputsCh
	if (legacyHost == null || ch !== legacyHost) return val
	if (layer != null && layer >= 1 && layer <= 8) {
		const deck = routeForDecklinkSlot(cm, layer)
		if (deck) return deck
		const audio = routeForLiveAudioSlot(cm, layer)
		if (audio) return audio
	}
	return val
}

/**
 * WO-271 — resolve a multiview cell's live source channel against the CURRENT channel map,
 * healing stale persisted route strings (channel-map shifts leave copied `route://N-L` values
 * pointing at the wrong channel — live case: DeckLink `route://5-4` after the operator_gui
 * channel took index 5). Mirrors src/config/live-source-route-heal.js.
 * @param {{ id?: string, type?: string, label?: string }} cell
 * @param {{ channel: number, layer: number|null }} parsed - parseRouteValue(cell.source.value)
 * @param {object | null | undefined} cm - state.channelMap
 * @returns {number|null} current channel, or null when the route is stale AND unresolvable
 */
export function resolveMvCellSourceChannel(cell, parsed, cm) {
	if (!parsed || !Number.isFinite(Number(parsed.channel))) return null
	const ch = Number(parsed.channel)
	const inputs = Array.isArray(cm?.inputChannels) ? cm.inputChannels : []
	// Identity first: after a channel-map shift a stale number can COLLIDE with a different
	// now-valid channel, so a resolvable identity (decklink slot / label) always wins.
	if (String(cell?.type || '') === 'decklink') {
		let slot = null
		const idM = cell.id?.match(/decklink_(\d+)/)
		if (idM) slot = parseInt(idM[1], 10) + 1
		if (slot == null) {
			const lblM = String(cell.label || '').match(/decklink\s*(\d+)/i)
			if (lblM) slot = parseInt(lblM[1], 10)
		}
		if (slot == null && parsed.layer != null) slot = parsed.layer
		const entry = inputs.find((e) => e.kind === 'decklink' && e.slot === slot)
		if (entry?.channel != null) return Number(entry.channel)
	}
	const label = String(cell?.label || '').trim().toLowerCase()
	if (label) {
		const byLabel = inputs.find((e) => String(e.label || '').trim().toLowerCase() === label)
		if (byLabel?.channel != null) return Number(byLabel.channel)
	}
	// No identity resolved — trust the number only if the current map still knows it.
	const known = new Set([
		...(cm?.programChannels || []).filter((c) => c != null).map(Number),
		...(cm?.previewChannels || []).filter((c) => c != null).map(Number),
		...inputs.filter((e) => e?.channel != null).map((e) => Number(e.channel)),
	])
	if (known.has(ch)) return ch
	return null
}

/**
 * DeckLink slot from connector (index is 0-based slot, externalRef is device index).
 * @param {{ index?: number, externalRef?: string | number }} conn
 */
export function decklinkSlotFromConnector(conn) {
	const idx = parseInt(String(conn?.index ?? ''), 10)
	if (Number.isFinite(idx) && idx >= 0) return idx + 1
	const dev = parseInt(String(conn?.externalRef ?? '0'), 10) || 0
	return dev > 0 ? dev : 1
}
