/**
 * When a mixer input strip may show VU activity (playing + carries audio).
 * Uses live Caspar OSC layer state — not scene definitions alone.
 */
import { fileHasPlaybackHints, getInfoLayerRow, infoLayerToPlaybackHints } from '../components/playback-timer.js'

/** Caspar STREAM / UDP metering consumers (e.g. L96) — not program content. */
export function isMeterUtilityOscLayer(layerNum, layer) {
	const n = Number(layerNum)
	if (!Number.isFinite(n) || n < 90) return false
	const path = String(layer?.file?.path || layer?.path || '').toLowerCase()
	const name = String(layer?.file?.name || '').toLowerCase()
	return path.includes('udp://') || path.includes('stream') || name.includes('stream')
}

/**
 * @param {import('./state-store.js').StateStore} stateStore
 * @param {number} chNum
 */
function findChannelEntry(stateStore, chNum) {
	const channels = stateStore?.getState?.()?.channels
	if (!Array.isArray(channels)) return null
	return channels.find((c) => c && (Number(c.id) === chNum || Number(c.channel) === chNum)) ?? null
}

/**
 * @param {object | null | undefined} chEntry
 * @param {number} layerNum
 */
function findInfoLayerRow(chEntry, layerNum) {
	const direct = getInfoLayerRow(chEntry, layerNum)
	if (direct) return direct
	const ly = chEntry?.layers
	if (!ly || typeof ly !== 'object') return null
	for (const key of Object.keys(ly)) {
		const row = ly[key]
		if (!row || typeof row !== 'object') continue
		const n = parseInt(String(row.layer ?? row.layerNum ?? row.index ?? key), 10)
		if (n === layerNum) return row
	}
	return null
}

function oscContentLayerNums(chState) {
	const out = []
	for (const key of Object.keys(chState?.layers || {})) {
		const n = parseInt(key, 10)
		if (!Number.isFinite(n)) continue
		const ly = chState.layers[key]
		if (isMeterUtilityOscLayer(n, ly)) continue
		const t = String(ly?.type || '').toLowerCase()
		if (t && t !== 'empty') {
			out.push(n)
			continue
		}
		if (fileHasPlaybackHints(ly?.file) || String(ly?.file?.name || ly?.file?.path || '').trim()) {
			out.push(n)
		}
	}
	return out
}

/**
 * True when this specific layer is on-air on the channel (not other idle scene layers).
 * @param {import('./osc-client.js').OscClient | null} oscClient
 * @param {import('./state-store.js').StateStore} stateStore
 * @param {{ muted?: boolean, layer?: number, expectAudio?: boolean, sourceType?: string }} [hints]
 */
export function isLayerStripOnAir(chNum, layerNum, oscClient, stateStore, hints) {
	if (hints?.muted) return false

	const key = String(chNum)
	const chState = oscClient?.channels?.[key] ?? oscClient?.channels?.[chNum]
	const oscLayer = chState?.layers?.[layerNum] ?? chState?.layers?.[String(layerNum)]

	if (oscLayer && !isMeterUtilityOscLayer(layerNum, oscLayer)) {
		if (oscLayer.paused === true) return false
		const sp = oscLayer.speed ?? oscLayer.playbackSpeed ?? oscLayer.file?.speed
		if (sp === 0 || sp === '0') return false

		const t = String(oscLayer.type || '').toLowerCase()
		if (t && t !== 'empty') return true
		if (fileHasPlaybackHints(oscLayer.file)) return true
		const clip = String(oscLayer.file?.name || oscLayer.file?.path || '').trim()
		if (clip) return true
	}

	const infoLayer = findInfoLayerRow(findChannelEntry(stateStore, chNum), layerNum)
	const infoClip = infoLayer?.fgClip != null ? String(infoLayer.fgClip).trim() : String(infoLayer?.clip || '').trim()
	if (infoClip) return true
	if (infoLayerToPlaybackHints(infoLayer)) return true

	const onAirOsc = oscContentLayerNums(chState)
	if (onAirOsc.includes(layerNum)) return true

	return false
}

/**
 * @param {object | null | undefined} layer
 * @param {{ sourceType?: string }} [hints]
 */
export function oscLayerIsPlaying(layer, hints) {
	if (!layer || typeof layer !== 'object') return false
	const t = String(layer.type || '').toLowerCase()
	if (t === 'empty' && !fileHasPlaybackHints(layer?.file)) return false
	if (!t && !fileHasPlaybackHints(layer?.file) && !layer.file?.name) return false
	if (layer.paused === true) return false

	const path = String(layer.file?.path || layer.path || '').toLowerCase()
	const producer = String(layer.producer || '').toLowerCase()
	if (String(layer.type || '').toLowerCase() === 'route') return true
	const isContinuousCapture =
		hints?.sourceType === 'live_audio' ||
		t.includes('alsa') ||
		producer.includes('alsa') ||
		path.includes('alsa://')
	if (isContinuousCapture) return true

	const sp = layer.speed ?? layer.playbackSpeed ?? layer.file?.speed
	if (sp === 0 || sp === '0') return false
	return true
}

/**
 * @param {object | null | undefined} layer
 * @param {{ sourceType?: string, expectAudio?: boolean }} [hints]
 */
export function oscLayerHasAudio(layer, hints) {
	if (!layer || typeof layer !== 'object') return false
	if (hints?.expectAudio === false) return false

	const t = String(layer.type || '').toLowerCase()
	const producer = String(layer.producer || '').toLowerCase()
	const path = String(layer.file?.path || layer.path || '').toLowerCase()

	if (t === 'empty' && !fileHasPlaybackHints(layer?.file) && !layer.file?.name) return false
	if (t === 'html' || t === 'template' || t === 'scene' || t === 'image') return false
	if (t === 'route' || t === 'audio') return true
	if (t.includes('alsa') || producer.includes('alsa') || path.includes('alsa://')) return true

	const hintTy = String(hints?.sourceType || '').toLowerCase()
	if (hintTy === 'live_audio') return true

	const f = layer.file
	if (f?.audio && typeof f.audio === 'object') {
		if (f.audio.present === false || f.audio.hasAudio === false) return false
		if (f.audio.codec || (Number(f.audio.channels) || 0) > 0) return true
	}

	if (t === 'ffmpeg' || t === 'file' || t === 'video' || f?.path || f?.name) {
		if (f?.video && (f.audio === null || f.audio === false)) return false
		if (hints?.expectAudio === true) return true
		return !!(f?.audio && typeof f.audio === 'object')
	}

	return hints?.expectAudio === true
}

/**
 * @param {object | null | undefined} layer
 * @param {{ sourceType?: string, expectAudio?: boolean, muted?: boolean }} [hints]
 */
export function oscLayerEligibleForMeter(layer, hints) {
	if (hints?.muted) return false
	if (!oscLayerIsPlaying(layer, hints)) return false
	return oscLayerHasAudio(layer, hints)
}
