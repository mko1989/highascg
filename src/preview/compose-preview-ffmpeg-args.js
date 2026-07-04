'use strict'

const COMPOSE_PREVIEW_FPS_MAX = 30
const COMPOSE_PREVIEW_FPS_MIN = 1

/**
 * @param {unknown} fps
 * @param {number} [fallback]
 * @returns {number}
 */
function clampComposePreviewFps(fps, fallback = 2) {
	const n = parseInt(String(fps ?? ''), 10)
	if (!Number.isFinite(n)) return fallback
	return Math.max(COMPOSE_PREVIEW_FPS_MIN, Math.min(COMPOSE_PREVIEW_FPS_MAX, n))
}

/**
 * @param {unknown} q
 * @param {number} [fallback]
 * @returns {number}
 */
function clampJpegQuality(q, fallback = 10) {
	const n = parseInt(String(q ?? ''), 10)
	if (!Number.isFinite(n)) return fallback
	return Math.max(2, Math.min(31, n))
}

/**
 * @param {unknown} scale
 * @returns {'half' | '75' | 'full'}
 */
function normalizeResolutionScale(scale) {
	const s = String(scale || 'half')
		.trim()
		.toLowerCase()
	if (s === '75' || s === '0.75' || s === '75%') return '75'
	if (s === 'full' || s === '1' || s === '100' || s === '100%') return 'full'
	return 'half'
}

/**
 * @param {'half' | '75' | 'full'} resolutionScale
 * @returns {string | null}
 */
function buildScaleFilter(resolutionScale) {
	const s = normalizeResolutionScale(resolutionScale)
	if (s === '75') return 'scale=trunc(iw*3/4/2)*2:trunc(ih*3/4/2)*2'
	if (s === 'full') return null
	return 'scale=iw/2:ih/2'
}

/**
 * Square thumb for Companion Stream Deck buttons (letterboxed, aspect preserved).
 * Caspar rejects pad offsets like (ow-iw)/2; -1:-1 centers in this ffmpeg build.
 * @param {number} size
 */
function buildCompanionThumbScaleFilter(size) {
	const s = Math.max(32, Math.min(512, parseInt(String(size), 10) || 144))
	return `scale=${s}:${s}:force_original_aspect_ratio=decrease,pad=${s}:${s}:-1:-1`
}

/**
 * MJPEG FILE consumer pixel format — mjpeg requires full-range YUV (yuvj420p).
 * Limited-range yuv420p fails avcodec_open2 on current Caspar/ffmpeg (strict_std_compliance).
 * @returns {string}
 */
function buildMjpegPixelFormatFilter() {
	return 'scale=in_range=limited:out_range=full,format=yuvj420p'
}

/**
 * Main compose preview filter chain — always channel-relative scale (WO-110: Companion square is derived server-side).
 * @param {{ fps?: number, resolutionScale?: string }} opts
 * @returns {string}
 */
function buildComposeFfmpegFilterChain(opts = {}) {
	const fps = clampComposePreviewFps(opts.fps, 2)
	const parts = []
	const scale = buildScaleFilter(opts.resolutionScale ?? 'half')
	if (scale) parts.push(scale)
	parts.push(buildMjpegPixelFormatFilter(), `fps=${fps}`)
	return parts.join(',')
}

/**
 * Caspar ADD FILE → image2 (direct JPG on disk).
 * @param {object} [composePreview]
 * @returns {string}
 */
function buildComposeFfmpegConsumerArgs(composePreview = {}) {
	const filter = buildComposeFfmpegFilterChain({
		fps: composePreview.fps,
		resolutionScale: composePreview.resolutionScale,
	})
	const q = clampJpegQuality(composePreview.jpegQuality, 10)
	return `-filter:v ${filter} -codec:v mjpeg -q:v:v ${q} -format image2 -update 1`
}

/**
 * @param {object} config
 * @param {number} channel
 * @returns {string}
 */
function getComposePreviewJpgBasename(config, channel) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	const prefix = String(config?.composePreview?.basenamePrefix || 'highascg_preview').trim() || 'highascg_preview'
	return `${prefix}/ch${ch}.jpg`
}

/**
 * Path for AMCP ADD FILE — Caspar passes this verbatim to ffmpeg (must include media/ prefix).
 * @param {object} config
 * @param {number} channel
 * @returns {string}
 */
function getComposePreviewJpgAmcpPath(config, channel) {
	return `media/${getComposePreviewJpgBasename(config, channel)}`
}

module.exports = {
	COMPOSE_PREVIEW_FPS_MAX,
	COMPOSE_PREVIEW_FPS_MIN,
	clampComposePreviewFps,
	clampJpegQuality,
	normalizeResolutionScale,
	buildScaleFilter,
	buildCompanionThumbScaleFilter,
	buildComposeFfmpegFilterChain,
	buildComposeFfmpegConsumerArgs,
	buildMjpegPixelFormatFilter,
	getComposePreviewJpgBasename,
	getComposePreviewJpgAmcpPath,
}
