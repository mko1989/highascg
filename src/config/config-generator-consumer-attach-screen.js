'use strict'

const { channelXmlComment } = require('./config-generator-xml-comments')
const {
	parseOptionalPixel,
	buildComposePreviewFfmpegConsumerXml,
	buildScreenFfmpegConsumersXml,
	channelLayoutElementXml,
	buildProgramSystemAudioXml,
	buildPreviewSystemAudioXml,
	buildProgramScreenConsumerInnerXml,
	escapeXml,
	buildPortAudioConsumerXml,
} = require('./config-generator-builders')
const { casparBoolEnabled } = require('./config-generator-utils')
const { buildRtmpFfmpegConsumersForChannel } = require('./rtmp-output')
const {
	buildDecklinkKeyFillConsumersXml,
	readDecklinkKeyFillSettings,
	readDecklinkConsumerSettings,
	resolveDecklinkConsumerKeyer,
	decklinkPixelFormatXml,
} = require('./decklink-key-fill')
const {
	resolveDecklinkVideoModeForTarget,
	channelVideoModeForDecklinkConsumer,
	pickDecklinkParentVideoMode,
} = require('./decklink-output-resolve')

/**
 * One DeckLink consumer spanning a wide channel: parent global `<video-mode>` + primary SDI
 * (first tile on `<decklink>`) + synced `<ports>` for additional tiles.
 * Caspar cannot use the channel custom mode (e.g. 5120×1024) for DeckLink format — parent video-mode is required.
 * @param {{ device: number, srcX: number, srcY: number, destX: number, destY: number, width: number, height: number, videoMode: string }[]} tiles
 * @param {{ videoMode?: string, keyer?: string, lowLatency?: boolean, consumerSettings?: object }} [opts]
 */
