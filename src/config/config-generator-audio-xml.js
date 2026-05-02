'use strict'

const { layoutChannelCount } = require('./config-modes')
const { buildFfmpegArgs, casparUdpStreamUri } = require('../streaming/caspar-ffmpeg-setup')
const { escapeXml, isCustomLiveProfile } = require('./config-generator-utils')

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
 * Root-level PortAudio defaults (custom builds): parameters mirror screen 1 consumer fields; channels use `<portaudio/>`.
 * @param {Record<string, unknown>} config
 * @returns {string} inner XML lines (leading newline, indented for inside `<portaudio>`)
 */
function buildGlobalPortAudioInnerXml(config) {
	let consumer = null
	// Try to find the first defined portaudio consumer in any channel (from audioOutputs)
	for (let n = 1; n <= 8; n++) {
		const c = Array.isArray(config[`screen_${n}_portaudio_consumers`]) ? config[`screen_${n}_portaudio_consumers`][0] : null
		if (c) { consumer = c; break }
	}
	if (!consumer && Array.isArray(config.multiview_portaudio_consumers)) {
		consumer = config.multiview_portaudio_consumers[0]
	}

	const device = consumer ? String(consumer.deviceName || '').trim() : String(config.screen_1_portaudio_device_name || '').trim()
	const hostApi = consumer ? String(consumer.hostApi || 'auto').trim() : String(config.caspar_portaudio_host_api ?? 'auto').trim() || 'auto'
	
	let ch = 2
	if (consumer) {
		ch = parseInt(String(consumer.outputChannels || 2), 10) || 2
	} else {
		const layoutId = String(config.screen_1_audio_layout || 'stereo')
		if (layoutId === '4ch') ch = 4
		else if (layoutId === '8ch') ch = 8
		else if (layoutId === '16ch') ch = 16
		else if (layoutId === 'stereo') ch = 2
		else ch = Number.parseInt(String(config.screen_1_portaudio_output_channels ?? 2), 10) || 2
	}

	const buf = consumer ? (parseInt(String(consumer.bufferFrames), 10) || 128) : (Number.parseInt(String(config.screen_1_portaudio_buffer_frames ?? 128), 10) || 128)
	const lat = consumer ? (parseInt(String(consumer.latencyMs), 10) || 40) : (Number.parseInt(String(config.screen_1_portaudio_latency_ms ?? 40), 10) || 40)
	const fifo = consumer ? (parseInt(String(consumer.fifoMs), 10) || 50) : (Number.parseInt(String(config.screen_1_portaudio_fifo_ms ?? 50), 10) || 50)
	const autoTune = consumer ? (consumer.autoTune !== false) : (config.screen_1_portaudio_auto_tune_latency !== false && config.screen_1_portaudio_auto_tune_latency !== 'false')

	const lines = []
	if (device) {
		lines.push(`        <device-name>${escapeXml(device)}</device-name>`)
		lines.push(`        <device>${escapeXml(device)}</device>`)
	}
	lines.push(`        <host-api>${escapeXml(hostApi)}</host-api>`)
	lines.push(`        <output-channels>${ch}</output-channels>`)
	lines.push(`        <channels>${ch}</channels>`)
	lines.push(`        <buffer-size-frames>${buf}</buffer-size-frames>`)
	lines.push(`        <latency-compensation-ms>${lat}</latency-compensation-ms>`)
	lines.push(`        <auto-tune-latency>${autoTune ? 'true' : 'false'}</auto-tune-latency>`)
	lines.push(`        <fifo-ms>${fifo}</fifo-ms>`)
	return `\n${lines.join('\n')}`
}

/**
 * After `<lock-clear-phrase>`: log-level, root system-audio, global PortAudio (extended Caspar only).
 * @param {Record<string, unknown>} config
 * @returns {string}
 */
function buildCustomLiveRootXml(config) {
	if (!isCustomLiveProfile(config)) return ''
	const parts = []
	const logLevel = String(config.caspar_log_level || '').trim()
	if (logLevel) {
		parts.push(`    <log-level>${escapeXml(logLevel)}</log-level>`)
	}
	if (config.caspar_root_system_audio !== false && config.caspar_root_system_audio !== 'false') {
		parts.push(`    <system-audio>
        <device-name/>
    </system-audio>`)
	}
	const globalPa = config.caspar_global_portaudio === true || config.caspar_global_portaudio === 'true'
	if (globalPa) {
		const inner = buildGlobalPortAudioInnerXml(config)
		parts.push(`    <portaudio>${inner}\n    </portaudio>`)
	}
	return parts.length ? `${parts.join('\n')}\n` : ''
}

