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
 * WO-293 — PGM destination layer band for non-ALSA input kinds (DeckLink, NDI). Kept clear of
 * the live-audio band (which starts at liveUi.pgmLayer, normally 1) and of look/timeline layers.
 */
export const INPUT_PGM_AUDIO_LAYER_BASE = 320

/**
 * Destination layer on a program channel for an input strip's audio-only route.
 * @param {string} kind
 * @param {number} slot - 1-based
 * @param {{ pgmLayer?: number } | null | undefined} liveUi
 */
export function pgmDestLayerForInput(kind, slot, liveUi) {
	if (String(kind || '') === 'live_audio') return pgmDestLayerForSlot(slot, liveUi)
	return INPUT_PGM_AUDIO_LAYER_BASE + Math.max(1, parseInt(String(slot), 10) || 1)
}

/**
 * Route string for an input strip. ALSA slots resolve through the channel map (their route has
 * no layer part); every other kind carries its own `route` from the channel map entry.
 * @param {object | null | undefined} channelMap
 * @param {{ inputKind?: string, slot?: number, route?: string | null }} row
 */
export function inputRouteForRow(channelMap, row) {
	if (String(row?.inputKind || '') === 'live_audio') return dedicatedInputRoute(channelMap, row?.slot)
	const r = String(row?.route || '').trim()
	return r.startsWith('route://') ? r : null
}

/**
 * Start an input strip's audio-only route on a program channel.
 * @param {{ inputKind?: string, slot?: number, route?: string | null }} row
 * @param {number} pgmCh
 * @param {object | null | undefined} channelMap
 * @param {{ pgmAudioOnly?: boolean, pgmLayer?: number } | null | undefined} liveUi
 */
export async function enableInputPgmRoute(row, pgmCh, channelMap, liveUi) {
	const route = inputRouteForRow(channelMap, row)
	if (!route) {
		throw new Error('Dedicated input channel not allocated — Apply Device View config and restart Caspar.')
	}
	const layer = pgmDestLayerForInput(row?.inputKind, row?.slot, liveUi)
	await playRouteOnChannel(pgmCh, layer, route, { audioOnly: liveUi?.pgmAudioOnly !== false })
	return { channel: pgmCh, layer }
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
