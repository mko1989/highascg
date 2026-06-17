'use strict'

const { getRouteString, readCasparSetting } = require('./routing-map')
const {
	LOOK_LAYER_MIN,
	PGM_AUDIO_TRACK_LAYER_MAX,
	isPgmAudioTrackPhysicalLayerOnChannel,
} = require('../engine/look-layer-ranges')

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
 * Extract hw card,device from alsa:// or hw: style URIs for conflict checks.
 * @param {string} raw
 * @returns {string|null} e.g. "0,0"
 */
function parseAlsaHwIdentity(raw) {
	const s = String(raw || '').trim().split(/\s+/)[0]
	if (!s) return null
	const uri = normalizeAlsaCaptureUri(s).replace(/^alsa:\/\//i, '')
	const m = uri.match(/^(?:plug)?hw:(\d+),(\d+)/i)
	return m ? `${m[1]},${m[2]}` : null
}

/**
 * Caspar ffmpeg producer accepts `-buffer_size N` after the clip on PLAY (reduces ALSA xruns).
 * @param {object} cfg
 * @returns {number|null}
 */
function resolveLiveAudioAlsaBufferSize(cfg) {
	const raw = readCasparSetting(cfg, 'live_audio_alsa_buffer_size')
	if (raw === false || raw === 'false' || raw === 0 || raw === '0') return null
	const n = parseInt(String(raw ?? 131072), 10)
	return Number.isFinite(n) && n > 0 ? n : null
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
	const uri = resolveLiveAudioInputDevice(cfg, slot)
	if (!uri) return null
	const buf = resolveLiveAudioAlsaBufferSize(cfg)
	if (buf == null) return uri
	return `${uri} -buffer_size ${buf}`
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

/**
 * PGM layers used by live_audio_pgm_always_on routes (must stay within audio track slots 1–9).
 * @param {object} cfg
 * @returns {Array<{ channel: number, layer: number, slot: number }>}
 */
function listLiveAudioPgmProtectedLayers(cfg) {
	const alwaysOn =
		readCasparSetting(cfg, 'live_audio_pgm_always_on') !== false &&
		readCasparSetting(cfg, 'live_audio_pgm_always_on') !== 'false'
	if (!alwaysOn) return []
	const { slots } = listConfiguredLiveAudioSlots(cfg)
	if (!slots.length) return []
	const screen = Math.max(1, parseInt(String(readCasparSetting(cfg, 'live_audio_pgm_screen') ?? 1), 10) || 1)
	const baseLayer = Math.min(
		PGM_AUDIO_TRACK_LAYER_MAX,
		Math.max(1, parseInt(String(readCasparSetting(cfg, 'live_audio_pgm_layer') ?? 2), 10) || 2),
	)
	const { getChannelMap } = require('./routing-map')
	const pgmCh = getChannelMap(cfg).programCh(screen)
	if (!Number.isFinite(pgmCh) || pgmCh < 1) return []
	return slots
		.map((slot, i) => ({
			channel: pgmCh,
			layer: baseLayer + i,
			slot: slot.slot,
		}))
		.filter((p) => p.layer >= 1 && p.layer <= PGM_AUDIO_TRACK_LAYER_MAX)
}

/** @deprecated use isPgmAudioTrackPhysicalLayerOnChannel from look-layer-ranges */
function isLiveAudioPgmInfrastructureLayer(cfg, channel, physicalLayer) {
	return isPgmAudioTrackPhysicalLayerOnChannel(cfg, channel, physicalLayer)
}

module.exports = {
	LIVE_AUDIO_LAYER_BASE,
	LOOK_LAYER_MIN,
	PGM_AUDIO_TRACK_LAYER_MAX,
	normalizeAlsaCaptureUri,
	parseAlsaHwIdentity,
	resolveLiveAudioAlsaBufferSize,
	resolveLiveAudioInputDevice,
	resolveLiveAudioHostLayer,
	resolveLiveAudioChannel,
	resolveLiveAudioRouteString,
	resolveLiveAudioPlayClip,
	listConfiguredLiveAudioSlots,
	listLiveAudioPgmProtectedLayers,
	isLiveAudioPgmInfrastructureLayer,
}