/**
 * PR #1720: `<portaudio>` consumer (ASIO). With `caspar_global_portaudio`, emits empty `<portaudio/>` (settings live in root block).
 * @param {Record<string, unknown>} config
 * @param {number|'multiview'} screenIdx1
 * @returns {string}
 */
function buildPortAudioConsumerXml(config, screenIdx1) {
	if (!isCustomLiveProfile(config)) return ''
	const prefix = screenIdx1 === 'multiview' ? 'multiview_' : `screen_${screenIdx1}_`
	const globalPa = config.caspar_global_portaudio === true || config.caspar_global_portaudio === 'true'
	const en = config[`${prefix}portaudio_enabled`] === true || config[`${prefix}portaudio_enabled`] === 'true'
	if (globalPa && en) return `\n                <portaudio/>`
	if (globalPa && !en) return ''

	const consumers = Array.isArray(config[`${prefix}portaudio_consumers`]) ? config[`${prefix}portaudio_consumers`] : []
	
	if (consumers.length > 0) {
		return consumers.map(c => {
			let inner = ''
			if (c.deviceName) {
				inner += `\n                    <device-name>${escapeXml(c.deviceName)}</device-name>`
				inner += `\n                    <device>${escapeXml(c.deviceName)}</device>`
			}
			inner += `\n                    <output-channels>${c.outputChannels || 2}</output-channels>`
			inner += `\n                    <channels>${c.outputChannels || 2}</channels>`
			
			const patch = c.audioPatch || {}
			if (Object.keys(patch).length > 0) {
				const ch = c.outputChannels || 2
				const layoutArr = Array.from({ length: ch }, (_, i) => i + 1)
				Object.entries(patch).forEach(([outPair, mixPair]) => {
					const outIdx = parseInt(outPair.split('-')[0]) - 1
					const mixIdx = parseInt(mixPair.split('-')[0])
					if (outIdx >= 0 && outIdx < ch) {
						layoutArr[outIdx] = mixIdx
						if (outIdx + 1 < ch) layoutArr[outIdx + 1] = mixIdx + 1
					}
				})
				inner += `\n                    <channel-layout>${layoutArr.join(',')}</channel-layout>`
			}

			inner += `\n                    <buffer-size-frames>${c.bufferFrames || 128}</buffer-size-frames>`
			inner += `\n                    <latency-compensation-ms>${c.latencyMs || 40}</latency-compensation-ms>`
			inner += `\n                    <fifo-ms>${c.fifoMs || 50}</fifo-ms>`
			inner += `\n                    <auto-tune-latency>${c.autoTune !== false ? 'true' : 'false'}</auto-tune-latency>`
			return `\n                <portaudio>${inner}\n                </portaudio>`
		}).join('')
	}

	// Legacy single-consumer fallback
	if (!en) return ''

	const device = String(config[`${prefix}portaudio_device_name`] || '').trim()
	const hostApi = String(config[`${prefix}portaudio_host_api`] ?? 'auto').trim() || 'auto'
	
	const layoutId = String(config[`${prefix}audio_layout`] || 'stereo')
	let ch = 2
	const rawCh = Number.parseInt(String(config[`${prefix}portaudio_output_channels`] ?? 0), 10)
	if (rawCh > 0) ch = rawCh
	else if (layoutId === '4ch') ch = 4
	else if (layoutId === '8ch') ch = 8
	else if (layoutId === '16ch') ch = 16
	else if (layoutId === 'stereo') ch = 2

	const buf = Number.parseInt(String(config[`${prefix}portaudio_buffer_frames`] ?? 128), 10) || 128
	const lat = Number.parseInt(String(config[`${prefix}portaudio_latency_ms`] ?? 40), 10) || 40
	const fifo = Number.parseInt(String(config[`${prefix}portaudio_fifo_ms`] ?? 50), 10) || 50
	const autoTune = config[`${prefix}portaudio_auto_tune_latency`] !== false && config[`${prefix}portaudio_auto_tune_latency`] !== 'false'
	
	let inner = ''
	if (device) {
		inner += `\n                    <device-name>${escapeXml(device)}</device-name>`
		inner += `\n                    <device>${escapeXml(device)}</device>`
	}
	inner += `\n                    <host-api>${escapeXml(hostApi)}</host-api>`
	inner += `\n                    <output-channels>${ch}</output-channels>`
	inner += `\n                    <channels>${ch}</channels>`
	
	const patch = config[`${prefix}audio_patch`] || {}
	if (Object.keys(patch).length > 0) {
		const layoutArr = Array.from({ length: ch }, (_, i) => i + 1)
		Object.entries(patch).forEach(([outPair, mixPair]) => {
			const outIdx = parseInt(outPair.split('-')[0]) - 1
			const mixIdx = parseInt(mixPair.split('-')[0])
			if (outIdx >= 0 && outIdx < ch) {
				layoutArr[outIdx] = mixIdx
				if (outIdx + 1 < ch) layoutArr[outIdx + 1] = mixIdx + 1
			}
		})
		inner += `\n                    <channel-layout>${layoutArr.join(',')}</channel-layout>`
	}

	inner += `\n                    <buffer-size-frames>${buf}</buffer-size-frames>`
	inner += `\n                    <latency-compensation-ms>${lat}</latency-compensation-ms>`
	inner += `\n                    <fifo-ms>${fifo}</fifo-ms>`
	inner += `\n                    <auto-tune-latency>${autoTune ? 'true' : 'false'}</auto-tune-latency>`
	return `\n                <portaudio>${inner}\n                </portaudio>`
}

