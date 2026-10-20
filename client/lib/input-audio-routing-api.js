/**
 * WO-604 slice 3 — live-input audio routing is composed on the server (src/audio/input-audio-routing.js) for the
 * config-persisted kinds. The client only posts the operator's intent; targets come from config, not localStorage.
 */
import { api } from './api-client.js'

/** DeckLink / v4l2: targets in `<kind>_input_<slot>_audio_targets`, routes replayed by the server (WO-312). */
export function isServerRoutedKind(kind) {
	return kind === 'decklink' || kind === 'v4l2'
}

/** @param {Record<string, unknown>} cs casparServer settings @param {string} kind @param {number} slot */
export function serverAudioTargets(cs, kind, slot) {
	const raw = cs?.[`${kind}_input_${slot}_audio_targets`]
	return Array.isArray(raw) ? raw.map((v) => parseInt(String(v), 10)).filter((n) => Number.isFinite(n) && n >= 1) : []
}

/** The Ch button: route (or unroute) the input's audio onto a program channel. */
export function postInputRoute(kind, slot, channel, on) {
	return api.post('/api/audio/inputs/route', { kind, slot, channel, on })
}

/** @param {'afv' | 'always' | 'never'} send */
export function postInputSend(kind, slot, send) {
	return api.post('/api/audio/inputs/send', { kind, slot, send })
}

export function postAutoMix(on) {
	return api.post('/api/audio/auto-mix', { on })
}
