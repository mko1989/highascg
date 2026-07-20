/**
 * Standard CasparCG video modes and dimension helpers (split from config-generator for WO T7.1).
 * @see companion-module-casparcg-server/src/config-generator.js
 */
'use strict'

/** @type {Record<string, { width: number, height: number, fps: number }>} */
const STANDARD_VIDEO_MODES = {
	PAL: { width: 720, height: 576, fps: 25 },
	NTSC: { width: 720, height: 486, fps: 29.97 },
	'576p2500': { width: 720, height: 576, fps: 25 },
	'720p2398': { width: 1280, height: 720, fps: 23.98 },
	'720p2400': { width: 1280, height: 720, fps: 24 },
	'720p2500': { width: 1280, height: 720, fps: 25 },
	'720p5000': { width: 1280, height: 720, fps: 50 },
	'720p2997': { width: 1280, height: 720, fps: 29.97 },
	'720p5994': { width: 1280, height: 720, fps: 59.94 },
	'720p3000': { width: 1280, height: 720, fps: 30 },
	'720p6000': { width: 1280, height: 720, fps: 60 },
	'1080p2398': { width: 1920, height: 1080, fps: 23.98 },
	'1080p2400': { width: 1920, height: 1080, fps: 24 },
	'1080p2500': { width: 1920, height: 1080, fps: 25 },
	'1080p5000': { width: 1920, height: 1080, fps: 50 },
	'1080p2997': { width: 1920, height: 1080, fps: 29.97 },
	'1080p5994': { width: 1920, height: 1080, fps: 59.94 },
	'1080p3000': { width: 1920, height: 1080, fps: 30 },
	'1080p6000': { width: 1920, height: 1080, fps: 60 },
	'1080i5000': { width: 1920, height: 1080, fps: 50 },
	'1080i5994': { width: 1920, height: 1080, fps: 59.94 },
	'1080i6000': { width: 1920, height: 1080, fps: 60 },
	'1556p2398': { width: 2048, height: 1556, fps: 23.98 },
	'1556p2400': { width: 2048, height: 1556, fps: 24 },
	'1556p2500': { width: 2048, height: 1556, fps: 25 },
	'2160p2398': { width: 3840, height: 2160, fps: 23.98 },
	'2160p2400': { width: 3840, height: 2160, fps: 24 },
	'2160p2500': { width: 3840, height: 2160, fps: 25 },
	'2160p2997': { width: 3840, height: 2160, fps: 29.97 },
	'2160p3000': { width: 3840, height: 2160, fps: 30 },
	'2160p5000': { width: 3840, height: 2160, fps: 50 },
	'2160p5994': { width: 3840, height: 2160, fps: 59.94 },
	'2160p6000': { width: 3840, height: 2160, fps: 60 },
	'dci1080p2398': { width: 2048, height: 1080, fps: 23.98 },
	'dci1080p2400': { width: 2048, height: 1080, fps: 24 },
	'dci1080p2500': { width: 2048, height: 1080, fps: 25 },
	'dci2160p2398': { width: 4096, height: 2160, fps: 23.98 },
	'dci2160p2400': { width: 4096, height: 2160, fps: 24 },
	'dci2160p2500': { width: 4096, height: 2160, fps: 25 },
}

/**
 * Shorthand/legacy aliases for standard Caspar video mode IDs.
 * Maps canonical-named modes (e.g. '1080p50') to their full Caspar time-scale
 * equivalents (e.g. '1080p5000').
 * @type {Record<string, string>}
 */
const STANDARD_VIDEO_MODE_ALIASES = {
	'1080p50': '1080p5000',
	'720p50': '720p5000',
	'1080p60': '1080p6000',
	'720p60': '720p6000',
	'1080p59.94': '1080p5994',
	'720p59.94': '720p5994',
	'1080p25': '1080p2500',
	'720p25': '720p2500',
	'1080p24': '1080p2400',
	'720p24': '720p2400',
	'1080p23.98': '1080p2398',
	'720p23.98': '720p2398',
	'1080p30': '1080p3000',
	'720p30': '720p3000',
	'1080p29.97': '1080p2997',
	'720p29.97': '720p2997',
	'2160p50': '2160p5000',
	'2160p60': '2160p6000',
	'2160p59.94': '2160p5994',
	'2160p25': '2160p2500',
	'2160p24': '2160p2400',
	'2160p23.98': '2160p2398',
	'2160p30': '2160p3000',
	'2160p29.97': '2160p2997',
}

