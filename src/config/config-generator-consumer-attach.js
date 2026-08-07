'use strict'

const { channelXmlComment } = require('./config-generator-xml-comments')
const { STANDARD_VIDEO_MODES } = require('./config-modes')
const { effectiveStandardVideoModeId } = require('./config-generator-mode-helpers')
const {
	parseOptionalPixel,
	channelLayoutElementXml,
	buildProgramSystemAudioXml,
	buildMultiviewScreenConsumerInnerXml,
	buildPortAudioConsumerXml,
	buildMonitorChannelXml,
} = require('./config-generator-builders')
const { casparBoolEnabled, readMultiviewSetting, readMultiviewWindowChromeFlag } = require('./config-generator-utils')
const { buildRtmpFfmpegConsumersForChannel } = require('./rtmp-output')
const {
	buildDecklinkKeyFillConsumersXml,
	readDecklinkKeyFillSettings,
	readDecklinkConsumerSettings,
	parseDecklinkDeviceIndex,
} = require('./decklink-key-fill')
const {
	resolveDecklinkVideoModeForTarget,
	channelVideoModeForDecklinkConsumer,
} = require('./decklink-output-resolve')
const { channelCountFromLayout } = require('./audio-channel-layouts')
const { buildDecklinkTiledConsumersXml, buildScreenPairChannels } = require('./config-generator-consumer-attach-screen')
const {
	buildInputsHostChannel,
	buildExtraAudioChannel,
	buildPixelmapChannel,
	buildInputChannel,
	buildHostLiveChannel,
} = require('./config-generator-consumer-attach-misc-channels')

/**
 * @param {Record<string, unknown>} config
 * @param {ReturnType<import('./routing').getChannelMap>} routeMap
 * @param {{ cumulativeX: number, nextDevice: number }} ctx
 */
