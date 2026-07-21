import { api } from './api-client.js'
import { volumeApiPayload } from './audio-volume-scale.js'

/**
 * Apply a live mixer fader.
 *
 * WO-310: this used to do BOTH — fire `MIXER ch-l VOLUME <dB>` straight at AMCP via
 * postAmcpPreviewPipeline, then mirror the same move to REST with the LINEAR value. Two
 * commands ~20ms apart, in two different units, for one fader move.
 *
 * `MIXER … VOLUME` takes a LINEAR coefficient, not decibels — verified against this build
 * on 2026-07-21 (see the note on mixerVolume in src/caspar/amcp-mixer.js). The dB command was
 * therefore not a harmless duplicate: a fader at −60 dB sent the literal `-60`, which Caspar
 * stores verbatim as a linear gain. Only the linear mirror arriving a frame later covered it up.
 *
 * The REST route is now the single writer. It was already doing the same AMCP send (with the
 * linear value) AND carrying the route-consumer fanout (f343e5e), so the direct send was pure
 * duplication — dropping it removes the unit conflict and halves the per-fader work.
 *
 * @param {{ channel: number, layer?: number, master?: boolean, linearGain: number }} opts
 */
export async function postAudioVolume(opts) {
	const { channel, layer, master, linearGain } = opts
	const ch = Number(channel)
	if (!Number.isFinite(ch) || ch < 1) return
	if (!master) {
		const ln = Number(layer)
		if (!Number.isFinite(ln) || ln < 1) return
	}
	try {
		await api.post('/api/audio/volume', {
			channel: ch,
			...(master ? { master: true } : { layer: Number(layer) }),
			...volumeApiPayload(linearGain),
		})
	} catch (e) {
		// Sole writer now: if this fails the gain did NOT reach Caspar. Say so plainly —
		// the old message claimed "AMCP applied", which is no longer true.
		console.warn('[AudioVolume] volume NOT applied (REST write failed):', e?.message || e)
	}
}

/** @param {() => void | Promise<void>} fn @param {number} [ms] */
export function debounceAsync(fn, ms = 80) {
	let timer = null
	return () => {
		if (timer) clearTimeout(timer)
		timer = setTimeout(() => {
			timer = null
			void fn()
		}, ms)
	}
}