function buildDecklinkTiledConsumersXml(tiles, opts = {}) {
	if (!Array.isArray(tiles) || tiles.length === 0) return ''
	const globalVideoMode = escapeXml(String(opts.videoMode || tiles[0]?.videoMode || '1080p5000'))
	const pixelFormatXml = decklinkPixelFormatXml(String(opts.videoMode || tiles[0]?.videoMode || ''), opts.consumerSettings)
	const lowLatencyXml = opts.lowLatency ? '\n                     <latency>low</latency>' : ''
	const keyerXml = `\n                     <keyer>${escapeXml(
		resolveDecklinkConsumerKeyer({
			fillDevice: tiles[0]?.device,
			keyDevice: opts.keyDevice,
			keyer: opts.keyer,
		}),
	)}</keyer>`
	const subBlock = (t, indent) =>
		`${indent}<subregion>\n${indent}    <src-x>${t.srcX}</src-x>\n${indent}    <src-y>${t.srcY}</src-y>\n${indent}    <dest-x>${t.destX}</dest-x>\n${indent}    <dest-y>${t.destY}</dest-y>\n${indent}    <width>${t.width}</width>\n${indent}    <height>${t.height}</height>\n${indent}</subregion>`
	const portBody = (t, indent) =>
		`\n${indent}<device>${t.device}</device>\n${indent}    <key-only>false</key-only>\n${indent}     <buffer-depth>3</buffer-depth>\n${indent}     <video-mode>${escapeXml(t.videoMode)}</video-mode>\n${subBlock(t, indent)}`
	const primary = tiles[0]
	const secondaries = tiles.slice(1)
	const primaryXml = portBody(primary, '                    ')
	const portsXml =
		secondaries.length > 0
			? `\n                <ports>${secondaries
					.map((t) => `\n                   <port>${portBody(t, '                        ')}\n                     </port>`)
					.join('')}\n                </ports>`
			: ''
	return `\n                <decklink>
                     <video-mode>${globalVideoMode}</video-mode>${pixelFormatXml}${lowLatencyXml}${keyerXml}${primaryXml}${portsXml}
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
	const windowed = casparBoolEnabled(config[`screen_${n}_windowed`], true)
	/* Unset must agree with casparScreenDefaults(): vsync OFF (GL sync paces frames, WO-407/444). */
	const vsync = casparBoolEnabled(config[`screen_${n}_vsync`], false)
	// PGM default is on: an unset key must agree with casparScreenDefaults() and with the
	// Device View checkbox, which also renders unset as on.
	const alwaysOnTop = casparBoolEnabled(config[`screen_${n}_always_on_top`], true)
	const borderless = casparBoolEnabled(config[`screen_${n}_borderless`], true)

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
		const keyFill = readDecklinkKeyFillSettings(config, `screen_${n}_`)
		const consumerSettings = readDecklinkConsumerSettings(config, `screen_${n}_`)
		profConsumersXml += buildDecklinkTiledConsumersXml(tiles, {
			videoMode: pickDecklinkParentVideoMode(tiles),
			keyer: keyFill.keyer,
			keyDevice: keyFill.keyDevice,
			keyFillEnabled: keyFill.keyFillEnabled,
			lowLatency: consumerSettings.lowLatency,
			// WO-493: without this the operator's pixel-format choice never reaches a tiled (LED-wall)
			// SDI output — the exact shape a 2160p wall uses.
			consumerSettings,
		})
	} else if (decklinkDevice > 0) {
		const keyFill = readDecklinkKeyFillSettings(config, `screen_${n}_`)
		const decklinkVideoMode = resolveDecklinkVideoModeForTarget(config, 'screen', n)
		const consumerSettings = readDecklinkConsumerSettings(config, `screen_${n}_`)
		if (decklinkVideoMode) {
			profConsumersXml += buildDecklinkKeyFillConsumersXml({
				fillDevice: decklinkDevice,
				keyDevice: keyFill.keyDevice,
				keyer: keyFill.keyer,
				videoMode: decklinkVideoMode,
				consumerSettings,
				lowLatency: consumerSettings.lowLatency,
			})
		}
	}
	const ndiEnabled = config[`screen_${n}_ndi_enabled`] === true || config[`screen_${n}_ndi_enabled`] === 'true'
	if (ndiEnabled) {
		const ndiName = escapeXml(config[`screen_${n}_ndi_name`] || `HighAsCG-CH${n}`)
		profConsumersXml += `\n                <ndi>
                    <name>${ndiName}</name>
                </ndi>`
	}
	// NDI STREAM OUTPUTS cabled from this screen's destination (applyNdiStreamOutputsToScreens):
	// owner spec — treated like an SDI out, always on, config-time consumer, no Start button. One
	// <ndi> per output; a name colliding with the per-screen block above is skipped, since two NDI
	// senders with one name on one host is an on-air conflict, not redundancy.
	const ndiStreamNames = Array.isArray(config[`screen_${n}_ndi_stream_names`])
		? config[`screen_${n}_ndi_stream_names`]
		: []
	for (const rawName of ndiStreamNames) {
		const name = String(rawName || '').trim()
		if (!name) continue
		if (ndiEnabled && name === String(config[`screen_${n}_ndi_name`] || `HighAsCG-CH${n}`)) continue
		profConsumersXml += `\n                <ndi>
                    <name>${escapeXml(name)}</name>
                </ndi>`
	}

	const pgmChNum = routeMap.programCh(n)
	const composePgmXml = buildComposePreviewFfmpegConsumerXml(config, pgmChNum)
	const rtmpPgmXml = buildRtmpFfmpegConsumersForChannel(config, pgmChNum)
	const screenConsumerEnabled = config[`screen_${n}_screen_consumer`] !== false && config[`screen_${n}_screen_consumer`] !== 'false'
	const decklinkVideoModeForScreen =
		decklinkDevice > 0 ? resolveDecklinkVideoModeForTarget(config, 'screen', n) : null
	const pgmChannelModeId = channelVideoModeForDecklinkConsumer({
		channelModeId: dims.modeId,
		isChannelCustom: dims.isCustom,
		decklinkVideoMode: decklinkVideoModeForScreen,
		hasScreenConsumer: screenConsumerEnabled && !decklinkReplaceScreen,
		decklinkReplaceScreen,
	})
	const screenConsumerXml = (decklinkReplaceScreen || !screenConsumerEnabled)
		? ''
		: `
                <screen>
                    ${screenInner}
                </screen>`

	const pgmXml = `${channelXmlComment(`Caspar channel ${pgmChNum}: Screen ${n} program output (PGM)`)}        <channel>
            <video-mode>${pgmChannelModeId}</video-mode>${layoutXml}
            <consumers>${screenConsumerXml}${screenSystemAudioXml}${portAudioXml}${ffmpegXml}${composePgmXml}${profConsumersXml}${rtmpPgmXml}
            </consumers>
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`

	const prvSystemAudioXml = buildPreviewSystemAudioXml(config, n)
	const prvChNum = routeMap.previewCh(n)
	const composePrvXml = buildComposePreviewFfmpegConsumerXml(config, prvChNum)
	const rtmpPrvXml = buildRtmpFfmpegConsumersForChannel(config, prvChNum)
	/* WO-364: the PRV bus is a real output — a GPU jack cabled to the destination's PRV half
	 * (layout-sync sets screen_N_prv_screen_consumer + _prv_x/_prv_y from the placed PRV head)
	 * gets a full <screen> consumer on the preview channel, same raster as the pair. */
	const prvScreenEnabled =
		config[`screen_${n}_prv_screen_consumer`] === true || config[`screen_${n}_prv_screen_consumer`] === 'true'
	const prvDeviceNum = ctx.nextDevice + ((decklinkReplaceScreen || !screenConsumerEnabled) ? 0 : 1)
	const prvScreenXml = !prvScreenEnabled
		? ''
		: `
                <screen>
                    <device>${prvDeviceNum}</device>
                    <x>${parseOptionalPixel(config[`screen_${n}_prv_x`], 0)}</x><y>${parseOptionalPixel(config[`screen_${n}_prv_y`], 0)}</y>
                    <width>${dims.width}</width><height>${dims.height}</height>
                    <stretch>${stretch}</stretch>
                    <windowed>${windowed}</windowed>
                    <vsync>${vsync}</vsync>
                    <always-on-top>${alwaysOnTop}</always-on-top>
                    <borderless>${borderless}</borderless>
                </screen>`
	const prvXml = `${channelXmlComment(`Caspar channel ${prvChNum}: Screen ${n} preview output (PRV)${prvScreenEnabled ? ' — physical PRV head (WO-364)' : ''}`)}        <channel>
            <video-mode>${dims.modeId}</video-mode>
            <consumers>${prvScreenXml}${composePrvXml}${prvSystemAudioXml}${rtmpPrvXml}</consumers>
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
		hasPrvScreenConsumer: prvScreenEnabled,
	}
}

module.exports = {
	buildDecklinkTiledConsumersXml,
	buildScreenPairChannels,
}