function buildMultiviewChannel(config, routeMap, ctx) {
	const n = ctx.n || 1
	const mode = String(config[`multiview_${n}_mode`] || config.multiview_mode || '1080p5000')
	const dims = ctx.dims || STANDARD_VIDEO_MODES[mode] || { width: 1920, height: 1080, fps: 50 }
	const modeId = mode
	const mvStd = !!STANDARD_VIDEO_MODES[mode]
	const stretch = 'none'
	
	// Multiview screen flags: per-index, then PGM screen 1 for window chrome, then global multiview_*.
	const windowed = readMultiviewWindowChromeFlag(config, n, 'windowed', true)
	const vsync = casparBoolEnabled(readMultiviewSetting(config, n, 'vsync'), true)
	const alwaysOnTop = casparBoolEnabled(readMultiviewSetting(config, n, 'always_on_top'), false)
	const borderless = readMultiviewWindowChromeFlag(config, n, 'borderless', true)
	
	const mvX = parseOptionalPixel(config[`multiview_${n}_x`] ?? config.multiview_x, ctx.cumulativeX)
	const mvY = parseOptionalPixel(config[`multiview_${n}_y`] ?? config.multiview_y, 0)
	
	const screenXml = buildMultiviewScreenConsumerInnerXml(config, {
		n,
		nextDevice: ctx.nextDevice,
		posX: mvX,
		posY: mvY,
		dims,
		stretch,
		windowed,
		vsync,
		alwaysOnTop,
		borderless,
	})
	
	const portAudioXml = buildPortAudioConsumerXml(config, `multiview_${n}`)
	const systemAudioXml = buildProgramSystemAudioXml(config, `multiview_${n}`)

	const mvDlDev = parseInt(String(config[`multiview_${n}_decklink_device`] || config.multiview_decklink_device || '0'), 10) || 0
	let mvProfile = String(config[`multiview_${n}_output_mode`] || config.multiview_output_mode || '').trim()
	if (!mvProfile) {
		if (mvDlDev > 0) {
			mvProfile = 'decklink_only'
		} else {
			const legacy = (config[`multiview_${n}_screen_consumer`] ?? config.multiview_screen_consumer) === false ||
			               (config[`multiview_${n}_screen_consumer`] ?? config.multiview_screen_consumer) === 'false'
			mvProfile = legacy ? 'disabled' : 'screen_only'
		}
	}

	let includeScreen = false
	let includeDeck = false
	switch (mvProfile) {
		case 'disabled':
		case 'stream_only':
			break
		case 'screen_only':
		case 'screen_stream':
			includeScreen = true
			break
		case 'decklink_only':
		case 'decklink_stream':
			includeDeck = mvDlDev > 0
			break
		case 'screen_decklink':
		case 'screen_stream_decklink':
			includeScreen = true
			includeDeck = mvDlDev > 0
			break
		default:
			includeScreen = true
			break
	}

	const screenBlock = includeScreen ? `\n                <screen>\n                    ${screenXml}\n                </screen>` : ''
	const mvKeyFill = readDecklinkKeyFillSettings(config, 'multiview_')
	const deckBlock =
		includeDeck && mvDlDev > 0
			? (() => {
					const inheritedMode = resolveDecklinkVideoModeForTarget(config, 'multiview', n)
					if (!inheritedMode) return ''
					const consumerSettings = readDecklinkConsumerSettings(config, 'multiview_')
					return buildDecklinkKeyFillConsumersXml({
						fillDevice: mvDlDev,
						keyDevice: mvKeyFill.keyDevice,
						keyer: mvKeyFill.keyer,
						videoMode: inheritedMode,
						consumerSettings,
						lowLatency: consumerSettings.lowLatency,
					})
				})()
			: ''

	const mvChs = Array.isArray(routeMap.multiviewChannels) ? routeMap.multiviewChannels : [routeMap.multiviewCh]
	const mvChNum = mvChs[n - 1] || null
	const rtmpMvXml = mvChNum != null ? buildRtmpFfmpegConsumersForChannel(config, mvChNum) : ''

	const decklinkVideoMode =
		includeDeck && mvDlDev > 0 ? resolveDecklinkVideoModeForTarget(config, 'multiview', n) : null
	const channelModeId = channelVideoModeForDecklinkConsumer({
		channelModeId: modeId,
		isChannelCustom: !mvStd,
		decklinkVideoMode,
		hasScreenConsumer: includeScreen,
	})

	const mvChLabel = mvChNum != null && Number.isFinite(Number(mvChNum)) ? mvChNum : '?'
	const xml = `${channelXmlComment(`Caspar channel ${mvChLabel}: Multiview output #${n}`)}        <channel>
            <video-mode>${channelModeId}</video-mode>
            <consumers>${screenBlock}${systemAudioXml}${portAudioXml}${deckBlock}${rtmpMvXml}
            </consumers>
            <mixer>
                <audio-osc>false</audio-osc>
            </mixer>
        </channel>`

	return {
		xml,
		usedScreenConsumer: includeScreen,
	}
}

/**
 * WO-172 T172.6: resolve the `<channel-layout>` for the dedicated streaming/encode bus from the
 * cabled source's program-bus layout (`screen_N_audio_layout`, already derived onto `config` by
 * `applyDestinationAudioLayoutsToScreens` before this generator stage runs — see
 * `src/config/build-caspar-generator-config.js:281-288`). Multiview / unresolved source: 'stereo'
 * (multiview has no per-layout audio; `buildMultiviewChannel` likewise emits no `<channel-layout>`).
 * WO-249 T249.4: when `sc.audioSource` names a screen (`program_N`/`preview_N`, not `follow_video` —
 * same semantics as `resolveStreamingChannelRouteForRole(config, 'audio')` in `routing-map.js`), the
 * bus carries THAT screen's audio, so its layout is resolved too and the WIDER of the two wins — a
 * narrower bus would make Caspar's count-based interleaved audio copy scramble pairs (see WO file).
 * Restart-dirty affordance: this only shapes generated config; no live behavior change until the
 * config is regenerated and Caspar is restarted.
 * @param {Record<string, unknown>} config
 * @param {Record<string, unknown>} sc - `config.streamingChannel`
 * @returns {string}
 */
function resolveStreamingChannelAudioLayout(config, sc) {
	/** @param {string} rawSource @returns {string|null} screen layout id, or null when not a screen source */
	const screenLayoutFor = (rawSource) => {
		const m = String(rawSource || '').trim().toLowerCase().match(/^(?:program|preview)[_-]?(\d+)$/)
		if (!m) return null
		const n = parseInt(m[1], 10) || 1
		return String(config[`screen_${n}_audio_layout`] || 'stereo').toLowerCase() || 'stereo'
	}
	const videoLayout = screenLayoutFor(String(sc.videoSource || 'program_1')) ?? 'stereo'
	const rawAudio = String(sc.audioSource == null || sc.audioSource === '' ? 'follow_video' : sc.audioSource).trim().toLowerCase()
	const audioLayout = rawAudio === 'follow_video' || rawAudio === 'follow' ? null : screenLayoutFor(rawAudio)
	if (audioLayout == null) return videoLayout
	return channelCountFromLayout(audioLayout) > channelCountFromLayout(videoLayout) ? audioLayout : videoLayout
}

/**
 * @param {Record<string, unknown>} config
 * @param {number|null|undefined} casparChannelNum
 */
function buildStreamingChannel(config, casparChannelNum) {
	const sc = config.streamingChannel && typeof config.streamingChannel === 'object' ? config.streamingChannel : {}
	// videoMode '' = inherit from the cabled source: sc.videoSource is graph-synced
	// (applyStreamRecordMappingsFromGraph), so the encode bus follows that screen's mode.
	// An explicit sc.videoMode remains the config-file escape hatch.
	const srcScreen = String(sc.videoSource || '').trim().toLowerCase().match(/^(?:program|preview)[_-]?(\d+)$/)
	const inheritedMode = srcScreen ? String(config[`screen_${parseInt(srcScreen[1], 10) || 1}_mode`] || '').trim() : ''
	const rawMode = String(sc.videoMode || '').trim() || inheritedMode || String(config.screen_1_mode || '').trim() || '1080p5000'
	const modeId = effectiveStandardVideoModeId(rawMode)
	const deckN = parseInt(String(sc.decklinkDevice || '0'), 10) || 0
	const mvStd = !!STANDARD_VIDEO_MODES[rawMode]
	let profXml = ''
	if (deckN > 0 && mvStd) {
		profXml = buildDecklinkKeyFillConsumersXml({
			fillDevice: deckN,
			keyDevice: parseDecklinkDeviceIndex(sc.decklinkKeyDevice),
			lowLatency: sc.decklinkLowLatency === true || sc.decklinkLowLatency === 'true',
		})
	}
	// WO-172 T172.6: dormant bug — sibling buildHostLiveChannel emits <channel-layout>, this didn't,
	// a Caspar-side pre-downmix hazard for non-stereo program buses attached to the dedicated bus.
	const layoutXml = channelLayoutElementXml(resolveStreamingChannelAudioLayout(config, sc))
	const ch = casparChannelNum != null && Number.isFinite(Number(casparChannelNum)) ? Number(casparChannelNum) : '?'
	return `${channelXmlComment(`Caspar channel ${ch}: Dedicated streaming / encode bus (HighAsCG attaches FFmpeg/SRT here)`)}        <channel>
            <video-mode>${modeId}</video-mode>${layoutXml}
            <consumers>${profXml}
            </consumers>
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`
}

module.exports = {
	buildDecklinkTiledConsumersXml,
	buildScreenPairChannels,
	buildMultiviewChannel,
	buildInputsHostChannel,
	buildExtraAudioChannel,
	buildPixelmapChannel,
	buildInputChannel,
	buildHostLiveChannel,
	buildStreamingChannel,
	buildMonitorChannelXml,
	resolveStreamingChannelAudioLayout,
}
