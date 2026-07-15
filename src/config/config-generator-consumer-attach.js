'use strict'

const { channelXmlComment } = require('./config-generator-xml-comments')
const { STANDARD_VIDEO_MODES, resolveLiveAudioInputChannelMode } = require('./config-modes')
const { effectiveStandardVideoModeId } = require('./config-generator-mode-helpers')
const {
	parseOptionalPixel,
	buildComposePreviewFfmpegConsumerXml,
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
const { casparBoolEnabled, readMultiviewSetting, readMultiviewWindowChromeFlag } = require('./config-generator-utils')
const { buildRtmpFfmpegConsumersForChannel } = require('./rtmp-output')
const {
	buildDecklinkKeyFillConsumersXml,
	readDecklinkKeyFillSettings,
	readDecklinkConsumerSettings,
	parseDecklinkDeviceIndex,
	resolveDecklinkConsumerKeyer,
	decklinkPixelFormatXml,
} = require('./decklink-key-fill')
const {
	resolveDecklinkVideoModeForTarget,
	channelVideoModeForDecklinkConsumer,
	pickDecklinkParentVideoMode,
} = require('./decklink-output-resolve')
const { computeArtnetUniverseSpill } = require('./artnet-pixelmap-universe')
const { clampedInt } = require('./screen-destinations')

/**
 * One DeckLink consumer spanning a wide channel: parent global `<video-mode>` + primary SDI
 * (first tile on `<decklink>`) + synced `<ports>` for additional tiles.
 * Caspar cannot use the channel custom mode (e.g. 5120×1024) for DeckLink format — parent video-mode is required.
 * @param {{ device: number, srcX: number, srcY: number, destX: number, destY: number, width: number, height: number, videoMode: string }[]} tiles
 * @param {{ videoMode?: string, keyer?: string, lowLatency?: boolean }} [opts]
 */
function buildDecklinkTiledConsumersXml(tiles, opts = {}) {
	if (!Array.isArray(tiles) || tiles.length === 0) return ''
	const globalVideoMode = escapeXml(String(opts.videoMode || tiles[0]?.videoMode || '1080p5000'))
	const pixelFormatXml = decklinkPixelFormatXml(String(opts.videoMode || tiles[0]?.videoMode || ''))
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
	const vsync = casparBoolEnabled(config[`screen_${n}_vsync`], true)
	const alwaysOnTop = casparBoolEnabled(config[`screen_${n}_always_on_top`], false)
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
	const prvXml = `${channelXmlComment(`Caspar channel ${prvChNum}: Screen ${n} preview output (PRV)`)}        <channel>
            <video-mode>${dims.modeId}</video-mode>
            <consumers>${composePrvXml}${prvSystemAudioXml}${rtmpPrvXml}</consumers>
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
		resolveLiveAudioInputChannelMode(config) || config.inputs_channel_mode,
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
 * WO-242: dedicated Caspar channel for a native `pixelmap` screen destination — a custom video-mode
 * raster feeding one native `<artnet>` consumer fixture group. XML shape is strictly the schema
 * documented (with `artnet_consumer.cpp` line cites) in docs/WALKTHROUGH_ARTNET_LED_WALL.md — the
 * whole channel raster is sampled by one `<fixture>` (center box == full frame, matching the
 * walkthrough's 8x4-wall example), `fixture-count` = `<cols>x<rows>` (row-major grid).
 * PGM-only: no `<screen>`/DeckLink/NDI/RTMP consumers — this channel exists to drive the wall.
 * @param {Record<string, unknown>} config
 * @param {ReturnType<import('./screen-destinations').normalizeDestination>} dest
 * @param {any} dims - `{ width, height, fps, modeId, isCustom }` from `getModeDimensions`
 * @param {number|null|undefined} casparChannelNum
 */
function buildPixelmapChannel(config, dest, dims, casparChannelNum) {
	const art = dest && typeof dest.artnet === 'object' && dest.artnet ? dest.artnet : {}
	const ip = escapeXml(String(art.ip || ''))
	const port = clampedInt(art.port, 6454, 1, 65535)
	const startUniverse = clampedInt(art.startUniverse, 0, 0, 32767)
	const startAddress = clampedInt(art.startAddress, 1, 1, 512)
	const colorOrder = String(art.colorOrder || 'RGB').toUpperCase() === 'RGBW' ? 'RGBW' : 'RGB'
	const rows = clampedInt(art.rows, 1, 1, 4096)
	const cols = clampedInt(art.cols, 1, 1, 4096)
	const refreshRateHz = clampedInt(art.refreshRateHz, 10, 1, 1000)
	const channelsPerFixture = colorOrder === 'RGBW' ? 4 : 3
	const width = Math.max(64, parseInt(String(dims?.width ?? 1920), 10) || 1920)
	const height = Math.max(64, parseInt(String(dims?.height ?? 1080), 10) || 1080)

	const spill = computeArtnetUniverseSpill({ rows, cols, channelsPerFixture, startAddress, startUniverse })

	const ch = casparChannelNum != null && Number.isFinite(Number(casparChannelNum)) ? Number(casparChannelNum) : '?'
	const label = escapeXml(String(dest?.label || 'Pixel Map'))
	const universeNote =
		spill.universesUsed > 1
			? `universes ${spill.startUniverse}-${spill.endUniverse} (${spill.universesUsed} universes, auto-spill)`
			: `universe ${spill.startUniverse}`
	const fixturesXml = `
                    <fixtures>
                        <fixture>
                            <type>${colorOrder}</type>
                            <start-address>${startAddress}</start-address>
                            <fixture-count>${cols}x${rows}</fixture-count>
                            <fixture-channels>${channelsPerFixture}</fixture-channels>
                            <host>${ip}</host>
                            <port>${port}</port>
                            <universe>${startUniverse}</universe>
                            <x>${Math.round(width / 2)}</x>
                            <y>${Math.round(height / 2)}</y>
                            <width>${width}</width>
                            <height>${height}</height>
                            <brightness>1.0</brightness>
                        </fixture>
                    </fixtures>`
	return `${channelXmlComment(
		`Caspar channel ${ch}: Pixel-map screen "${label}" — native <artnet> wall ${cols}x${rows} ${colorOrder} @ ${art.ip || '(no host set)'}, ${universeNote}`,
	)}        <channel>
            <video-mode>${dims.modeId}</video-mode>
            <consumers>
                <artnet>
                    <refresh-rate>${refreshRateHz}</refresh-rate>${fixturesXml}
                </artnet>
            </consumers>
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
	const modeId = entry && STANDARD_VIDEO_MODES[String(entry.mode)] ? String(entry.mode) : '1080p5000'
	const ch = entry && Number.isFinite(Number(entry.channel)) ? Number(entry.channel) : '?'
	const composeXml = Number.isFinite(Number(entry?.channel)) ? buildComposePreviewFfmpegConsumerXml(config, entry.channel) : ''
	const role =
		entry?.kind === 'live_audio'
			? `Live audio input ${entry?.slot} (ALSA PLAY … alsa:// on layer ${entry?.layer}; cheap channel, isolated VU)`
			: entry?.kind === 'v4l2'
				? `V4L2 / USB video input ${entry?.slot} (PLAY ${ch}-${entry?.layer} udp://…; dedicated channel)`
				: `DeckLink input ${entry?.slot} (PLAY ${ch}-${entry?.layer} DECKLINK <device>; dedicated channel, isolated VU)`
	return `${channelXmlComment(`Caspar channel ${ch}: ${role}`)}        <channel>
            <video-mode>${escapeXml(modeId)}</video-mode>${channelLayoutElementXml('stereo')}
            <consumers>${composeXml}
            </consumers>
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`
}

/**
 * WO-88: dedicated host channel for webpage / NDI live sources (no consumers; producer via AMCP).
 * @param {Record<string, unknown>} config
 * @param {{ kind: string, channel: number, layer: number, mode: string, label?: string, sourceId?: string }} entry
 */
function buildHostLiveChannel(config, entry) {
	const modeId = entry && STANDARD_VIDEO_MODES[String(entry.mode)] ? String(entry.mode) : '1080p5000'
	const ch = entry && Number.isFinite(Number(entry.channel)) ? Number(entry.channel) : '?'
	const composeXml = Number.isFinite(Number(entry?.channel)) ? buildComposePreviewFfmpegConsumerXml(config, entry.channel) : ''
	const role =
		entry?.kind === 'ndi_host'
			? `NDI host ${entry?.label || entry?.sourceId || ''} (PLAY ${ch}-${entry?.layer} NDI …; route:// for on-air)`
			: `Webpage host ${entry?.label || entry?.sourceId || ''} (PLAY ${ch}-${entry?.layer} [HTML] … LOOP; route:// for on-air)`
	return `${channelXmlComment(`Caspar channel ${ch}: ${role}`)}        <channel>
            <video-mode>${escapeXml(modeId)}</video-mode>${channelLayoutElementXml('stereo')}
            <consumers>${composeXml}
            </consumers>
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`
}

/**
 * WO-172 T172.6: resolve the `<channel-layout>` for the dedicated streaming/encode bus from the
 * cabled source's program-bus layout (`screen_N_audio_layout`, already derived onto `config` by
 * `applyDestinationAudioLayoutsToScreens` before this generator stage runs — see
 * `src/config/build-caspar-generator-config.js:281-288`). Multiview / unresolved source: 'stereo'
 * (multiview has no per-layout audio; `buildMultiviewChannel` likewise emits no `<channel-layout>`).
 * @param {Record<string, unknown>} config
 * @param {Record<string, unknown>} sc - `config.streamingChannel`
 * @returns {string}
 */
function resolveStreamingChannelAudioLayout(config, sc) {
	const rawVideo = String(sc.videoSource || 'program_1').toLowerCase()
	const m = rawVideo.match(/^(?:program|preview)[_-]?(\d+)$/)
	if (!m) return 'stereo'
	const n = parseInt(m[1], 10) || 1
	return String(config[`screen_${n}_audio_layout`] || 'stereo').toLowerCase() || 'stereo'
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
}
