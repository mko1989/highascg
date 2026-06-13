'use strict'

const { channelXmlComment } = require('./config-generator-xml-comments')
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
const {
	buildDecklinkKeyFillConsumersXml,
	readDecklinkKeyFillSettings,
	parseDecklinkDeviceIndex,
	normalizeDecklinkKeyer,
} = require('./decklink-key-fill')

/**
 * One DeckLink consumer spanning a wide channel: primary device + optional synced `<ports>` (Caspar reference layout).
 * @param {{ device: number, srcX: number, srcY: number, destX: number, destY: number, width: number, height: number, videoMode: string }[]} tiles
 */
function buildDecklinkTiledConsumersXml(tiles) {
	if (!Array.isArray(tiles) || tiles.length === 0) return ''
	const subBlock = (t, indent) =>
		`${indent}<subregion>\n${indent}    <src-x>${t.srcX}</src-x>\n${indent}    <src-y>${t.srcY}</src-y>\n${indent}    <dest-x>${t.destX}</dest-x>\n${indent}    <dest-y>${t.destY}</dest-y>\n${indent}    <width>${t.width}</width>\n${indent}    <height>${t.height}</height>\n${indent}</subregion>`
	const primary = tiles[0]
	const rest = tiles.slice(1)
	let portsXml = ''
	if (rest.length) {
		portsXml =
			'\n                <ports>' +
			rest
				.map(
					(t) => `
                    <port>
                        <device>${t.device}</device>
                        <key-only>false</key-only>
                         <buffer-depth>3</buffer-depth>
                         <video-mode>${escapeXml(t.videoMode)}</video-mode>
${subBlock(t, '                        ')}
                     </port>`
 				)
 				.join('') +
 			'\n                </ports>'
 	}
 	return `\n                <decklink>
                     <device>${primary.device}</device>
                     <embedded-audio>true</embedded-audio>
                     <latency>normal</latency>
                     <keyer>external</keyer>
                     <key-only>false</key-only>
                     <buffer-depth>3</buffer-depth>
                     <video-mode>${escapeXml(primary.videoMode)}</video-mode>
${subBlock(primary, '                    ')}${portsXml}
                 </decklink>`
 }

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

	const tilesRaw = config[`screen_${n}_decklink_tiles`]
	const tiles = Array.isArray(tilesRaw) ? tilesRaw : []
	const decklinkDevice = parseInt(String(config[`screen_${n}_decklink_device`] || '0'), 10)
	const decklinkReplaceScreen =
		(config[`screen_${n}_decklink_replace_screen`] === true || config[`screen_${n}_decklink_replace_screen`] === 'true') &&
		(decklinkDevice > 0 || tiles.length > 0) &&
		(!dims.isCustom || tiles.length > 0)

	let profConsumersXml = ''
	if (tiles.length > 0) {
		profConsumersXml += buildDecklinkTiledConsumersXml(tiles)
	} else if (decklinkDevice > 0) {
		const keyFill = readDecklinkKeyFillSettings(config, `screen_${n}_`)
		profConsumersXml += buildDecklinkKeyFillConsumersXml({
			fillDevice: decklinkDevice,
			keyDevice: keyFill.keyDevice,
			keyer: keyFill.keyer,
		})
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
	const screenConsumerEnabled = config[`screen_${n}_screen_consumer`] !== false && config[`screen_${n}_screen_consumer`] !== 'false'
	const screenConsumerXml = (decklinkReplaceScreen || !screenConsumerEnabled)
		? ''
		: `
                <screen>
                    ${screenInner}
                </screen>`

	const pgmXml = `${channelXmlComment(`Caspar channel ${pgmChNum}: Screen ${n} program output (PGM)`)}        <channel>
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
	const prvXml = `${channelXmlComment(`Caspar channel ${prvChNum}: Screen ${n} preview output (PRV)`)}        <channel>
            <video-mode>${dims.modeId}</video-mode>
            <consumers>${prvStreamingXml}${prvSystemAudioXml}${rtmpPrvXml}</consumers>
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`
	const bus2Num = routeMap.switcherBusChannels?.[n - 1]
	const bus2Xml =
		bus2Num != null && Number.isFinite(Number(bus2Num))
			? `${channelXmlComment(`Caspar channel ${bus2Num}: Screen ${n} switcher bus 2 (legacy)`)}        <channel>
            <video-mode>${dims.modeId}</video-mode>
            <consumers/>
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`
			: ''

	return {
		pgmXml,
		prvXml,
		bus2Xml,
		hasScreenConsumer: !decklinkReplaceScreen && screenConsumerEnabled,
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
	const mvKeyFill = readDecklinkKeyFillSettings(config, 'multiview_')
	const deckBlock =
		includeDeck && mvDlDev > 0
			? buildDecklinkKeyFillConsumersXml({
					fillDevice: mvDlDev,
					keyDevice: mvKeyFill.keyDevice,
					keyer: mvKeyFill.keyer,
				})
			: ''
	const streamBlock = includeStream ? mvStreamingXml : ''
	
	const mvChs = Array.isArray(routeMap.multiviewChannels) ? routeMap.multiviewChannels : [routeMap.multiviewCh]
	const mvChNum = mvChs[n - 1] || null
	const rtmpMvXml = mvChNum != null ? buildRtmpFfmpegConsumersForChannel(config, mvChNum) : ''

	const mvChLabel = mvChNum != null && Number.isFinite(Number(mvChNum)) ? mvChNum : '?'
	const xml = `${channelXmlComment(`Caspar channel ${mvChLabel}: Multiview output #${n}`)}        <channel>
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
 * @param {number} liveAudioCount
 * @param {boolean} inputsHostChannelEnabled
 * @param {boolean} inputsOnMvr
 * @param {number|null|undefined} casparChannelNum - channel index for comment
 */
function buildInputsHostChannel(config, decklinkCount, liveAudioCount, inputsHostChannelEnabled, inputsOnMvr, casparChannelNum) {
	if (inputsOnMvr) return ''
	const hostCh = decklinkCount > 0 || liveAudioCount > 0 || inputsHostChannelEnabled === true
	if (!hostCh) return ''
	const modeId = effectiveStandardVideoModeId(
		config.live_audio_inputs_channel_mode || config.inputs_channel_mode
	)
	const ch = casparChannelNum != null && Number.isFinite(Number(casparChannelNum)) ? Number(casparChannelNum) : '?'
	return `${channelXmlComment(`Caspar channel ${ch}: Live INPUT host (DeckLink PLAY … DECKLINK; ALSA PLAY … alsa:// on layers 10+). Empty consumers is normal.`)}        <channel>
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
 * @param {number|null|undefined} casparChannelNum
 */
function buildExtraAudioChannel(config, i, dims, casparChannelNum) {
	const layoutXml = channelLayoutElementXml(String(config[`extra_audio_${i}_audio_layout`] || 'default'))
	const ffmpegXml = buildExtraAudioFfmpegConsumersXml(config, i)
	const consumersBlock = ffmpegXml
		? `<consumers>${ffmpegXml}
            </consumers>`
		: `<consumers/>`
	const ch = casparChannelNum != null && Number.isFinite(Number(casparChannelNum)) ? Number(casparChannelNum) : '?'
	return `${channelXmlComment(`Caspar channel ${ch}: Extra audio-only output ${i}`)}        <channel>
            <video-mode>${dims.modeId}</video-mode>${layoutXml}
            ${consumersBlock}
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`
}

/**
 * WO-53: one dedicated channel per live input. The producer (DeckLink/ALSA) is PLAYed here over AMCP,
 * so the channel-level OSC meter is isolated to that single input. DeckLink uses a full-quality mode
 * (`inputs_channel_mode`); audio-only ALSA uses the cheap lowest standard mode. No config consumers.
 * @param {Record<string, unknown>} config
 * @param {{ kind: string, slot: number, channel: number, layer: number, mode: string, label: string }} entry
 */
function buildInputChannel(config, entry) {
	void config
	const modeId = entry && STANDARD_VIDEO_MODES[String(entry.mode)] ? String(entry.mode) : '1080p5000'
	const ch = entry && Number.isFinite(Number(entry.channel)) ? Number(entry.channel) : '?'
	const role =
		entry?.kind === 'live_audio'
			? `Live audio input ${entry?.slot} (ALSA PLAY … alsa:// on layer ${entry?.layer}; cheap channel, isolated VU)`
			: `DeckLink input ${entry?.slot} (PLAY ${ch}-${entry?.layer} DECKLINK <device>; dedicated channel, isolated VU)`
	return `${channelXmlComment(`Caspar channel ${ch}: ${role}`)}        <channel>
            <video-mode>${escapeXml(modeId)}</video-mode>
            <consumers/>
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`
}

/**
 * @param {Record<string, unknown>} config
 * @param {number|null|undefined} casparChannelNum
 */
function buildStreamingChannel(config, casparChannelNum) {
	const sc = config.streamingChannel && typeof config.streamingChannel === 'object' ? config.streamingChannel : {}
	const rawMode = String(sc.videoMode || config.screen_1_mode || '1080p5000').trim() || '1080p5000'
	const modeId = effectiveStandardVideoModeId(rawMode)
	const deckN = parseInt(String(sc.decklinkDevice || '0'), 10) || 0
	const mvStd = !!STANDARD_VIDEO_MODES[rawMode]
	let profXml = ''
	if (deckN > 0 && mvStd) {
		profXml = buildDecklinkKeyFillConsumersXml({
			fillDevice: deckN,
			keyDevice: parseDecklinkDeviceIndex(sc.decklinkKeyDevice),
			keyer: normalizeDecklinkKeyer(sc.decklinkKeyer),
		})
	}
	const ch = casparChannelNum != null && Number.isFinite(Number(casparChannelNum)) ? Number(casparChannelNum) : '?'
	return `${channelXmlComment(`Caspar channel ${ch}: Dedicated streaming / encode bus (HighAsCG attaches FFmpeg/SRT here)`)}        <channel>
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
	buildInputChannel,
	buildStreamingChannel,
	buildMonitorChannelXml,
}
