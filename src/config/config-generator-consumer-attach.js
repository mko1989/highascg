'use strict'

const { STANDARD_VIDEO_MODES } = require('./config-modes')
const { effectiveStandardVideoModeId } = require('./config-generator-mode-helpers')
const {
	parseOptionalPixel,
	buildStreamingFfmpegConsumerXml,
	buildScreenFfmpegConsumersXml,
	buildExtraAudioFfmpegConsumersXml,
	channelLayoutElementXml,
	buildProgramSystemAudioXml,
	buildPreviewSystemAudioXml,
	buildProgramScreenConsumerInnerXml,
	buildMultiviewScreenConsumerInnerXml,
	escapeXml,
	buildPortAudioConsumerXml,
	buildMonitorChannelXml,
} = require('./config-generator-builders')
const { buildRtmpFfmpegConsumersForChannel } = require('./rtmp-output')

/**
 * @param {Record<string, unknown>} config
 * @param {ReturnType<import('./routing').getChannelMap>} routeMap
 * @param {{ n: number, dims: any, cumulativeX: number, nextDevice: number }} ctx
 */
function buildScreenPairChannels(config, routeMap, ctx) {
	const n = ctx.n
	const dims = ctx.dims
	const stretch = ['none', 'fill', 'uniform', 'uniform_to_fill'].includes(String(config[`screen_${n}_stretch`] || 'none'))
		? String(config[`screen_${n}_stretch`])
		: 'none'
	const windowed = config[`screen_${n}_windowed`] !== false && config[`screen_${n}_windowed`] !== 'false'
	const vsync = config[`screen_${n}_vsync`] !== false && config[`screen_${n}_vsync`] !== 'false'
	const alwaysOnTop = config[`screen_${n}_always_on_top`] !== false && config[`screen_${n}_always_on_top`] !== 'false'
	const borderless = config[`screen_${n}_borderless`] === true || config[`screen_${n}_borderless`] === 'true'

	const posX = parseOptionalPixel(config[`screen_${n}_x`], ctx.cumulativeX)
	const posY = parseOptionalPixel(config[`screen_${n}_y`], 0)
	const screenInner = buildProgramScreenConsumerInnerXml(config, n, {
		nextDevice: ctx.nextDevice,
		posX,
		posY,
		dims,
		stretch,
		windowed,
		vsync,
		alwaysOnTop,
		borderless,
	})
	const audioLayoutId = String(config[`screen_${n}_audio_layout`] || 'default')
	const layoutXml = channelLayoutElementXml(audioLayoutId)
	const ffmpegXml = buildScreenFfmpegConsumersXml(config, n)
	const screenSystemAudioXml = buildProgramSystemAudioXml(config, n)
	const portAudioXml = buildPortAudioConsumerXml(config, n)

	let profConsumersXml = ''
	const decklinkDevice = parseInt(String(config[`screen_${n}_decklink_device`] || '0'), 10)
	const decklinkReplaceScreen =
		(config[`screen_${n}_decklink_replace_screen`] === true || config[`screen_${n}_decklink_replace_screen`] === 'true') &&
		!dims.isCustom &&
		decklinkDevice > 0
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

	const streamingBasePort = parseInt(String(config.streaming?.basePort || '10000'), 10) || 10000
	const pgmStreamingXml = buildStreamingFfmpegConsumerXml(config, streamingBasePort + (n - 1) * 3 + 1)
	const pgmChNum = routeMap.programCh(n)
	const rtmpPgmXml = buildRtmpFfmpegConsumersForChannel(config, pgmChNum)
	const screenConsumerXml = decklinkReplaceScreen
		? ''
		: `
                <screen>
                    ${screenInner}
                </screen>`

	const pgmXml = `        <channel>
            <video-mode>${dims.modeId}</video-mode>${layoutXml}
            <consumers>${screenConsumerXml}${screenSystemAudioXml}${portAudioXml}${ffmpegXml}${pgmStreamingXml}${profConsumersXml}${rtmpPgmXml}
            </consumers>
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`

	const prvStreamingXml = buildStreamingFfmpegConsumerXml(config, streamingBasePort + (n - 1) * 3 + 2)
	const prvSystemAudioXml = buildPreviewSystemAudioXml(config, n)
	const prvChNum = routeMap.previewCh(n)
	const rtmpPrvXml = buildRtmpFfmpegConsumersForChannel(config, prvChNum)
	const prvXml = `        <channel>
            <video-mode>${dims.modeId}</video-mode>
            <consumers>${prvStreamingXml}${prvSystemAudioXml}${rtmpPrvXml}</consumers>
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`
	const bus2Xml = `        <channel>
            <video-mode>${dims.modeId}</video-mode>
            <consumers/>
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`

	return {
		pgmXml,
		prvXml,
		bus2Xml,
		hasScreenConsumer: !decklinkReplaceScreen,
	}
}

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
	
	// Multiview channels should follow main screen window flags unless explicitly overridden per multiview index.
	const windowedRaw = config[`multiview_${n}_windowed`] ?? config.screen_1_windowed ?? config.multiview_windowed
	const vsyncRaw = config[`multiview_${n}_vsync`] ?? config.screen_1_vsync ?? config.multiview_vsync
	const alwaysOnTopRaw =
		config[`multiview_${n}_always_on_top`] ?? config.screen_1_always_on_top ?? config.multiview_always_on_top
	const borderlessRaw = config[`multiview_${n}_borderless`] ?? config.screen_1_borderless ?? config.multiview_borderless
	const windowed = windowedRaw !== false && windowedRaw !== 'false'
	const vsync = vsyncRaw !== false && vsyncRaw !== 'false'
	const alwaysOnTop = alwaysOnTopRaw !== false && alwaysOnTopRaw !== 'false'
	const borderless = borderlessRaw === true || borderlessRaw === 'true'
	
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

	const streamingOn = config.streaming && config.streaming.enabled !== false && config.streaming.enabled !== 'false'
	const streamingBasePort = parseInt(String(config.streaming?.basePort || '10000'), 10) || 10000
	const mvStreamingXml = buildStreamingFfmpegConsumerXml(config, streamingBasePort + 3 + (n - 1) * 3)

	const mvDlDev = parseInt(String(config[`multiview_${n}_decklink_device`] || config.multiview_decklink_device || '0'), 10) || 0
	let mvProfile = String(config[`multiview_${n}_output_mode`] || config.multiview_output_mode || '').trim()
	if (!mvProfile) {
		if (mvDlDev > 0) {
			mvProfile = streamingOn ? 'decklink_stream' : 'decklink_only'
		} else {
			const legacy = (config[`multiview_${n}_screen_consumer`] ?? config.multiview_screen_consumer) === false || 
			               (config[`multiview_${n}_screen_consumer`] ?? config.multiview_screen_consumer) === 'false'
			mvProfile = legacy ? 'stream_only' : 'screen_stream'
		}
	}

	let includeScreen = false
	let includeStream = false
	let includeDeck = false
	switch (mvProfile) {
		case 'stream_only': includeStream = streamingOn; break
		case 'screen_only': includeScreen = true; break
		case 'decklink_only': includeDeck = mvDlDev > 0 && mvStd; break
		case 'screen_decklink': includeScreen = true; includeDeck = mvDlDev > 0; break
		case 'decklink_stream': includeStream = streamingOn; includeDeck = mvDlDev > 0; break
		case 'screen_stream_decklink': includeScreen = true; includeStream = streamingOn; includeDeck = mvDlDev > 0; break
		case 'screen_stream':
		default: includeScreen = true; includeStream = streamingOn; break
	}
	if (mvProfile === 'decklink_only' && !includeDeck) includeScreen = true
	if (!includeScreen && !includeStream && !includeDeck) includeScreen = true

	const screenBlock = includeScreen ? `\n                <screen>\n                    ${screenXml}\n                </screen>` : ''
	const deckBlock = includeDeck && mvDlDev > 0 ? `\n                <decklink>\n                    <device>${mvDlDev}</device>\n                </decklink>` : ''
	const streamBlock = includeStream ? mvStreamingXml : ''
	
	const mvChs = Array.isArray(routeMap.multiviewChannels) ? routeMap.multiviewChannels : [routeMap.multiviewCh]
	const mvChNum = mvChs[n - 1] || null
	const rtmpMvXml = mvChNum != null ? buildRtmpFfmpegConsumersForChannel(config, mvChNum) : ''

	const xml = `        <channel>
            <video-mode>${modeId}</video-mode>
            <consumers>${screenBlock}${systemAudioXml}${portAudioXml}${streamBlock}${deckBlock}${rtmpMvXml}
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
 * @param {Record<string, unknown>} config
 * @param {number} decklinkCount
 * @param {boolean} inputsHostChannelEnabled
 * @param {boolean} inputsOnMvr
 */
function buildInputsHostChannel(config, decklinkCount, inputsHostChannelEnabled, inputsOnMvr) {
	if (inputsOnMvr) return ''
	const hostCh = decklinkCount > 0 || inputsHostChannelEnabled === true
	if (!hostCh) return ''
	const modeId = effectiveStandardVideoModeId(config.inputs_channel_mode)
	return `        <channel>
            <video-mode>${modeId}</video-mode>
            <consumers/>
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`
}

/**
 * @param {Record<string, unknown>} config
 * @param {number} i
 * @param {any} dims
 */
function buildExtraAudioChannel(config, i, dims) {
	const layoutXml = channelLayoutElementXml(String(config[`extra_audio_${i}_audio_layout`] || 'default'))
	const ffmpegXml = buildExtraAudioFfmpegConsumersXml(config, i)
	const consumersBlock = ffmpegXml
		? `<consumers>${ffmpegXml}
            </consumers>`
		: `<consumers/>`
	return `        <channel>
            <video-mode>${dims.modeId}</video-mode>${layoutXml}
            ${consumersBlock}
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`
}

/**
 * @param {Record<string, unknown>} config
 */
function buildStreamingChannel(config) {
	const sc = config.streamingChannel && typeof config.streamingChannel === 'object' ? config.streamingChannel : {}
	const rawMode = String(sc.videoMode || config.screen_1_mode || '1080p5000').trim() || '1080p5000'
	const modeId = effectiveStandardVideoModeId(rawMode)
	const deckN = parseInt(String(sc.decklinkDevice || '0'), 10) || 0
	const mvStd = !!STANDARD_VIDEO_MODES[rawMode]
	let profXml = ''
	if (deckN > 0 && mvStd) {
		profXml = `
                <decklink>
                    <device>${deckN}</device>
                </decklink>`
	}
	return `        <channel>
            <video-mode>${modeId}</video-mode>
            <consumers>${profXml}
            </consumers>
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`
}

module.exports = {
	buildScreenPairChannels,
	buildMultiviewChannel,
	buildInputsHostChannel,
	buildExtraAudioChannel,
	buildStreamingChannel,
	buildMonitorChannelXml,
}