/**
 * Normalize shorthand/legacy video mode IDs to canonical STANDARD_VIDEO_MODES keys.
 * @param {string} raw
 * @returns {string}
 */
function normalizeVideoModeId(raw) {
	const id = String(raw || '').trim()
	if (!id) return ''
	if (id === 'custom') return 'custom'
	const aliased = STANDARD_VIDEO_MODE_ALIASES[id] || id
	return aliased
}

/**
 * Pixel size for a Caspar `video-mode` id from INFO CONFIG (standard preset or WxH custom id).
 * @param {string} vm
 * @returns {{ width: number, height: number }}
 */
function pixelSizeForVideoMode(vm) {
	const id = String(vm || '').trim()
	const std = STANDARD_VIDEO_MODES[id]
	if (std) return { width: std.width, height: std.height }
	const m = id.match(/^(\d+)x(\d+)$/i)
	if (m) return { width: parseInt(m[1], 10) || 1920, height: parseInt(m[2], 10) || 1080 }
	return { width: 1920, height: 1080 }
}

/**
 * Caspar custom video-mode `cadence` element: **48000 Hz / fps** (48 kHz audio clock per frame).
 * Examples: 50 fps → 960, 60 fps → 800, 25 fps → 1920.
 * @param {number} fps
 * @returns {number}
 */
function calculateCadence(fps) {
	return Math.round(48000 / fps)
}

/**
 * Read a per-screen Caspar field from root config or nested `casparServer`.
 * @param {Record<string, unknown>} config
 * @param {number} screenIdx - 1-based
 * @param {string} suffix - e.g. `custom_width`
 */
function readScreenConfigValue(config, screenIdx, suffix) {
	if (!config || typeof config !== 'object') return undefined
	const key = `screen_${screenIdx}_${suffix}`
	if (Object.prototype.hasOwnProperty.call(config, key)) return config[key]
	const cs = config.casparServer && typeof config.casparServer === 'object' ? config.casparServer : null
	if (cs && Object.prototype.hasOwnProperty.call(cs, key)) return cs[key]
	return undefined
}

/**
 * @param {string} modeId
 * @param {Record<string, unknown>} config
 * @param {number} screenIdx - 1-based screen index
 * @returns {{ width: number, height: number, fps: number, modeId: string, isCustom: boolean }}
 */
function getModeDimensions(modeId, config, screenIdx) {
	if (modeId === 'custom') {
		const w = parseInt(String(readScreenConfigValue(config, screenIdx, 'custom_width') || '1920'), 10) || 1920
		const h = parseInt(String(readScreenConfigValue(config, screenIdx, 'custom_height') || '1080'), 10) || 1080
		const fps = parseFloat(String(readScreenConfigValue(config, screenIdx, 'custom_fps') || '50')) || 50
		return { width: w, height: h, fps, modeId: `${w}x${h}`, isCustom: true }
	}
	// Normalize aliases like '1080p50' to '1080p5000'
	const normalized = normalizeVideoModeId(modeId)
	const std = STANDARD_VIDEO_MODES[normalized]
	if (std) return { ...std, modeId: normalized, isCustom: false }
	const px = String(normalized || '').match(/^(\d+)x(\d+)p?([\d.]+)?$/i)
	if (px) {
		const w = parseInt(px[1], 10) || 1920
		const h = parseInt(px[2], 10) || 1080
		const fps = px[3] ? parseFloat(px[3]) : 50
		return { width: w, height: h, fps: Number.isFinite(fps) && fps > 0 ? fps : 50, modeId: `${w}x${h}`, isCustom: true }
	}
	return { width: 1920, height: 1080, fps: 50, modeId: normalized || '1080p5000', isCustom: false }
}

/** @see companion docs/casparcg-multichannel-audio.md */
const AUDIO_LAYOUT_CHOICES = [
	{ id: 'default', label: 'Default (Caspar)' },
	{ id: 'stereo', label: 'stereo (2ch)' },
	{ id: 'mono', label: 'mono (1ch)' },
	{ id: '8ch', label: '8ch' },
	{ id: 'dolby-e', label: 'dolby-e (8ch)' },
	{ id: 'dts', label: 'dts (5.1)' },
	{ id: 'matrix', label: 'matrix (passthrough)' },
	{ id: 'live-8ch', label: 'live-8ch (custom 8ch order)' },
]

