'use strict'

const { channelXmlComment } = require('./config-generator-xml-comments')
const { STANDARD_VIDEO_MODES, resolveLiveAudioInputChannelMode } = require('./config-modes')
const { effectiveStandardVideoModeId } = require('./config-generator-mode-helpers')
const {
	buildComposePreviewFfmpegConsumerXml,
	buildExtraAudioFfmpegConsumersXml,
	channelLayoutElementXml,
	escapeXml,
} = require('./config-generator-builders')
const { computeArtnetUniverseSpill } = require('./artnet-pixelmap-universe')
const { clampedInt } = require('./screen-destinations')

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
			: entry?.kind === 'browser_display'
				? `Browser display host ${entry?.label || entry?.sourceId || ''} (WO-258: real Firefox on an off-screen :0 region, x11grab -> PLAY ${ch}-${entry?.layer} udp://127.0.0.1:…; route:// for on-air)`
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

module.exports = {
	buildInputsHostChannel,
	buildExtraAudioChannel,
	buildPixelmapChannel,
	buildInputChannel,
	buildHostLiveChannel,
}
