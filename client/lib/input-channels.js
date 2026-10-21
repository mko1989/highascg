/**
 * Per-input dedicated Caspar channels (WO-53).
 * @see from_server/PER_INPUT_DEDICATED_CHANNELS.md
 */

export const LIVE_AUDIO_INPUT_LAYER = 10

/**
 * Parse any route value: `route://N` (whole channel, layer = null) or `route://N-L`.
 * Moved here from scenes-shared.js (WO-323) — that module's import chain is not plain-node
 * require-safe and operator-compose-tiles.js (smoke-tested under node) needs this; scenes-shared
 * re-exports it for its existing importers.
 * @param {unknown} value
 * @returns {{ channel: number, layer: number | null } | null}
 */
export function parseRouteValue(value) {
	const m = String(value || '').trim().match(/^route:\/\/(\d+)(?:-(\d+))?$/i)
	if (!m) return null
	const channel = parseInt(m[1], 10)
	if (!Number.isFinite(channel) || channel < 1) return null
	const layer = m[2] != null ? parseInt(m[2], 10) : null
	return { channel, layer: Number.isFinite(layer) && layer >= 1 ? layer : null }
}

/**
 * WO-156: rejection message for assigning a route source to a look, or null when allowed.
 * Blocks:
 *  - whole-channel routes to the look's own PGM or PRV/edit channel (`route://3` onto ch 3
 *    wedges the channel in CasparCG — the on-air incident behind WO-156);
 *  - same-channel routes to the exact target layer (Caspar recursion; pre-existing rule).
 * Same-channel routes to a *different* layer stay allowed — that is intra-look routing.
 * @param {unknown} value — dropped source value
 * @param {{ editChannel?: number | null, pgmChannel?: number | null, targetLayerNumber?: number | null }} target
 * @returns {string | null} toast message when the drop must be rejected
 */
export function routeDropRejectionMessage(value, { editChannel = null, pgmChannel = null, targetLayerNumber = null } = {}) {
	const parsed = parseRouteValue(value)
	if (!parsed) return null
	if (parsed.layer == null) {
		if (pgmChannel != null && parsed.channel === Number(pgmChannel)) {
			return `Cannot use route://${parsed.channel} here — it routes this screen's program channel (${parsed.channel}) into itself and freezes the channel.`
		}
		if (editChannel != null && parsed.channel === Number(editChannel)) {
			return `Cannot use route://${parsed.channel} here — it routes this screen's preview channel (${parsed.channel}) into itself and freezes the channel.`
		}
		return null
	}
	if (editChannel != null && targetLayerNumber != null && parsed.channel === Number(editChannel) && parsed.layer === Number(targetLayerNumber)) {
		return 'A layer cannot play a route to itself (same channel and layer).'
	}
	return null
}

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
 * WO-293 — input kinds whose dedicated Caspar channel actually carries audio, and therefore
 * deserve a mixer strip + VU meter.
 *
 * `decklink` (embedded SDI/HDMI audio) and `live_audio` (ALSA capture) are audio sources.
 * `ndi_host` carries an audio track too. `v4l2` (USB webcam producer) and the screen-scrape
 * kinds (`browser_display`, `webpage_host`) are video-only in this pipeline, so they are
 * deliberately excluded — a fader that can never move is worse than no fader.
 */
export const AUDIO_INPUT_KINDS = Object.freeze(['decklink', 'live_audio', 'ndi_host'])

/** @param {string | null | undefined} kind */
export function inputKindHasAudio(kind) {
	return AUDIO_INPUT_KINDS.includes(String(kind || '').trim())
}

/**
 * Audio-capable input channels, in channel-map order.
 * @param {object | null | undefined} cm
 */
export function listAudioInputChannels(cm) {
	return listInputChannels(cm).filter((e) => inputKindHasAudio(e?.kind))
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
 * DeckLink slot from connector (index is 0-based slot, externalRef is device index).
 * @param {{ index?: number, externalRef?: string | number }} conn
 */
export function decklinkSlotFromConnector(conn) {
	const idx = parseInt(String(conn?.index ?? ''), 10)
	if (Number.isFinite(idx) && idx >= 0) return idx + 1
	const dev = parseInt(String(conn?.externalRef ?? '0'), 10) || 0
	return dev > 0 ? dev : 1
}
