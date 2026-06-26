import { api } from './api-client.js'
import { postAmcpPreviewPipeline } from './amcp-preview-batch.js'
import { volumeApiPayload } from './audio-volume-scale.js'

/**
 * Build AMCP for live mixer faders (same layer form as preview push / scene take).
 * Layer VOLUME uses dB on this stack; channel MASTERVOLUME uses linear 0–1 (Caspar AMCP).
 * @param {{ channel: number, layer?: number, master?: boolean, linearGain: number }} opts
 * @returns {string[]}
 */
export function buildAudioVolumeAmcpCommands(opts) {
	const ch = Number(opts.channel)
	if (!Number.isFinite(ch) || ch < 1) return []
	const { volume, volumeDb } = volumeApiPayload(opts.linearGain)
	if (opts.master) {
		return [`MIXER ${ch} MASTERVOLUME ${volume}`]
	}
	const ln = Number(opts.layer)
	if (!Number.isFinite(ln) || ln < 1) return []
	return [`MIXER ${ch}-${ln} VOLUME ${volumeDb}`, `MIXER ${ch} COMMIT`]
}

/**
 * Apply live mixer fader to Caspar (AMCP), then mirror to REST for server state.
 * @param {{ channel: number, layer?: number, master?: boolean, linearGain: number }} opts
 */
export async function postAudioVolume(opts) {
	const commands = buildAudioVolumeAmcpCommands(opts)
	if (commands.length) {
		await postAmcpPreviewPipeline(commands)
	}
	try {
		const { channel, layer, master, linearGain } = opts
		await api.post('/api/audio/volume', {
			channel,
			...(master ? { master: true } : { layer }),
			...volumeApiPayload(linearGain),
		})
	} catch (e) {
		console.warn('[AudioVolume] REST mirror failed (AMCP applied):', e?.message || e)
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
