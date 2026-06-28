'use strict'

const { getChannelMap } = require('../config/routing')
const {
	clampComposePreviewFps,
	clampJpegQuality,
	normalizeResolutionScale,
} = require('./compose-preview-ffmpeg-args')

/**
 * @param {object} [config]
 * @returns {'canvas' | 'caspar_image' | 'ffmpeg_jpeg'}
 */
function resolveComposePreviewMode(config) {
	const env = process.env.HIGHASCG_COMPOSE_PREVIEW_MODE
	if (env === 'ffmpeg_jpeg' || env === 'caspar_image' || env === 'canvas') return env
	const mode = config?.composePreview?.mode
	if (mode === 'ffmpeg_jpeg' || mode === 'caspar_image') return mode
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
function isCasparImageComposePreview(config) {
	return resolveComposePreviewMode(config) === 'caspar_image'
}

/**
 * @param {object} [config]
 * @returns {boolean}
 */
function isSnapshotComposePreview(config) {
	const mode = resolveComposePreviewMode(config)
	return mode === 'ffmpeg_jpeg' || mode === 'caspar_image'
}

/**
 * @param {object} [composePreview]
 * @param {object} [defaults]
 * @returns {object}
 */
function normalizeComposePreviewSettings(composePreview = {}, defaults = {}) {
	const prev = { ...defaults, ...composePreview }
	const tickIntervalMs = parseInt(String(prev.tickIntervalMs ?? ''), 10)
	return {
		...prev,
		mode:
			prev.mode === 'ffmpeg_jpeg' || prev.mode === 'caspar_image' ? prev.mode : 'canvas',
		fps: clampComposePreviewFps(prev.fps, defaults.fps ?? 2),
		resolutionScale: normalizeResolutionScale(prev.resolutionScale),
		jpegQuality: clampJpegQuality(prev.jpegQuality, defaults.jpegQuality ?? 10),
		tickIntervalMs:
			Number.isFinite(tickIntervalMs) && tickIntervalMs >= 40 && tickIntervalMs <= 1000
				? Math.round(tickIntervalMs / 25) * 25 || 40
				: prev.tickIntervalMs ?? defaults.tickIntervalMs ?? 40,
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
 * Channels that may appear in compose preview cells (PRV + PGM per screen).
 * @param {object} config
 * @returns {number[]}
 */
function resolveMonitoredChannels(config) {
	const cp = config?.composePreview || {}
	if (cp.channels === 'compose_visible' || cp.channels == null) {
		try {
			const map = getChannelMap(config)
			const ch = new Set()
			const n = Math.max(1, map?.screenCount || 1)
			for (let i = 0; i < n; i++) {
				const prv = map?.previewCh?.(i + 1) ?? map?.previewChannels?.[i]
				const pgm = map?.programCh?.(i + 1) ?? map?.programChannels?.[i]
				if (prv != null && prv > 0) ch.add(prv)
				if (pgm != null && pgm > 0) ch.add(pgm)
			}
			if (ch.size === 0) ch.add(1)
			return [...ch].sort((a, b) => a - b)
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
	isCasparImageComposePreview,
	isSnapshotComposePreview,
	normalizeComposePreviewSettings,
	resolveMonitoredChannels,
	isMonitoredComposeChannel,
}
