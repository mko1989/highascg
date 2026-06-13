'use strict'

const { getRouteString, readCasparSetting } = require('./routing-map')

/**
 * WO-53: each ALSA input has its own (cheap) channel; ALSA plays at this layer on that channel.
 * (Historically this was the base layer on a shared inputs host; kept as 10 for continuity.)
 */
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
 * Layer the ALSA producer plays on (its own dedicated channel — WO-53).
 * @param {number} _slot 1–8
 * @returns {number}
 */
function resolveLiveAudioHostLayer(_slot) {
	return LIVE_AUDIO_LAYER_BASE
}

/**
 * Dedicated Caspar channel for an ALSA input slot (WO-53).
 * @param {object} cfg
 * @param {number} slot 1–8
 * @returns {number|null}
 */
function resolveLiveAudioChannel(cfg, slot) {
	const { getChannelMap } = require('./routing-map')
	const map = getChannelMap(cfg)
	const chans = Array.isArray(map.liveAudioInputChannels) ? map.liveAudioInputChannels : []
	const n = parseInt(String(slot), 10)
	if (!Number.isFinite(n) || n < 1 || n > chans.length) return null
	return chans[n - 1]
}

/**
 * @param {object} cfg
 * @param {number} slot
 * @returns {string|null} route://… (full channel — its own channel hosts only this input) for looks/PGM
 */
function resolveLiveAudioRouteString(cfg, slot) {
	const ch = resolveLiveAudioChannel(cfg, slot)
	if (ch == null) return null
	return getRouteString(ch)
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
			channel: resolveLiveAudioChannel(cfg, i),
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
	resolveLiveAudioChannel,
	resolveLiveAudioRouteString,
	resolveLiveAudioPlayClip,
	listConfiguredLiveAudioSlots,
}
