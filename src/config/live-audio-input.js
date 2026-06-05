'use strict'

const { getRouteString, readCasparSetting } = require('./routing-map')

/** First layer index on the shared inputs host for ALSA slots (DeckLink uses 1–8). */
const LIVE_AUDIO_LAYER_BASE = 10

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizeAlsaCaptureUri(raw) {
	const s = String(raw || '').trim()
	if (!s) return ''
	if (/^alsa:\/\//i.test(s)) return s
	if (/^hw:/i.test(s) || /^plughw:/i.test(s) || /^default/i.test(s)) return `alsa://${s}`
	return `alsa://${s}`
}

/**
 * @param {object} cfg
 * @param {number} slot 1–8
 * @returns {string}
 */
function resolveLiveAudioInputDevice(cfg, slot) {
	const raw = readCasparSetting(cfg, `live_audio_input_${slot}_device`)
	return normalizeAlsaCaptureUri(raw)
}

/**
 * @param {number} slot 1–8
 * @returns {number}
 */
function resolveLiveAudioHostLayer(slot) {
	const n = parseInt(String(slot), 10)
	if (!Number.isFinite(n) || n < 1) return LIVE_AUDIO_LAYER_BASE
	return LIVE_AUDIO_LAYER_BASE + n - 1
}

/**
 * @param {object} cfg
 * @param {number} slot
 * @returns {string|null} route://… for use in looks
 */
function resolveLiveAudioRouteString(cfg, slot) {
	const { getChannelMap } = require('./routing-map')
	const map = getChannelMap(cfg)
	if (!map.inputsEnabled || map.inputsCh == null) return null
	return getRouteString(map.inputsCh, resolveLiveAudioHostLayer(slot))
}

/**
 * @param {object} cfg
 * @param {number} slot
 * @returns {string|null} AMCP PLAY clip (alsa://…)
 */
function resolveLiveAudioPlayClip(cfg, slot) {
	return resolveLiveAudioInputDevice(cfg, slot) || null
}

/**
 * @param {object} cfg
 * @returns {{ count: number, slots: Array<{ slot: number, layer: number, device: string, clip: string, route: string|null }> }}
 */
function listConfiguredLiveAudioSlots(cfg) {
	const count = Math.min(8, Math.max(0, parseInt(String(readCasparSetting(cfg, 'live_audio_input_count') ?? 0), 10) || 0))
	const slots = []
	for (let i = 1; i <= count; i++) {
		const clip = resolveLiveAudioPlayClip(cfg, i)
		if (!clip) continue
		slots.push({
			slot: i,
			layer: resolveLiveAudioHostLayer(i),
			device: readCasparSetting(cfg, `live_audio_input_${i}_device`),
			clip,
			route: resolveLiveAudioRouteString(cfg, i),
		})
	}
	return { count, slots }
}

module.exports = {
	LIVE_AUDIO_LAYER_BASE,
	normalizeAlsaCaptureUri,
	resolveLiveAudioInputDevice,
	resolveLiveAudioHostLayer,
	resolveLiveAudioRouteString,
	resolveLiveAudioPlayClip,
	listConfiguredLiveAudioSlots,
}