/**
 * @param {Record<string, unknown>} config
 * @returns {string}
 */
function buildMonitorChannelXml(config) {
	if (!isCustomLiveProfile(config)) return ''
	const enabled = config.monitor_channel_enabled === true || config.monitor_channel_enabled === 'true'
	if (!enabled) return ''
	
	const device = String(config.monitor_portaudio_device || '').trim()
	const hostApi = String(config.caspar_portaudio_host_api ?? 'auto').trim() || 'auto'
	const buf = Number.parseInt(String(config.monitor_portaudio_buffer_frames ?? 128), 10) || 128
	const lat = Number.parseInt(String(config.monitor_portaudio_latency_ms ?? 40), 10) || 40
	const fifo = Number.parseInt(String(config.monitor_portaudio_fifo_ms ?? 50), 10) || 50
	const autoTune = config.monitor_portaudio_auto_tune_latency !== false && config.monitor_portaudio_auto_tune_latency !== 'false'
	
	let inner = ''
	if (device) inner += `\n                    <device-name>${escapeXml(device)}</device-name>`
	inner += `\n                    <host-api>${escapeXml(hostApi)}</host-api>`
	inner += `\n                    <output-channels>2</output-channels>`
	inner += `\n                    <buffer-size-frames>${buf}</buffer-size-frames>`
	inner += `\n                    <latency-compensation-ms>${lat}</latency-compensation-ms>`
	inner += `\n                    <fifo-ms>${fifo}</fifo-ms>`
	inner += `\n                    <auto-tune-latency>${autoTune ? 'true' : 'false'}</auto-tune-latency>`

	return `        <channel>
            <video-mode>1080p5000</video-mode>
            <consumers>
                <portaudio>${inner}
                </portaudio>
            </consumers>
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`
}

function buildProgramSystemAudioXml(config, screenIdx1) {
	const prefix = screenIdx1 === 'multiview' ? 'multiview_' : `screen_${screenIdx1}_`
	const enabled =
		config[`${prefix}system_audio_enabled`] === true || config[`${prefix}system_audio_enabled`] === 'true'
	if (!enabled) return ''
	const dev = String(config[`${prefix}system_audio_device_name`] || '').trim()
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

module.exports = {
	defaultFfmpegAudioArgs,
	buildAudioLayoutsXml,
	buildScreenFfmpegConsumersXml,
	buildStreamingFfmpegConsumerXml,
	buildExtraAudioFfmpegConsumersXml,
	channelLayoutElementXml,
	buildCustomLiveRootXml,
	buildPortAudioConsumerXml,
	buildMonitorChannelXml,
	buildProgramSystemAudioXml,
	buildPreviewSystemAudioXml,
}
