/**
 * Live audio routing — capture on dedicated input channels, PGM via route:// (never alsa:// on PGM).
 */
import { api } from './api-client.js'
import { liveAudioInputForSlot } from './input-channels.js'

/**
 * @param {number} slot - 1-based
 * @param {{ pgmLayer?: number } | null | undefined} liveUi
 */
export function pgmDestLayerForSlot(slot, liveUi) {
	const n = Math.max(1, parseInt(String(slot), 10) || 1)
	const base = Math.max(1, parseInt(String(liveUi?.pgmLayer ?? 1), 10) || 1)
	return base + (n - 1)
}

/**
 * @param {number} channel
 * @param {number} layer
 * @param {string} routeClip - e.g. route://5
 * @param {{ audioOnly?: boolean }} [opts]
 */
export async function playRouteOnChannel(channel, layer, routeClip, opts = {}) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	const ln = Math.max(1, parseInt(String(layer), 10) || 1)
	const clip = String(routeClip || '').trim()
	if (!clip.startsWith('route://')) throw new Error('Invalid route source')
	const cl = `${ch}-${ln}`
	await api.post('/api/raw', { cmd: `STOP ${cl}` })
	await api.post('/api/raw', { cmd: `MIXER ${cl} CLEAR` })
	await api.post('/api/raw', { cmd: `PLAY ${cl} ${clip}` })
	if (opts.audioOnly !== false) {
		await api.post('/api/raw', { cmd: `MIXER ${cl} OPACITY 0` })
	}
}

/**
 * @param {number} channel
 * @param {number} layer
 */
export async function clearRouteFromChannel(channel, layer) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	const ln = Math.max(1, parseInt(String(layer), 10) || 1)
	const cl = `${ch}-${ln}`
	await api.post('/api/raw', { cmd: `STOP ${cl}` })
	await api.post('/api/raw', { cmd: `MIXER ${cl} CLEAR` })
}

/**
 * @param {object | null | undefined} channelMap
 * @param {number} slot - 1-based
 */
export function dedicatedInputRoute(channelMap, slot) {
	return liveAudioInputForSlot(channelMap, slot)?.route ?? null
}

/**
 * Start ALSA capture on dedicated channels + server PGM routes.
 */
export async function applyLiveAudioCapture() {
	await api.post('/api/audio/live-inputs/apply', {})
}

/**
 * @param {number} slot - 1-based
 * @param {number} pgmCh
 * @param {object | null | undefined} channelMap
 * @param {{ pgmAudioOnly?: boolean, pgmLayer?: number } | null | undefined} liveUi
 */
export async function enableLiveAudioPgmRoute(slot, pgmCh, channelMap, liveUi) {
	const route = dedicatedInputRoute(channelMap, slot)
	if (!route) {
		throw new Error('Dedicated channel not allocated — Apply Device View config and restart Caspar.')
	}
	const layer = pgmDestLayerForSlot(slot, liveUi)
	await playRouteOnChannel(pgmCh, layer, route, { audioOnly: liveUi?.pgmAudioOnly !== false })
	return { channel: pgmCh, layer }
}

/**
 * @param {number} pgmCh
 * @param {number} layer
 */
export async function disableLiveAudioPgmRoute(pgmCh, layer) {
	await clearRouteFromChannel(pgmCh, layer)
}

/**
 * @param {number} slot - 1-based
 * @param {object | null | undefined} channelMap
 * @param {{ pgmAudioOnly?: boolean, pgmLayer?: number } | null | undefined} liveUi
 * @param {{ channel: number, layer: number }[]} targets
 */
export async function applyPgmRoutesForSlot(slot, channelMap, liveUi, targets) {
	const route = dedicatedInputRoute(channelMap, slot)
	if (!route || !Array.isArray(targets) || targets.length === 0) return
	for (const t of targets) {
		if (!t || typeof t !== 'object') continue
		const ch = Math.max(1, parseInt(String(t.channel), 10) || 0)
		const ln = Math.max(1, parseInt(String(t.layer), 10) || 0)
		if (!Number.isFinite(ch) || !Number.isFinite(ln)) continue
		await playRouteOnChannel(ch, ln, route, { audioOnly: liveUi?.pgmAudioOnly !== false })
	}
}
