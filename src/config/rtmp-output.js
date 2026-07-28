'use strict'

const { resolveOutputSourceToChannel } = require('./output-source-name')

const defaults = require('./defaults')
const { getChannelMap } = require('./routing')
const { escapeXml } = require('./config-generator-builders')
const { joinRtmpServerUrlAndStreamKey, getEffectiveRtmpDestinationUrl } = require('./rtmp-url')
const { buildStreamingRtmpFfmpegArgs } = require('../streaming/streaming-channel-ffmpeg')

/**
 * @param {Record<string, unknown>} config - flat generator config
 * @param {string} target - e.g. program_1, preview_1, multiview
 * @returns {number | null}
 */
function resolveInputTargetToChannel(config, target) {
	/* WO-378: one vocabulary — `channel_<N>` (any Caspar channel, incl. host channels),
	 * `program_<N>`/`preview_<N>` (screen buses), `multiview`. This used to carry its own copy of
	 * the program/preview regexes and did not know `channel_<N>` at all. */
	return resolveOutputSourceToChannel(getChannelMap(config), target || 'program_1')
}

/**
 * @param {Record<string, unknown>} config
 * @param {number} casparChannel
 * @returns {string}
 */
function buildRtmpFfmpegConsumersForChannel(config, casparChannel) {
	const rtmp = config.rtmp && typeof config.rtmp === 'object' ? config.rtmp : null
	if (!rtmp || rtmp.enabled === false || rtmp.enabled === 'false') return ''
	const list = Array.isArray(rtmp.destinations) ? rtmp.destinations : []
	let xml = ''
	for (const raw of list) {
		if (!raw || typeof raw !== 'object') continue
		if (raw.enabled === false || raw.enabled === 'false') continue
		const url = getEffectiveRtmpDestinationUrl(raw).trim()
		if (!url) continue
		const target = raw.inputTarget != null ? String(raw.inputTarget) : 'program_1'
		const ch = resolveInputTargetToChannel(config, target)
		if (ch == null || ch !== casparChannel) continue
		if (target.startsWith('program') && rtmp.programOutputsEnabled === false) continue
		if (target === 'multiview' && rtmp.multiviewOutputEnabled === false) continue
		if (target.startsWith('preview') && rtmp.previewOutputsEnabled === false) continue

		const vbr = Math.max(200, parseInt(String(raw.videoBitrateKbps || 2500), 10) || 2500)
		const preset = String(raw.encoderPreset || 'veryfast').trim() || 'veryfast'
		const audioMode = String(raw.audioSource || 'muxed').toLowerCase()
		const abr = Math.max(32, parseInt(String(raw.audioBitrateKbps || 128), 10) || 128)
		const ffmpegTail = buildStreamingRtmpFfmpegArgs('medium', {
			videoBitrateKbps: vbr,
			encoderPreset: preset,
			audioCodec: audioMode === 'none' || audioMode === 'off' ? 'none' : 'aac',
			audioBitrateKbps: abr,
		})
		const args = `${ffmpegTail} ${url}`
		xml += `
                <ffmpeg>
                    <path>-</path>
                    <args>${escapeXml(args)}</args>
                </ffmpeg>`
	}
	return xml
}

/**
 * Stable RTMP settings shape (4 destinations) for API + Caspar generator flat config.
 * @param {Record<string, unknown>|null|undefined} rtmpIn
 * @returns {Record<string, unknown>}
 */
function normalizeRtmpConfig(rtmpIn) {
	const base = defaults.rtmp && typeof defaults.rtmp === 'object' ? defaults.rtmp : {}
	const m = { ...base, ...(rtmpIn && typeof rtmpIn === 'object' ? rtmpIn : {}) }
	const tmpl = Array.isArray(base.destinations) ? base.destinations : []
	const src = Array.isArray(m.destinations) ? m.destinations : []
	const destinations = []
	for (let i = 0; i < 4; i++) {
		const a = src[i] && typeof src[i] === 'object' ? src[i] : {}
		const t = tmpl[i] && typeof tmpl[i] === 'object' ? tmpl[i] : {}
		const legacyUrl = String(a.rtmpUrl ?? a.url ?? t.rtmpUrl ?? t.url ?? '').trim()
		let serverUrl = String(a.rtmpServerUrl ?? t.rtmpServerUrl ?? '').trim()
		let streamKey = String(a.streamKey ?? t.streamKey ?? '').trim()
		if (!serverUrl && !streamKey && legacyUrl) {
			serverUrl = legacyUrl
		}
		destinations.push({
			enabled: a.enabled === true || a.enabled === 'true',
			label: String(a.label != null ? a.label : t.label != null ? t.label : `Encoder ${i + 1}`),
			rtmpServerUrl: serverUrl,
			streamKey,
			/** @deprecated Prefer rtmpServerUrl + streamKey; kept for older configs / tools */
			rtmpUrl: getEffectiveRtmpDestinationUrl({ rtmpServerUrl: serverUrl, streamKey, rtmpUrl: legacyUrl }),
			inputTarget: String(a.inputTarget ?? t.inputTarget ?? 'program_1').trim() || 'program_1',
			videoCodec: String(a.videoCodec ?? 'h264').toLowerCase(),
			videoBitrateKbps: Math.max(100, parseInt(String(a.videoBitrateKbps ?? t.videoBitrateKbps ?? 2500), 10) || 2500),
			encoderPreset: String(a.encoderPreset ?? t.encoderPreset ?? 'veryfast').trim() || 'veryfast',
			audioSource: String(a.audioSource ?? 'muxed').toLowerCase(),
			audioBitrateKbps: Math.max(32, parseInt(String(a.audioBitrateKbps ?? 128), 10) || 128),
		})
	}
	return {
		enabled: m.enabled === true || m.enabled === 'true',
		programOutputsEnabled: m.programOutputsEnabled !== false && m.programOutputsEnabled !== 'false',
		/** Preview RTMP sources are not used for public-facing streams; kept false for config compatibility. */
		previewOutputsEnabled: false,
		multiviewOutputEnabled: m.multiviewOutputEnabled !== false && m.multiviewOutputEnabled !== 'false',
		destinations,
	}
}

module.exports = {
	buildRtmpFfmpegConsumersForChannel,
	resolveInputTargetToChannel,
	normalizeRtmpConfig,
	joinRtmpServerUrlAndStreamKey,
	getEffectiveRtmpDestinationUrl,
}
