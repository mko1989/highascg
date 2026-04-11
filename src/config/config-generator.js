/**
 * CasparCG config XML generator.
 * Video mode presets: ./config-modes.js
 * @see companion-module-casparcg-server/src/config-generator.js
 */
'use strict'

const {
	STANDARD_VIDEO_MODES,
	calculateCadence,
	getModeDimensions,
	AUDIO_LAYOUT_CHOICES,
	layoutChannelCount,
	getExtraAudioModeDimensions,
	getStandardModeChoices,
} = require('./config-modes')
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

/**
 * @param {Record<string, unknown>} config
 * @returns {string}
 */
function buildConfigXml(config) {
	config = mergeAudioRoutingIntoConfig(config)
	const screenCount = Math.min(4, Math.max(1, parseInt(String(config.screen_count || 1), 10) || 1))
	const multiviewEnabled = config.multiview_enabled !== false && config.multiview_enabled !== 'false'
	const decklinkCount = Math.min(8, Math.max(0, parseInt(String(config.decklink_input_count || 0), 10) || 0))
	const extraAudioCount = Math.min(4, Math.max(0, parseInt(String(config.extra_audio_channel_count || 0), 10) || 0))

	const channelsXml = []
	const customVideoModes = []
	const customModeIds = new Set()
	let cumulativeX = 0
	let nextDevice = 1

	for (let n = 1; n <= screenCount; n++) {
		const mode = String(config[`screen_${n}_mode`] || '1080p5000')
		const dims = getModeDimensions(mode, config, n)
		const stretch = ['none', 'fill', 'uniform', 'uniform_to_fill'].includes(String(config[`screen_${n}_stretch`] || 'none'))
			? String(config[`screen_${n}_stretch`])
			: 'none'
		const windowed = config[`screen_${n}_windowed`] !== false && config[`screen_${n}_windowed`] !== 'false'
		const vsync = config[`screen_${n}_vsync`] !== false && config[`screen_${n}_vsync`] !== 'false'
		const alwaysOnTop = config[`screen_${n}_always_on_top`] !== false && config[`screen_${n}_always_on_top`] !== 'false'
		const borderless = config[`screen_${n}_borderless`] === true || config[`screen_${n}_borderless`] === 'true'

		const posX = parseOptionalPixel(config[`screen_${n}_x`], cumulativeX)
		const posY = parseOptionalPixel(config[`screen_${n}_y`], 0)

		const screenXml = [
			`<device>${nextDevice}</device>`,
			`<x>${posX}</x><y>${posY}</y>`,
			`<width>${dims.width}</width><height>${dims.height}</height>`,
			`<stretch>${stretch}</stretch>`,
			`<windowed>${windowed}</windowed>`,
			`<vsync>${vsync}</vsync>`,
			`<always-on-top>${alwaysOnTop}</always-on-top>`,
			`<borderless>${borderless}</borderless>`,
		].join('\n                    ')
		const audioLayoutId = String(config[`screen_${n}_audio_layout`] || 'default')
		const layoutXml = channelLayoutElementXml(audioLayoutId)
		const ffmpegXml = buildScreenFfmpegConsumersXml(config, n)
		const screenSystemAudioXml = buildProgramSystemAudioXml(config, n)

		// Professional consumers (T3.2)
		let profConsumersXml = ''
		const decklinkDevice = parseInt(String(config[`screen_${n}_decklink_device`] || '0'), 10)
		if (decklinkDevice > 0) {
			profConsumersXml += `\n                <decklink>
                    <device>${decklinkDevice}</device>
                </decklink>`
		}
		const ndiEnabled = config[`screen_${n}_ndi_enabled`] === true || config[`screen_${n}_ndi_enabled`] === 'true'
		if (ndiEnabled) {
			const ndiName = escapeXml(config[`screen_${n}_ndi_name`] || `HighAsCG-CH${n}`)
			profConsumersXml += `\n                <ndi>
                    <name>${ndiName}</name>
                </ndi>`
		}

		// UDP preview streaming for PGM (Ch 1, 4, 7, 10...)
		const streamingBasePort = parseInt(String(config.streaming?.basePort || '10000'), 10) || 10000
		const pgmStreamingXml = buildStreamingFfmpegConsumerXml(config, streamingBasePort + (n - 1) * 3 + 1)

		channelsXml.push(
			`        <channel>
            <video-mode>${dims.modeId}</video-mode>${layoutXml}
            <consumers>
                <screen>
                    ${screenXml}
                </screen>${screenSystemAudioXml}${ffmpegXml}${pgmStreamingXml}${profConsumersXml}
            </consumers>
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`
		)
		cumulativeX += dims.width
		nextDevice++

		// UDP preview streaming for PRV (Ch 2, 5, 8, 11...)
		const prvStreamingXml = buildStreamingFfmpegConsumerXml(config, streamingBasePort + (n - 1) * 3 + 2)
		const prvSystemAudioXml = buildPreviewSystemAudioXml(config, n)

		channelsXml.push(
			`        <channel>
            <video-mode>${dims.modeId}</video-mode>
            <consumers>${prvStreamingXml}${prvSystemAudioXml}</consumers>
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`
		)

		// Custom <video-mode>: time-scale = fps×1000, duration always 1000, cadence = 48000/fps (see config-modes.calculateCadence).
		if (dims.isCustom && !customModeIds.has(dims.modeId)) {
			customModeIds.add(dims.modeId)
			const timeScale = Math.round(dims.fps * 1000)
			const cad = calculateCadence(dims.fps)
			customVideoModes.push(
				`        <video-mode>
            <id>${dims.modeId}</id>
            <width>${dims.width}</width>
            <height>${dims.height}</height>
            <time-scale>${timeScale}</time-scale>
            <duration>1000</duration>
            <cadence>${cad}</cadence>
        </video-mode>`
			)
		}
	}

	if (multiviewEnabled) {
		const mode = String(config.multiview_mode || '1080p5000')
		const dims = STANDARD_VIDEO_MODES[mode] || { width: 1920, height: 1080, fps: 50 }
		const modeId = mode
		const stretch = 'none'
		const windowed = config.multiview_windowed !== false && config.multiview_windowed !== 'false'
		const vsync = config.multiview_vsync !== false && config.multiview_vsync !== 'false'
		const alwaysOnTop = config.multiview_always_on_top !== false && config.multiview_always_on_top !== 'false'
		const borderless = config.multiview_borderless === true || config.multiview_borderless === 'true'
		const mvX = parseOptionalPixel(config.multiview_x, cumulativeX)
		const mvY = parseOptionalPixel(config.multiview_y, 0)
		const screenXml = [
			`<device>${nextDevice}</device>`,
			`<x>${mvX}</x><y>${mvY}</y>`,
			`<width>${dims.width}</width><height>${dims.height}</height>`,
			`<stretch>${stretch}</stretch>`,
			`<windowed>${windowed}</windowed>`,
			`<vsync>${vsync}</vsync>`,
			`<always-on-top>${alwaysOnTop}</always-on-top>`,
			`<borderless>${borderless}</borderless>`,
		].join('\n                    ')
		/** false = stream-only multiview (no &lt;screen&gt;); requires preview streaming FFmpeg consumer for WebRTC. */
		const mvScreen =
			config.multiview_screen_consumer !== false && config.multiview_screen_consumer !== 'false'

		const streamingBasePort = parseInt(String(config.streaming?.basePort || '10000'), 10) || 10000
		const mvStreamingXml = buildStreamingFfmpegConsumerXml(config, streamingBasePort + 3)
		const screenBlock = mvScreen
			? `
                <screen>
                    ${screenXml}
                </screen>`
			: ''
		if (!mvScreen && !mvStreamingXml.trim()) {
			// Avoid empty <consumers/> when stream-only but preview streaming is off — keep screen so channel is valid.
			channelsXml.push(
				`        <channel>
            <video-mode>${modeId}</video-mode>
            <consumers>
                <screen>
                    ${screenXml}
                </screen>
            </consumers>
            <mixer>
                <audio-osc>false</audio-osc>
            </mixer>
        </channel>`
			)
		} else {
			channelsXml.push(
				`        <channel>
            <video-mode>${modeId}</video-mode>
            <consumers>${screenBlock}${mvStreamingXml}
            </consumers>
            <mixer>
                <audio-osc>false</audio-osc>
            </mixer>
        </channel>`
			)
		}
	}

	if (decklinkCount > 0) {
		const mode = String(config.inputs_channel_mode || '1080p5000')
		const modeId = STANDARD_VIDEO_MODES[mode] ? mode : '1080p5000'
		channelsXml.push(
			`        <channel>
            <video-mode>${modeId}</video-mode>
            <consumers/>
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`
		)
	}

	for (let i = 1; i <= extraAudioCount; i++) {
		const dims = getExtraAudioModeDimensions(config, i)
		const layoutXml = channelLayoutElementXml(String(config[`extra_audio_${i}_audio_layout`] || 'default'))
		const ffmpegXml = buildExtraAudioFfmpegConsumersXml(config, i)
		const consumersBlock = ffmpegXml
			? `<consumers>${ffmpegXml}
            </consumers>`
			: `<consumers/>`
		// Same custom video-mode rules as main screens (time-scale = fps×1000, duration 1000).
		if (dims.isCustom && !customModeIds.has(dims.modeId)) {
			customModeIds.add(dims.modeId)
			const timeScale = Math.round(dims.fps * 1000)
			const cad = calculateCadence(dims.fps)
			customVideoModes.push(
				`        <video-mode>
            <id>${dims.modeId}</id>
            <width>${dims.width}</width>
            <height>${dims.height}</height>
            <time-scale>${timeScale}</time-scale>
            <duration>1000</duration>
            <cadence>${cad}</cadence>
        </video-mode>`
			)
		}
		channelsXml.push(
			`        <channel>
            <video-mode>${dims.modeId}</video-mode>${layoutXml}
            ${consumersBlock}
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`
		)
	}

	const videoModesXml =
		customVideoModes.length > 0
			? `    <video-modes>
${customVideoModes.join('\n')}
    </video-modes>`
			: '    <video-modes/>'

	// T3.2: Allow manual custom modes from config
	let finalVideoModesXml = videoModesXml
	if (config.video_modes && Array.isArray(config.video_modes)) {
		const manualModes = config.video_modes.map(vm => {
			const id = escapeXml(vm.id)
			const ts = parseInt(vm.time_scale || '50000', 10)
			const dur = parseInt(vm.duration || '1000', 10)
			return `        <video-mode>
            <id>${id}</id>
            <width>${parseInt(vm.width, 10)}</width>
            <height>${parseInt(vm.height, 10)}</height>
            <time-scale>${ts}</time-scale>
            <duration>${dur}</duration>
            <cadence>${escapeXml(vm.cadence || 'progressive')}</cadence>
        </video-mode>`
		})
		if (customVideoModes.length === 0) {
			finalVideoModesXml = `    <video-modes>\n${manualModes.join('\n')}\n    </video-modes>`
		} else {
			finalVideoModesXml = finalVideoModesXml.replace('    </video-modes>', manualModes.join('\n') + '\n    </video-modes>')
		}
	}

	const oscXml = buildOscConfigurationXml(config)
	const controllersXml = `    <controllers><tcp><port>5250</port><protocol>AMCP</protocol></tcp>
    </controllers>`

	const audioSectionXml = buildAudioLayoutsXml(config, screenCount)
	const ndiAutoLoad =
		config.ndi_auto_load === false || config.ndi_auto_load === 'false' ? 'false' : 'true'

	return `<configuration>
    <paths>
        <media-path>media/</media-path>
        <log-path disable="false">log/</log-path>
        <data-path>data/</data-path>
        <template-path>template/</template-path>
    </paths>
    <lock-clear-phrase>secret</lock-clear-phrase>
${audioSectionXml}    <channels>
${channelsXml.join('\n')}
    </channels>
${finalVideoModesXml}
${controllersXml}
${oscXml}
    <amcp><media-server><host>localhost</host><port>8000</port></media-server></amcp>
    <ndi><auto-load>${ndiAutoLoad}</auto-load></ndi>
    <decklink/>
    <html><enable-gpu>false</enable-gpu></html>
</configuration>`
}

module.exports = {
	buildConfigXml,
	mergeAudioRoutingIntoConfig,
	normalizeAudioRouting,
	buildOscConfigurationXml,
	getStandardModeChoices,
	STANDARD_VIDEO_MODES,
	calculateCadence,
	getModeDimensions,
	AUDIO_LAYOUT_CHOICES,
	getProgramChannelAudioLayouts,
	getExtraAudioChannelLayouts,
	getExtraAudioModeDimensions,
	layoutChannelCount,
	defaultFfmpegAudioArgs,
}