/**
 * @param {string} layout - audio_layout id
 * @returns {number} channel count for FFmpeg -ac
 */
function layoutChannelCount(layout) {
	const l = String(layout || 'default').toLowerCase()
	switch (l) {
		case 'mono':
			return 1
		case '4ch':
			return 4
		case 'stereo':
		case 'default':
			return 2
		case 'dts':
			return 6
		case '16ch':
			return 16
		case '8ch':
		case 'dolby-e':
		case 'matrix':
		case 'live-8ch':
		case 'discrete-8ch':
			return 8
		default:
			return 2
	}
}

/**
 * Video mode for an extra audio-only channel (match screen 1 or a standard preset).
 * @param {Record<string, unknown>} config
 * @param {number} idx1 - 1-based extra audio index
 */
function getExtraAudioModeDimensions(config, idx1) {
	const vm = String(config[`extra_audio_${idx1}_video_mode`] || 'match_screen1')
	if (vm === 'match_screen1') {
		const modeKey = String(config.screen_1_mode || '1080p5000')
		return getModeDimensions(modeKey, config, 1)
	}
	return getModeDimensions(vm, config, 1)
}

/**
 * Smallest-area standard `video-mode` id, restricted to integer frame rates so the 48 kHz audio
 * cadence stays clean (stable meters). NTSC (720×486) is technically smaller but uses fractional
 * 29.97 fps, so it is skipped in favor of PAL (720×576 @ 25). Used for cheap audio-meter channels.
 * @returns {string}
 */
function getLowestStandardVideoModeId() {
	let bestId = 'PAL'
	let bestArea = Infinity
	let bestFps = Infinity
	for (const [id, m] of Object.entries(STANDARD_VIDEO_MODES)) {
		if (!m || !Number.isInteger(m.fps)) continue
		const area = m.width * m.height
		if (area < bestArea || (area === bestArea && m.fps < bestFps)) {
			bestArea = area
			bestFps = m.fps
			bestId = id
		}
	}
	return bestId
}

/**
 * Video mode for dedicated ALSA input channels (WO-53).
 * Accepts both setting keys: `live_audio_inputs_channel_mode` (UI/settings) and
 * `live_audio_input_channel_mode` (legacy). Empty → cheapest integer-fps standard mode (PAL).
 * @param {Record<string, unknown>} [config]
 * @returns {string}
 */
function resolveLiveAudioInputChannelMode(config) {
	if (!config || typeof config !== 'object') return getLowestStandardVideoModeId()
	const cs = config.casparServer && typeof config.casparServer === 'object' ? config.casparServer : null
	const read = (key) => {
		if (cs && Object.prototype.hasOwnProperty.call(cs, key)) return cs[key]
		if (Object.prototype.hasOwnProperty.call(config, key)) return config[key]
		return undefined
	}
	const raw = String(
		read('live_audio_inputs_channel_mode') ?? read('live_audio_input_channel_mode') ?? '',
	).trim()
	if (raw && STANDARD_VIDEO_MODES[raw]) return raw
	return getLowestStandardVideoModeId()
}

/**
 * @returns {Array<{ id: string, label: string }>}
 */
function getStandardModeChoices() {
	const custom = { id: 'custom', label: 'Custom resolution' }
	const modes = Object.keys(STANDARD_VIDEO_MODES).map((id) => ({
		id,
		label: id,
	}))
	return [custom, ...modes]
}

module.exports = {
	STANDARD_VIDEO_MODES,
	calculateCadence,
	getModeDimensions,
	pixelSizeForVideoMode,
	normalizeVideoModeId,
	AUDIO_LAYOUT_CHOICES,
	layoutChannelCount,
	getExtraAudioModeDimensions,
	getStandardModeChoices,
	getLowestStandardVideoModeId,
	resolveLiveAudioInputChannelMode,
	// WO-242: pre-existing latent bug fix — project-fps.js requires this but it was never exported,
	// so inferProjectFpsFromConfig() threw "readScreenConfigValue is not a function" for any config
	// missing machineProfile.defaultProjectFps (e.g. handleAddDestination on a fresh install). Found
	// while adding the T242.7 CRUD smoke test; fixing since it's on the pixelmap "create destination"
	// path this WO relies on.
	readScreenConfigValue,
}
