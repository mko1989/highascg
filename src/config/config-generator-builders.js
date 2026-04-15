'use strict'

const { layoutChannelCount } = require('./config-modes')
const { buildFfmpegArgs, casparUdpStreamUri } = require('../streaming/caspar-ffmpeg-setup')
const defaults = require('../../config/default')

/**
 * Parse optional pixel position from module config. Empty string uses fallback (auto layout or 0).
 * @param {unknown} raw
 * @param {number} fallback
 * @returns {number}
 */
function parseOptionalPixel(raw, fallback) {
	if (raw === undefined || raw === null || String(raw).trim() === '') return fallback
	const n = parseInt(String(raw), 10)
	return Number.isFinite(n) ? n : fallback
}

/**
 * @param {string} s
 */
function escapeXml(s) {
	return String(s || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

/** @param {unknown} arr @param {number} len */
function padStringArray(arr, len) {
	const a = Array.isArray(arr) ? arr.map((x) => String(x ?? '').trim()) : []
	while (a.length < len) a.push('')
	return a.slice(0, len)
}

/** @param {unknown} arr @param {number} len */
function padBoolArray(arr, len) {
	const a = Array.isArray(arr) ? arr.map((x) => x === true || x === 'true') : []
	while (a.length < len) a.push(false)
	return a.slice(0, len)
}

/**
 * @param {unknown} id
 * @returns {string}
 */
function ffmpegPathFromAlsaId(id) {
	const s = String(id || '').trim()
	if (!s) return ''
	if (s.startsWith('-')) return s
	if (s.startsWith('pipewire:')) return `pulse://${s.slice('pipewire:'.length)}`
	return `-f alsa ${s}`
}

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
	const layoutMap = { stereo: 'stereo', '4ch': '4ch', '8ch': '8ch', '16ch': '16ch' }
	const pl = String(ar.programLayout || 'stereo').toLowerCase()
	const layoutId = layoutMap[pl] || 'stereo'
	const screenCount = Math.min(4, Math.max(1, parseInt(String(out.screen_count || 1), 10) || 1))
	const progDev = ar.programSystemAudioDevices
	const prevEn = ar.previewSystemAudioEnabled
	const prevDev = ar.previewSystemAudioDevices

	/**
	 * PGM audio: **only** `<system-audio>` (OpenAL). Empty device name → `<system-audio />` (default);
	 * non-empty → `<device-name>…</device-name>`. We never emit `<ffmpeg-consumer>` for program/monitor
	 * on these channels when routing is default — it duplicated ALSA routing.
	 */
	const profile = String(out.caspar_build_profile || 'stock')
	for (let n = 1; n <= screenCount; n++) {
		out[`screen_${n}_audio_layout`] = layoutId
		out[`screen_${n}_ffmpeg_audio_enabled`] = false
		out[`screen_${n}_ffmpeg_audio_path`] = ''
		out[`screen_${n}_ffmpeg_audio_args`] = ''
		out[`screen_${n}_ffmpeg_audio_path_2`] = ''
		out[`screen_${n}_ffmpeg_audio_args_2`] = ''
		out[`screen_${n}_system_audio_enabled`] = true
		out[`screen_${n}_system_audio_device_name`] = progDev[n - 1] || ''
		out[`screen_${n}_preview_system_audio_enabled`] = prevEn[n - 1] === true
		out[`screen_${n}_preview_system_audio_device_name`] = prevDev[n - 1] || ''
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

	return out
}

/**
 * Emit named layouts under &lt;audio&gt; when screens/extras use live-8ch, 4ch, or 16ch.
 * @param {Record<string, unknown>} config
 * @param {number} screenCount
 * @returns {string}
 */
function buildAudioLayoutsXml(config, screenCount) {
	const ids = new Set()
	for (let n = 1; n <= screenCount; n++) {
		const id = String(config[`screen_${n}_audio_layout`] || 'default').toLowerCase()
		if (id === 'live-8ch' || id === '4ch' || id === '16ch') ids.add(id)
	}
	const extraN = Math.min(4, Math.max(0, parseInt(String(config.extra_audio_channel_count || 0), 10) || 0))
	for (let i = 1; i <= extraN; i++) {
		const id = String(config[`extra_audio_${i}_audio_layout`] || 'default').toLowerCase()
		if (id === 'live-8ch' || id === '4ch' || id === '16ch') ids.add(id)
	}
	if (ids.size === 0) return ''
	const fragments = []
	if (ids.has('live-8ch')) {
		fragments.push(`            <channel-layout>
                <name>live-8ch</name>
                <type>8ch</type>
                <num-channels>8</num-channels>
                <channel-order>FL FR FC LFE BL BR FLC FRC</channel-order>
            </channel-layout>`)
	}
	if (ids.has('4ch')) {
		fragments.push(`            <channel-layout>
                <name>4ch</name>
                <type>4ch</type>
                <num-channels>4</num-channels>
            </channel-layout>`)
	}
	if (ids.has('16ch')) {
		fragments.push(`            <channel-layout>
                <name>16ch</name>
                <type>16ch</type>
                <num-channels>16</num-channels>
            </channel-layout>`)
	}
	return `    <audio>
        <channel-layouts>
${fragments.join('\n')}
        </channel-layouts>
    </audio>
`
}

/**
 * CasparCG `<osc>` block: predefined UDP client → HighAsCG (and AMCP echo policy).
 * Omitted when `osc_port` is missing or ≤ 0 (same gate as before full-block T5.1).
 * Optional: `caspar_osc_default_port`, `osc_target_host` / `highascg_host`, `osc_target_port`, `osc_disable_send_to_amcp`.
 * @param {Record<string, unknown>} config
 * @returns {string}
 */
function buildOscConfigurationXml(config) {
	const oscPort = parseInt(String(config.osc_port || '0'), 10) || 0
	if (oscPort <= 0) return ''

	let targetAddr = String(config.osc_target_host || config.highascg_host || '127.0.0.1').trim()
	if (!targetAddr) targetAddr = '127.0.0.1'
	const targetPort = parseInt(String(config.osc_target_port || oscPort), 10) || oscPort
	let defaultPort = parseInt(String(config.caspar_osc_default_port || '6250'), 10) || 6250
	if (defaultPort === targetPort) {
		defaultPort = targetPort + 1
		if (defaultPort > 65535) defaultPort = Math.max(1024, targetPort - 1)
	}
	const disableAmcp = config.osc_disable_send_to_amcp === true || config.osc_disable_send_to_amcp === 'true'

	return `    <osc>
        <default-port>${defaultPort}</default-port>
        <disable-send-to-amcp-clients>${disableAmcp ? 'true' : 'false'}</disable-send-to-amcp-clients>
        <predefined-clients>
            <predefined-client>
                <address>${escapeXml(targetAddr)}</address>
                <port>${targetPort}</port>
            </predefined-client>
        </predefined-clients>
    </osc>
`
}

/**
 * @param {string} path - e.g. alsa://hw:NVidia,3 or pulse://caspar_monitor
 * @param {string} layout
 * @param {number} [bufferBytes] - optional ALSA/Pulse buffer_size
 */
function defaultFfmpegAudioArgs(path, layout, bufferBytes) {
	const p = String(path || '').trim().toLowerCase()
	const ch = layoutChannelCount(layout)
	const isPulse = p.startsWith('pulse://') || p.includes('pulse://')
	const codec = 'pcm_s16le'
	const fmt = isPulse ? 'pulse' : 'alsa'
	const buf =
		Number.isFinite(bufferBytes) && bufferBytes > 0
			? bufferBytes
			: ch >= 6
				? 192000
				: 48000
	return `-vn -acodec ${codec} -ar 48000 -ac ${ch} -f ${fmt} -buffer_size ${buf}`
}

/**
 * @param {Record<string, unknown>} config
 * @param {number} screenIdx1 - 1-based screen index
 * @returns {string} inner XML for ffmpeg-consumer(s), may be empty
 */
function buildScreenFfmpegConsumersXml(config, screenIdx1) {
	const enabled =
		config[`screen_${screenIdx1}_ffmpeg_audio_enabled`] === true ||
		config[`screen_${screenIdx1}_ffmpeg_audio_enabled`] === 'true'
	const pathRaw = String(config[`screen_${screenIdx1}_ffmpeg_audio_path`] || '').trim()
	const path2 = String(config[`screen_${screenIdx1}_ffmpeg_audio_path_2`] || '').trim()
	if (!enabled || (!pathRaw && !path2)) return ''

	const layout = String(config[`screen_${screenIdx1}_audio_layout`] || 'default')
	const bufIn = parseInt(String(config[`screen_${screenIdx1}_ffmpeg_buffer`] || ''), 10)
	const buf = Number.isFinite(bufIn) ? bufIn : undefined

	let xml = ''
	if (pathRaw) {
		const customArgs = String(config[`screen_${screenIdx1}_ffmpeg_audio_args`] || '').trim()
		const args = customArgs || defaultFfmpegAudioArgs(pathRaw, layout, buf)
		xml += `
                <ffmpeg-consumer>
                    <path>${escapeXml(pathRaw)}</path>
                    <args>${escapeXml(args)}</args>
                </ffmpeg-consumer>`
	}
	if (path2) {
		const custom2 = String(config[`screen_${screenIdx1}_ffmpeg_audio_args_2`] || '').trim()
		const args2 = custom2 || defaultFfmpegAudioArgs(path2, layout, buf)
		xml += `
                <ffmpeg-consumer>
                    <path>${escapeXml(path2)}</path>
                    <args>${escapeXml(args2)}</args>
                </ffmpeg-consumer>`
	}
	return xml
}

/**
 * @param {Record<string, unknown>} config - App config
 * @param {number} port - UDP destination port (same URI as AMCP ADD STREAM — MPEG-TS to go2rtc)
 * @returns {string} XML for an <ffmpeg> consumer
 */
function buildStreamingFfmpegConsumerXml(config, port) {
	if (!config.streaming || (config.streaming.enabled === false || config.streaming.enabled === 'false')) return ''
	
	const args = buildFfmpegArgs(config.streaming)
	const path = casparUdpStreamUri(port)

	return `
                <ffmpeg>
                    <path>${escapeXml(path)}</path>
                    <args>${escapeXml(args)}</args>
                </ffmpeg>`
}

/**
 * @param {Record<string, unknown>} config
 * @param {number} idx1 - 1-based extra audio index
 * @returns {string} inner XML for ffmpeg-consumer(s), may be empty
 */
function buildExtraAudioFfmpegConsumersXml(config, idx1) {
	const enabled =
		config[`extra_audio_${idx1}_ffmpeg_audio_enabled`] === true ||
		config[`extra_audio_${idx1}_ffmpeg_audio_enabled`] === 'true'
	const pathRaw = String(config[`extra_audio_${idx1}_ffmpeg_audio_path`] || '').trim()
	if (!enabled || !pathRaw) return ''

	const layout = String(config[`extra_audio_${idx1}_audio_layout`] || 'default')
	const customArgs = String(config[`extra_audio_${idx1}_ffmpeg_audio_args`] || '').trim()
	const bufIn = parseInt(String(config[`extra_audio_${idx1}_ffmpeg_buffer`] || ''), 10)
	const args = customArgs || defaultFfmpegAudioArgs(pathRaw, layout, Number.isFinite(bufIn) ? bufIn : undefined)

	let xml = `
                <ffmpeg-consumer>
                    <path>${escapeXml(pathRaw)}</path>
                    <args>${escapeXml(args)}</args>
                </ffmpeg-consumer>`

	const path2 = String(config[`extra_audio_${idx1}_ffmpeg_audio_path_2`] || '').trim()
	if (path2) {
		const custom2 = String(config[`extra_audio_${idx1}_ffmpeg_audio_args_2`] || '').trim()
		const args2 = custom2 || defaultFfmpegAudioArgs(path2, layout, Number.isFinite(bufIn) ? bufIn : undefined)
		xml += `
                <ffmpeg-consumer>
                    <path>${escapeXml(path2)}</path>
                    <args>${escapeXml(args2)}</args>
                </ffmpeg-consumer>`
	}
	return xml
}

/**
 * @param {string} layoutId
 * @returns {string} e.g. newline + &lt;channel-layout&gt;stereo&lt;/channel-layout&gt;
 */
function channelLayoutElementXml(layoutId) {
	const id = String(layoutId || 'default').toLowerCase()
	if (!id || id === 'default') return ''
	return `\n            <channel-layout>${escapeXml(id)}</channel-layout>`
}

/**
 * Caspar `<system-audio>` for program channels (OpenAL). Empty device → minimal self-closing tag.
 * @param {Record<string, unknown>} config
 * @param {number} screenIdx1 - 1-based screen index
 */
/**
 * @param {Record<string, unknown>} config
 * @returns {boolean}
 */
function isCustomLiveProfile(config) {
	return String(config.caspar_build_profile || 'stock') === 'custom_live'
}

/**
 * PR #1718: optional `<aspect-ratio>`, `<enable-mipmaps>` inside `<screen>` (custom build only).
 * @param {Record<string, unknown>} config
 * @param {number} screenIdx1
 * @returns {string} fragment lines (no outer wrapper)
 */
function buildScreenConsumerExtrasXml(config, screenIdx1) {
	if (!isCustomLiveProfile(config)) return ''
	const n = screenIdx1
	const parts = []
	const ar = String(config[`screen_${n}_aspect_ratio`] || '').trim()
	if (ar) parts.push(`<aspect-ratio>${escapeXml(ar)}</aspect-ratio>`)
	const mm = config[`screen_${n}_enable_mipmaps`] === true || config[`screen_${n}_enable_mipmaps`] === 'true'
	if (mm) parts.push('<enable-mipmaps>true</enable-mipmaps>')
	return parts.length ? parts.join('\n                    ') : ''
}

/**
 * PR #1720: `<portaudio>` consumer (ASIO multi-channel). Only when `custom_live` + enabled.
 * @param {Record<string, unknown>} config
 * @param {number} screenIdx1
 * @returns {string}
 */
function buildPortAudioConsumerXml(config, screenIdx1) {
	if (!isCustomLiveProfile(config)) return ''
	const n = screenIdx1
	const en = config[`screen_${n}_portaudio_enabled`] === true || config[`screen_${n}_portaudio_enabled`] === 'true'
	if (!en) return ''
	const device = String(config[`screen_${n}_portaudio_device_name`] || '').trim()
	const ch = Number.parseInt(String(config[`screen_${n}_portaudio_output_channels`] ?? 2), 10) || 2
	const buf = Number.parseInt(String(config[`screen_${n}_portaudio_buffer_frames`] ?? 128), 10) || 128
	const lat = Number.parseFloat(String(config[`screen_${n}_portaudio_latency_ms`] ?? 40)) || 40
	const fifo = Number.parseFloat(String(config[`screen_${n}_portaudio_fifo_ms`] ?? 50)) || 50
	const autoTune = config[`screen_${n}_portaudio_auto_tune`] !== false && config[`screen_${n}_portaudio_auto_tune`] !== 'false'
	let inner = ''
	if (device) inner += `\n                    <device-name>${escapeXml(device)}</device-name>`
	inner += `\n                    <output-channels>${ch}</output-channels>`
	inner += `\n                    <buffer-size-frames>${buf}</buffer-size-frames>`
	inner += `\n                    <latency-compensation-ms>${lat}</latency-compensation-ms>`
	inner += `\n                    <fifo-ms>${fifo}</fifo-ms>`
	inner += `\n                    <auto-tune-latency>${autoTune ? 'true' : 'false'}</auto-tune-latency>`
	return `\n                <portaudio>${inner}\n                </portaudio>`
}

function buildProgramSystemAudioXml(config, screenIdx1) {
	const n = screenIdx1
	const enabled =
		config[`screen_${n}_system_audio_enabled`] === true || config[`screen_${n}_system_audio_enabled`] === 'true'
	if (!enabled) return ''
	const dev = String(config[`screen_${n}_system_audio_device_name`] || '').trim()
	if (!dev) return '\n                <system-audio />'
	return `\n                <system-audio>\n                    <device-name>${escapeXml(dev)}</device-name>\n                </system-audio>`
}

/**
 * Optional `<system-audio>` on preview (PRV) channels — same OpenAL rules as program.
 * @param {Record<string, unknown>} config
 * @param {number} screenIdx1
 */
function buildPreviewSystemAudioXml(config, screenIdx1) {
	const n = screenIdx1
	const enabled =
		config[`screen_${n}_preview_system_audio_enabled`] === true ||
		config[`screen_${n}_preview_system_audio_enabled`] === 'true'
	if (!enabled) return ''
	const dev = String(config[`screen_${n}_preview_system_audio_device_name`] || '').trim()
	if (!dev) return '\n                <system-audio />'
	return `\n                <system-audio>\n                    <device-name>${escapeXml(dev)}</device-name>\n                </system-audio>`
}

/**
 * @param {Record<string, unknown>} config
 * @returns {string[]}
 */
function getProgramChannelAudioLayouts(config) {
	const screenCount = Math.min(4, Math.max(1, parseInt(String(config.screen_count || 1), 10) || 1))
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
	parseOptionalPixel,
	escapeXml,
	padStringArray,
	padBoolArray,
	ffmpegPathFromAlsaId,
	normalizeAudioRouting,
	mergeAudioRoutingIntoConfig,
	buildAudioLayoutsXml,
	buildOscConfigurationXml,
	defaultFfmpegAudioArgs,
	buildScreenFfmpegConsumersXml,
	buildStreamingFfmpegConsumerXml,
	buildExtraAudioFfmpegConsumersXml,
	channelLayoutElementXml,
	buildProgramSystemAudioXml,
	buildPreviewSystemAudioXml,
	buildScreenConsumerExtrasXml,
	buildPortAudioConsumerXml,
	isCustomLiveProfile,
	getProgramChannelAudioLayouts,
	getExtraAudioChannelLayouts,
}
