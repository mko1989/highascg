'use strict'

const defaults = require('./defaults')
const { getChannelMap } = require('./routing')
const { padStringArray, padBoolArray, ffmpegPathFromAlsaId } = require('./config-generator-utils')
const { applyAudioPreviewToGeneratorConfig } = require('./audio-preview')

/**
 * Merge defaults, coerce stale `alsa`/`custom` without a sink to `default` (avoids ghost FFmpeg consumers).
 * @param {Record<string, unknown> | undefined} ar
 * @returns {Record<string, unknown>}
 */
function normalizeAudioRouting(ar) {
	const d = defaults.audioRouting || {}
	const base = { ...d, ...(ar && typeof ar === 'object' ? ar : {}) }
	const PAD = 4
	base.programSystemAudioDevices = padStringArray(base.programSystemAudioDevices, PAD)
	base.previewSystemAudioEnabled = padBoolArray(base.previewSystemAudioEnabled, PAD)
	base.previewSystemAudioDevices = padStringArray(base.previewSystemAudioDevices, PAD)
	let po = String(base.programOutput || 'default').toLowerCase()
	if (po === 'alsa') {
		const p = ffmpegPathFromAlsaId(base.programAlsaDevice)
		const custom = String(base.programFfmpegPath || '').trim()
		if (!p && !custom) base.programOutput = 'default'
	} else if (po === 'custom') {
		if (!String(base.programFfmpegPath || '').trim()) base.programOutput = 'default'
	}
	let mo = String(base.monitorOutput || 'default').toLowerCase()
	if (mo === 'alsa') {
		const p = ffmpegPathFromAlsaId(base.monitorAlsaDevice)
		const custom = String(base.monitorFfmpegPath || '').trim()
		if (!p && !custom) base.monitorOutput = 'default'
	} else if (mo === 'custom') {
		if (!String(base.monitorFfmpegPath || '').trim()) base.monitorOutput = 'default'
	}
	return base
}

/**
 * Flatten `config.audioRouting` (Settings UI) into generator keys used by this file.
 * @param {Record<string, unknown>} config
 * @returns {Record<string, unknown>}
 */
function mergeAudioRoutingIntoConfig(config) {
	const base = config && typeof config === 'object' ? config : {}
	const mergedAr = normalizeAudioRouting(base.audioRouting)
	const out = { ...base, audioRouting: mergedAr }
	const ar = mergedAr
	const screenCount = getChannelMap(out).screenCount
	const prevEn = ar.previewSystemAudioEnabled
	const prevDev = ar.previewSystemAudioDevices
	const ap = ar.audioPreview && typeof ar.audioPreview === 'object' ? ar.audioPreview : {}

	/**
	 * PGM `<system-audio>` is opt-in only (Device View audio output cabling →
	 * `applyAudioOutputOverridesToScreens`). Root OpenAL may still be declared in `<configuration>`;
	 * do not attach a channel consumer unless the operator wires one in the web client.
	 */
	const profile = String(out.caspar_build_profile || 'stock')
	for (let n = 1; n <= screenCount; n++) {
		if (!out[`screen_${n}_audio_layout`] || out[`screen_${n}_audio_layout`] === 'default') {
			out[`screen_${n}_audio_layout`] = 'stereo'
		}
		out[`screen_${n}_ffmpeg_audio_enabled`] = false
		out[`screen_${n}_ffmpeg_audio_path`] = ''
		out[`screen_${n}_ffmpeg_audio_args`] = ''
		out[`screen_${n}_ffmpeg_audio_path_2`] = ''
		out[`screen_${n}_ffmpeg_audio_args_2`] = ''
		const systemAudioAlreadyOn =
			out[`screen_${n}_system_audio_enabled`] === true || out[`screen_${n}_system_audio_enabled`] === 'true'
		if (!systemAudioAlreadyOn) {
			out[`screen_${n}_system_audio_enabled`] = false
			out[`screen_${n}_system_audio_device_name`] = ''
		}
		const apEn =
			ap.enabled === true ||
			ap.enabled === 'true' ||
			out.audio_preview_enabled === true ||
			out.audio_preview_enabled === 'true'
		const apBus = String(ap.bus ?? out.audio_preview_bus ?? 'preview_1').toLowerCase()
		const apScreen = Math.max(1, parseInt(String(ap.screenIndex ?? out.audio_preview_screen ?? n), 10) || n)
		const apDev = String(ap.deviceName ?? out.audio_preview_device_name ?? '').trim()
		const previewBusOn =
			prevEn[n - 1] === true || (apEn && apBus !== 'multiview' && apScreen === n)
		out[`screen_${n}_preview_system_audio_enabled`] = previewBusOn
		out[`screen_${n}_preview_system_audio_device_name`] =
			previewBusOn && apDev ? apDev : prevDev[n - 1] || ''
		/** PortAudio (PR #1720) replaces OpenAL program output for this screen — avoid duplicate consumers */
		if (
			profile === 'custom_live' &&
			(out[`screen_${n}_portaudio_enabled`] === true || out[`screen_${n}_portaudio_enabled`] === 'true')
		) {
			out[`screen_${n}_system_audio_enabled`] = false
		}
	}

	const po = String(ar.programOutput || 'default').toLowerCase()
	// Do not reset screen_1_ndi_enabled: Settings → Screens persists per-screen NDI flags in
	// casparServer; those are already on `out` from `base`. Only auto-enable when program
	// audio output is explicitly NDI (legacy coupling).
	if (po === 'ndi') {
		out.screen_1_ndi_enabled = true
	}

	// Extra Caspar audio-only channels removed from Settings UI — always zero for generated config.
	out.extra_audio_channel_count = 0

	applyAudioPreviewToGeneratorConfig(out)

	return out
}

/**
 * @param {Record<string, unknown>} config
 * @returns {string[]}
 */
function getProgramChannelAudioLayouts(config) {
	const screenCount = getChannelMap(config).screenCount
	const out = []
	for (let n = 1; n <= screenCount; n++) {
		out.push(String(config[`screen_${n}_audio_layout`] || 'default'))
	}
	return out
}

/**
 * @param {Record<string, unknown>} config
 * @returns {string[]} layout id per extra audio channel (same order as channel map)
 */
function getExtraAudioChannelLayouts(config) {
	const n = Math.min(4, Math.max(0, parseInt(String(config.extra_audio_channel_count || 0), 10) || 0))
	const out = []
	for (let i = 1; i <= n; i++) {
		out.push(String(config[`extra_audio_${i}_audio_layout`] || 'default'))
	}
	return out
}

module.exports = {
	normalizeAudioRouting,
	mergeAudioRoutingIntoConfig,
	getProgramChannelAudioLayouts,
	getExtraAudioChannelLayouts,
}
