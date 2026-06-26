'use strict'

const { escapeXml } = require('./config-generator-builders')
const { casparChannelLayoutId } = require('./audio-channel-layouts')

const DECKLINK_LATENCY_VALUES = new Set(['normal', 'low', 'default'])
const DECKLINK_COLOR_SPACE_VALUES = new Set(['bt709', 'bt601', 'bt2020'])

const DEFAULT_DECKLINK_CONSUMER_SETTINGS = {
	embeddedAudio: true,
	channelLayout: 'stereo',
	latency: 'normal',
	bufferDepth: 5,
	colorSpace: 'bt709',
}

const KEYER_VALUES = new Set(['internal', 'external', 'external_separate_device', 'default'])
/** Caspar fill-only SDI: no hardware keyer (not internal/external). */
const FILL_ONLY_KEYER = 'default'

/**
 * DeckLink pixel-format is not emitted — Caspar defaults (RGBA) are preferred for fill output.
 * @param {string} [_videoMode]
 * @returns {string}
 */
function decklinkPixelFormatXml(_videoMode) {
	return ''
}

/**
 * @param {unknown} raw
 * @returns {number}
 */
function parseDecklinkDeviceIndex(raw) {
	const n = parseInt(String(raw ?? ''), 10)
	return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeDecklinkKeyer(raw) {
	const s = String(raw || FILL_ONLY_KEYER).trim().toLowerCase()
	if (s === 'none' || s === 'disabled') return FILL_ONLY_KEYER
	return KEYER_VALUES.has(s) ? s : FILL_ONLY_KEYER
}

/**
 * Key/fill pair uses configured keyer; plain fill SDI uses default (no hardware keyer).
 * @param {{ fillDevice?: number, keyDevice?: number, keyer?: string }} opts
 * @returns {string}
 */
function resolveDecklinkConsumerKeyer(opts) {
	const fillDevice = parseDecklinkDeviceIndex(opts?.fillDevice)
	const keyDevice = parseDecklinkDeviceIndex(opts?.keyDevice)
	if (keyDevice > 0 && keyDevice !== fillDevice) return normalizeDecklinkKeyer(opts?.keyer)
	return FILL_ONLY_KEYER
}

/**
 * Read fill + optional key device from casparServer slice (`screen_N_*` or `multiview_*`).
 * @param {Record<string, unknown>|null|undefined} cs
 * @param {string} prefix - e.g. `screen_2_` or `multiview_`
 */
function readDecklinkKeyFillSettings(cs, prefix) {
	const fillDevice = parseDecklinkDeviceIndex(cs?.[`${prefix}decklink_device`])
	const keyDevice = parseDecklinkDeviceIndex(cs?.[`${prefix}decklink_key_device`])
	const keyer = normalizeDecklinkKeyer(cs?.[`${prefix}decklink_keyer`])
	const keyFillEnabled = keyDevice > 0 && keyDevice !== fillDevice && fillDevice > 0
	return { fillDevice, keyDevice: keyFillEnabled ? keyDevice : 0, keyer, keyFillEnabled }
}

/**
 * @param {Record<string, unknown>|null|undefined} caspar
 */
function readDecklinkKeyFillFromConnectorCaspar(caspar) {
	if (!caspar || typeof caspar !== 'object') {
		return { keyDevice: 0, keyer: FILL_ONLY_KEYER, enabled: false }
	}
	const keyDevice = parseDecklinkDeviceIndex(caspar.decklinkKeyDevice)
	const keyer = normalizeDecklinkKeyer(caspar.decklinkKeyer)
	const enabled =
		caspar.decklinkKeyFill === true ||
		caspar.decklinkKeyFill === 'true' ||
		(keyDevice > 0 && caspar.decklinkKeyFill !== false && caspar.decklinkKeyFill !== 'false')
	return { keyDevice, keyer, enabled: enabled && keyDevice > 0 }
}

/**
 * Persist key/fill fields on casparServer for a screen or multiview prefix.
 * @param {Record<string, unknown>} cs
 * @param {string} prefix
 * @param {{ keyDevice?: number, keyer?: string, fillDevice?: number }} opts
 */
function writeDecklinkKeyFillToCasparServer(cs, prefix, opts = {}) {
	const fill = parseDecklinkDeviceIndex(opts.fillDevice ?? cs[`${prefix}decklink_device`])
	const key = parseDecklinkDeviceIndex(opts.keyDevice)
	if (fill > 0) cs[`${prefix}decklink_device`] = fill
	if (key > 0 && key !== fill) {
		cs[`${prefix}decklink_key_device`] = key
		cs[`${prefix}decklink_keyer`] = normalizeDecklinkKeyer(opts.keyer)
	} else {
		cs[`${prefix}decklink_key_device`] = 0
		if (opts.keyer != null) cs[`${prefix}decklink_keyer`] = normalizeDecklinkKeyer(opts.keyer)
	}
}

/**
 * @param {unknown} raw
 * @param {boolean} [fallback]
 */
function parseDecklinkEmbeddedAudio(raw, fallback = DEFAULT_DECKLINK_CONSUMER_SETTINGS.embeddedAudio) {
	if (raw === true || raw === 'true') return true
	if (raw === false || raw === 'false') return false
	return fallback
}

/**
 * @param {unknown} raw
 */
function normalizeDecklinkLatency(raw) {
	const s = String(raw || DEFAULT_DECKLINK_CONSUMER_SETTINGS.latency).trim().toLowerCase()
	return DECKLINK_LATENCY_VALUES.has(s) ? s : DEFAULT_DECKLINK_CONSUMER_SETTINGS.latency
}

/**
 * @param {unknown} raw
 */
function normalizeDecklinkColorSpace(raw) {
	const s = String(raw || DEFAULT_DECKLINK_CONSUMER_SETTINGS.colorSpace).trim().toLowerCase()
	return DECKLINK_COLOR_SPACE_VALUES.has(s) ? s : DEFAULT_DECKLINK_CONSUMER_SETTINGS.colorSpace
}

/**
 * @param {unknown} raw
 */
function normalizeDecklinkBufferDepth(raw) {
	const n = parseInt(String(raw ?? DEFAULT_DECKLINK_CONSUMER_SETTINGS.bufferDepth), 10)
	return Number.isFinite(n) && n >= 1 && n <= 16 ? n : DEFAULT_DECKLINK_CONSUMER_SETTINGS.bufferDepth
}

/**
 * @param {unknown} raw
 */
function normalizeDecklinkChannelLayout(raw) {
	const s = String(raw || DEFAULT_DECKLINK_CONSUMER_SETTINGS.channelLayout).trim().toLowerCase()
	return casparChannelLayoutId(s || 'stereo')
}

/**
 * @param {Record<string, unknown>|null|undefined} cs
 * @param {string} prefix
 */
function readDecklinkConsumerSettings(cs, prefix) {
	return {
		embeddedAudio: parseDecklinkEmbeddedAudio(cs?.[`${prefix}decklink_embedded_audio`]),
		channelLayout: normalizeDecklinkChannelLayout(cs?.[`${prefix}decklink_channel_layout`]),
		latency: normalizeDecklinkLatency(cs?.[`${prefix}decklink_latency`]),
		bufferDepth: normalizeDecklinkBufferDepth(cs?.[`${prefix}decklink_buffer_depth`]),
		colorSpace: normalizeDecklinkColorSpace(cs?.[`${prefix}decklink_color_space`]),
	}
}

/**
 * @param {Record<string, unknown>|null|undefined} caspar
 */
function readDecklinkConsumerSettingsFromConnectorCaspar(caspar) {
	if (!caspar || typeof caspar !== 'object') return { ...DEFAULT_DECKLINK_CONSUMER_SETTINGS }
	return {
		embeddedAudio: parseDecklinkEmbeddedAudio(caspar.decklinkEmbeddedAudio),
		channelLayout: normalizeDecklinkChannelLayout(caspar.decklinkChannelLayout),
		latency: normalizeDecklinkLatency(caspar.decklinkLatency),
		bufferDepth: normalizeDecklinkBufferDepth(caspar.decklinkBufferDepth),
		colorSpace: normalizeDecklinkColorSpace(caspar.decklinkColorSpace),
	}
}

/**
 * @param {Record<string, unknown>} merged
 * @param {string} prefix
 * @param {object} connector
 */
function applyDecklinkConsumerSettingsFromConnector(merged, prefix, connector) {
	const s = readDecklinkConsumerSettingsFromConnectorCaspar(connector?.caspar)
	merged[`${prefix}decklink_embedded_audio`] = s.embeddedAudio
	merged[`${prefix}decklink_channel_layout`] = s.channelLayout
	merged[`${prefix}decklink_latency`] = s.latency
	merged[`${prefix}decklink_buffer_depth`] = s.bufferDepth
	merged[`${prefix}decklink_color_space`] = s.colorSpace
	const outputMode = String(connector?.caspar?.decklinkOutputVideoMode || '').trim()
	if (outputMode) merged[`${prefix}decklink_output_video_mode`] = outputMode
}

/**
 * @param {{ embeddedAudio?: boolean, channelLayout?: string, latency?: string, bufferDepth?: number, colorSpace?: string }} settings
 * @returns {string}
 */
function buildDecklinkConsumerOptionsXml(settings = {}) {
	const s = {
		embeddedAudio:
			settings.embeddedAudio != null
				? parseDecklinkEmbeddedAudio(settings.embeddedAudio)
				: DEFAULT_DECKLINK_CONSUMER_SETTINGS.embeddedAudio,
		channelLayout: normalizeDecklinkChannelLayout(settings.channelLayout),
		latency: normalizeDecklinkLatency(settings.latency),
		bufferDepth: normalizeDecklinkBufferDepth(settings.bufferDepth),
		colorSpace: normalizeDecklinkColorSpace(settings.colorSpace),
	}
	const lines = [
		`\n                    <embedded-audio>${s.embeddedAudio ? 'true' : 'false'}</embedded-audio>`,
		`\n                    <channel-layout>${escapeXml(s.channelLayout)}</channel-layout>`,
		`\n                    <latency>${escapeXml(s.latency)}</latency>`,
		`\n                    <buffer-depth>${s.bufferDepth}</buffer-depth>`,
		`\n                    <color-space>${escapeXml(s.colorSpace)}</color-space>`,
	]
	return lines.join('')
}

/**
 * @param {{ srcX?: number, srcY?: number, destX?: number, destY?: number, width?: number, height?: number }|null|undefined} subregion
 * @returns {string}
 */
function buildDecklinkSubregionXml(subregion) {
	if (!subregion || typeof subregion !== 'object') return ''
	const width = Math.max(0, parseInt(String(subregion.width ?? 0), 10) || 0)
	const height = Math.max(0, parseInt(String(subregion.height ?? 0), 10) || 0)
	if (width <= 0 || height <= 0) return ''
	const srcX = Math.max(0, parseInt(String(subregion.srcX ?? 0), 10) || 0)
	const srcY = Math.max(0, parseInt(String(subregion.srcY ?? 0), 10) || 0)
	const destX = Math.max(0, parseInt(String(subregion.destX ?? 0), 10) || 0)
	const destY = Math.max(0, parseInt(String(subregion.destY ?? 0), 10) || 0)
	return `\n                    <subregion>
                        <src-x>${srcX}</src-x>
                        <src-y>${srcY}</src-y>
                        <dest-x>${destX}</dest-x>
                        <dest-y>${destY}</dest-y>
                        <width>${width}</width>
                        <height>${height}</height>
                    </subregion>`
}

/**
 * CasparCG DeckLink consumers for fill-only or fill+key on separate SDI outputs.
 * @param {{ fillDevice: number, keyDevice?: number, keyer?: string, videoMode?: string, consumerSettings?: object, passthroughSubregion?: object }} opts
 * @returns {string}
 */
function buildDecklinkKeyFillConsumersXml(opts) {
	const fillDevice = parseDecklinkDeviceIndex(opts?.fillDevice)
	if (fillDevice <= 0) return ''
	const keyDevice = parseDecklinkDeviceIndex(opts?.keyDevice)
	const videoModeRaw = String(opts?.videoMode || '').trim()
	const videoModeXml = videoModeRaw ? `\n                    <video-mode>${escapeXml(videoModeRaw)}</video-mode>` : ''
	const pixelFormatXml = decklinkPixelFormatXml(videoModeRaw)
	const consumerXml = buildDecklinkConsumerOptionsXml(opts?.consumerSettings || {})
	const subregionXml = buildDecklinkSubregionXml(opts?.passthroughSubregion)
	const keyer = escapeXml(resolveDecklinkConsumerKeyer(opts))
	if (keyDevice > 0 && keyDevice !== fillDevice) {
		return `
             <decklink>
               <device>${fillDevice}</device>${videoModeXml}${pixelFormatXml}${consumerXml}${subregionXml}
                 <key-device>${keyDevice}</key-device>
             <keyer>${keyer}</keyer>
	     </decklink>
		<decklink>
               <device>${keyDevice}</device>
             <key-only>true</key-only>
             </decklink>`
	}
	// Fill-only: explicit default — omitting <keyer> makes Caspar use external and fail init on many devices.
	return `\n                <decklink>
                    <device>${fillDevice}</device>${videoModeXml}${pixelFormatXml}
                    <keyer>${keyer}</keyer>${consumerXml}${subregionXml}
                </decklink>`
}

module.exports = {
	parseDecklinkDeviceIndex,
	normalizeDecklinkKeyer,
	resolveDecklinkConsumerKeyer,
	decklinkPixelFormatXml,
	FILL_ONLY_KEYER,
	DEFAULT_DECKLINK_CONSUMER_SETTINGS,
	DECKLINK_LATENCY_VALUES,
	DECKLINK_COLOR_SPACE_VALUES,
	parseDecklinkEmbeddedAudio,
	normalizeDecklinkLatency,
	normalizeDecklinkColorSpace,
	normalizeDecklinkBufferDepth,
	normalizeDecklinkChannelLayout,
	readDecklinkConsumerSettings,
	readDecklinkConsumerSettingsFromConnectorCaspar,
	applyDecklinkConsumerSettingsFromConnector,
	buildDecklinkConsumerOptionsXml,
	buildDecklinkSubregionXml,
	readDecklinkKeyFillSettings,
	readDecklinkKeyFillFromConnectorCaspar,
	writeDecklinkKeyFillToCasparServer,
	buildDecklinkKeyFillConsumersXml,
	KEYER_VALUES,
}
