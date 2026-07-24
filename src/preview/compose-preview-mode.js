'use strict'

const { getChannelMap } = require('../config/routing')
const {
	clampComposePreviewFps,
	clampJpegQuality,
	normalizeResolutionScale,
} = require('./compose-preview-ffmpeg-args')

/**
 * @param {object} [config]
 * @returns {'canvas' | 'ffmpeg_jpeg'}
 */
function resolveComposePreviewMode(config) {
	const env = process.env.HIGHASCG_COMPOSE_PREVIEW_MODE
	if (env === 'ffmpeg_jpeg' || env === 'canvas') return env
	const mode = config?.composePreview?.mode
	if (mode === 'ffmpeg_jpeg' || mode === 'canvas') return mode
	return 'canvas'
}

/**
 * @param {object} [config]
 * @returns {boolean}
 */
function isFfmpegJpegComposePreview(config) {
	return resolveComposePreviewMode(config) === 'ffmpeg_jpeg'
}

/**
 * @param {object} [config]
 * @returns {boolean}
 */
function isSnapshotComposePreview(config) {
	return isFfmpegJpegComposePreview(config)
}

/**
 * @param {object} [composePreview]
 * @param {object} [defaults]
 * @returns {object}
 */
function normalizeComposePreviewSettings(composePreview = {}, defaults = {}) {
	const prev = { ...defaults, ...composePreview }
	return {
		...prev,
		// 'stream' (WO-319 Live preview, now a Preview-source choice) persists as-is; the server treats
		// it as canvas base (isFfmpegJpegComposePreview → false, no JPEG consumers) while the client
		// overlays the NVENC gui-stream. Any other/legacy value (e.g. caspar_image) migrates to canvas.
		mode: prev.mode === 'ffmpeg_jpeg' ? 'ffmpeg_jpeg' : prev.mode === 'stream' ? 'stream' : 'canvas',
		fps: clampComposePreviewFps(prev.fps, defaults.fps ?? 25),
		resolutionScale: normalizeResolutionScale(prev.resolutionScale),
		jpegQuality: clampJpegQuality(prev.jpegQuality, defaults.jpegQuality ?? 10),
		embedConsumersInCasparConfig: prev.embedConsumersInCasparConfig !== false,
		pauseConsumerWhenIdle: prev.pauseConsumerWhenIdle === true,
		companionThumbEnabled: prev.companionThumbEnabled === true,
		companionThumbSize: (() => {
			const n = parseInt(String(prev.companionThumbSize ?? 144), 10)
			return Number.isFinite(n) ? Math.max(32, Math.min(512, n)) : 144
		})(),
		companionThumbIntervalMs: (() => {
			const n = parseInt(String(prev.companionThumbIntervalMs ?? 1000), 10)
			return Number.isFinite(n) ? Math.max(250, Math.min(10000, n)) : 1000
		})(),
	}
}

/**
 * All Caspar channels that should receive compose-preview JPEG FILE consumers.
 * @param {ReturnType<typeof getChannelMap>} map
 * @returns {number[]}
 */
function collectComposePreviewChannelsFromMap(map) {
	const ch = new Set()
	const push = (n) => {
		const v = parseInt(String(n), 10)
		if (Number.isFinite(v) && v > 0) ch.add(v)
	}
	const screenCount = Math.max(1, map?.screenCount || 1)
	for (let i = 0; i < screenCount; i++) {
		const prv = map?.previewCh?.(i + 1) ?? map?.previewChannels?.[i]
		const pgm = map?.programCh?.(i + 1) ?? map?.programChannels?.[i]
		if (prv != null && prv > 0) push(prv)
		if (pgm != null && pgm > 0) push(pgm)
	}
	for (const c of map?.decklinkInputChannels || []) push(c)
	for (const c of map?.v4l2InputChannels || []) push(c)
	for (const entry of map?.hostLiveChannels || []) push(entry?.channel)
	for (const entry of map?.inputChannels || []) push(entry?.channel)
	if (ch.size === 0) ch.add(1)
	return [...ch].sort((a, b) => a - b)
}

/**
 * Channels that may appear in compose preview cells (PRV + PGM per screen, plus live input/host channels).
 * @param {object} config
 * @returns {number[]}
 */
function resolveMonitoredChannels(config) {
	const cp = config?.composePreview || {}
	if (cp.channels === 'compose_visible' || cp.channels == null) {
		try {
			return collectComposePreviewChannelsFromMap(getChannelMap(config))
		} catch {
			return [1]
		}
	}
	if (Array.isArray(cp.channels)) {
		return cp.channels.map((c) => parseInt(String(c), 10)).filter((c) => Number.isFinite(c) && c > 0)
	}
	return [1]
}

/**
 * @param {object} config
 * @param {number} channel
 * @returns {boolean}
 */
function isMonitoredComposeChannel(config, channel) {
	const ch = parseInt(String(channel), 10)
	if (!Number.isFinite(ch) || ch < 1) return false
	return resolveMonitoredChannels(config).includes(ch)
}

module.exports = {
	resolveComposePreviewMode,
	isFfmpegJpegComposePreview,
	isSnapshotComposePreview,
	normalizeComposePreviewSettings,
	collectComposePreviewChannelsFromMap,
	resolveMonitoredChannels,
	isMonitoredComposeChannel,
}
