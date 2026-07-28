/**
 * Per-input audio-send policy for live inputs (DeckLink / v4l2-USB), applied at TAKE time.
 *
 * Owner workflow (todos21.07.26): three DeckLink cameras, only one carries the sound mixer's
 * audio. That one should ALWAYS feed its program bus; the other two must stay silent even while
 * their video is on PGM. Plus a mixer-wide AUTO MIX toggle deciding whether audio follows video
 * on transitions at all.
 *
 * Policy per input slot, stored as `<kind>_input_<slot>_audio_send` in casparServer:
 *  - 'afv'    (default) audio follows video — embedded route audio plays when the look plays,
 *             but ONLY while the global auto-mix toggle (`audio_auto_mix`, default true) is on.
 *  - 'always' the input feeds its buses via the strip's persistent audio-only routes (layer band
 *             320+, live-audio-routing.js). The look-embedded copy is SUPPRESSED — the same
 *             signal twice on one bus comb-filters, it does not get louder.
 *  - 'never'  embedded audio suppressed unconditionally.
 *
 * Suppression happens where audio actually flows: the look layer's MIXER VOLUME on the program
 * channel. Host-channel volume is useless for layer routes (f343e5e — a layer route taps the
 * source BEFORE the host mixer).
 */
'use strict'

const VALID_POLICIES = new Set(['afv', 'always', 'never'])

/** Input kinds whose video can appear in a look and whose host key carries the policy. */
const POLICY_KINDS = new Set(['decklink', 'v4l2'])

/**
 * @param {object} config app config
 * @param {string} kind 'decklink' | 'v4l2'
 * @param {number} slot 1-based
 * @returns {'afv'|'always'|'never'}
 */
function liveInputAudioSendPolicy(config, kind, slot) {
	const cs = config?.casparServer && typeof config.casparServer === 'object' ? config.casparServer : config || {}
	const raw = String(cs[`${kind}_input_${slot}_audio_send`] || '').trim().toLowerCase()
	return VALID_POLICIES.has(raw) ? raw : 'afv'
}

/**
 * @param {object} config
 * @returns {boolean} mixer-wide auto-mix (audio follows video on take). Default true.
 */
function isAutoMixEnabled(config) {
	const cs = config?.casparServer && typeof config.casparServer === 'object' ? config.casparServer : config || {}
	const v = cs.audio_auto_mix
	return !(v === false || v === 'false' || v === 0)
}

/**
 * Which live input (if any) a scene-layer source routes to.
 * Matches `route://<hostCh>` and `route://<hostCh>-<layer>` against the channel map's input hosts.
 * @param {object} config
 * @param {{ type?: string, value?: string } | null | undefined} source
 * @returns {{ kind: string, slot: number, channel: number, layer: number } | null}
 */
function resolveLiveInputForSource(config, source) {
	const v = String(source?.value || '').trim()
	const m = /^route:\/\/(\d+)(?:-(\d+))?$/.exec(v)
	if (!m) return null
	const ch = parseInt(m[1], 10)
	const layer = m[2] != null ? parseInt(m[2], 10) : null
	let inputChannels
	try {
		const { getChannelMap } = require('../config/routing')
		inputChannels = getChannelMap(config || {})?.inputChannels || []
	} catch {
		return null
	}
	for (const e of inputChannels) {
		if (!e || !POLICY_KINDS.has(String(e.kind))) continue
		if (Number(e.channel) !== ch) continue
		// A bare channel route to an input host still carries that input's audio.
		if (layer != null && Number(e.layer) !== layer) continue
		return { kind: String(e.kind), slot: Number(e.slot), channel: Number(e.channel), layer: Number(e.layer) }
	}
	return null
}

/**
 * The mixer's routed target channels for an input — the server-side copy of the Ch buttons.
 * Stored as `<kind>_input_<slot>_audio_targets` (array of program channel numbers) so the TAKE
 * pipeline can honor the matrix; the client keeps its localStorage copy for route start/stop.
 * @param {object} config
 * @param {string} kind
 * @param {number} slot
 * @returns {number[]}
 */
function liveInputAudioTargets(config, kind, slot) {
	const cs = config?.casparServer && typeof config.casparServer === 'object' ? config.casparServer : config || {}
	const raw = cs[`${kind}_input_${slot}_audio_targets`]
	if (!Array.isArray(raw)) return []
	return raw.map((v) => parseInt(String(v), 10)).filter((n) => Number.isFinite(n) && n >= 1)
}

/**
 * The MIXER VOLUME a take must set on a scene layer, with the audio-send policy applied.
 * Non-live-input layers keep the authored volume exactly as before.
 *
 * Owner (todos21.07.26): "i dont want that audio to appear on ch3, in audio mixer it is not
 * selected to route to ch3 yet it plays on ch3 when on pgm" — the route matrix must be
 * authoritative. So under 'afv': the embedded copy follows video ONLY while the input has no
 * routed targets at all. The moment any Ch button is lit, the matrix rules: audio arrives solely
 * via the audio-only routes on the targeted channels and the embedded copy is silenced everywhere
 * — which is also what makes doubling structurally impossible (one signal path at a time, never
 * both).
 * @param {object} config
 * @param {{ muted?: boolean, volume?: number|null, source?: object }} layer
 * @returns {number}
 */
function resolveTakeVolumeForSceneLayer(config, layer) {
	const authored = layer?.muted ? 0 : layer?.volume != null ? Number(layer.volume) : 1
	const input = resolveLiveInputForSource(config, layer?.source)
	if (!input) return authored
	const policy = liveInputAudioSendPolicy(config, input.kind, input.slot)
	if (policy === 'never' || policy === 'always') return 0
	if (!isAutoMixEnabled(config)) return 0
	return liveInputAudioTargets(config, input.kind, input.slot).length === 0 ? authored : 0
}

module.exports = {
	VALID_POLICIES,
	liveInputAudioTargets,
	liveInputAudioSendPolicy,
	isAutoMixEnabled,
	resolveLiveInputForSource,
	resolveTakeVolumeForSceneLayer,
}
