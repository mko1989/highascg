/**
 * WO-604 slice 3 — live-input audio routing is composed on the server (src/audio/input-audio-routing.js) for the
 * config-persisted kinds. The client only posts the operator's intent; targets come from config, not localStorage.
 */
import { api } from './api-client.js'

/**
 * DeckLink / v4l2: targets in `<kind>_input_<slot>_audio_targets`, routes replayed by the server (WO-312).
 * WO-604 slice 5 — ALSA live audio too: targets in the WO-571 `live_audio_input_<slot>_pgm_channels`.
 */
export function isServerRoutedKind(kind) {
	return kind === 'decklink' || kind === 'v4l2' || kind === 'live_audio'
}

/** Last GET /api/audio/inputs/routing — only for an ALSA slot never saved (no key: the server's legacy fallback). */
let routingSnap = null

async function refreshInputRouting() {
	try {
		routingSnap = await api.get('/api/audio/inputs/routing')
	} catch {
		/* keep the last one */
	}
	return routingSnap
}

/** @param {Record<string, unknown>} cs casparServer settings @param {string} kind @param {number} slot */
export function serverAudioTargets(cs, kind, slot) {
	if (kind === 'live_audio') {
		const raw = cs?.[`live_audio_input_${slot}_pgm_channels`]
		if (raw == null) {
			const e = routingSnap?.inputs?.find?.((i) => i.kind === kind && Number(i.slot) === Number(slot))
			return Array.isArray(e?.targets) ? e.targets.map(Number) : []
		}
		return String(raw).split(/[,;\s]+/).map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n) && n >= 1)
	}
	const raw = cs?.[`${kind}_input_${slot}_audio_targets`]
	return Array.isArray(raw) ? raw.map((v) => parseInt(String(v), 10)).filter((n) => Number.isFinite(n) && n >= 1) : []
}

/**
 * A never-saved ALSA slot (no `live_audio_input_N_pgm_channels`) shows the server's legacy fallback targets: repaint its
 * Ch buttons once the routing snapshot is in.
 * @param {Iterable<HTMLElement>} buttons @param {string} activeClass @param {(b: HTMLElement) => number} chOf
 */
export function repaintUnsavedAlsaTargets(kind, slot, cs, buttons, activeClass, chOf) {
	if (kind !== 'live_audio' || cs?.[`live_audio_input_${slot}_pgm_channels`] != null) return
	void refreshInputRouting().then(() => {
		const on = new Set(serverAudioTargets(cs, kind, slot))
		for (const b of buttons) b.classList.toggle(activeClass, on.has(chOf(b)))
	})
}

/** The Ch button: route (or unroute) the input's audio onto a program channel. */
export async function postInputRoute(kind, slot, channel, on) {
	const res = await api.post('/api/audio/inputs/route', { kind, slot, channel, on })
	void refreshInputRouting()
	return res
}

/** @param {'afv' | 'always' | 'never'} send */
export function postInputSend(kind, slot, send) {
	return api.post('/api/audio/inputs/send', { kind, slot, send })
}

export function postAutoMix(on) {
	return api.post('/api/audio/auto-mix', { on })
}
