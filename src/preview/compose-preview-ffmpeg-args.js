'use strict'

const COMPOSE_PREVIEW_FPS_MAX = 30
const COMPOSE_PREVIEW_FPS_MIN = 1
/** UDP destination for compose preview MPEG-TS (HighAsCG ffmpeg receiver listens on same port). */
const COMPOSE_PREVIEW_UDP_PORT_BASE = 52100

/**
 * @param {number} channel
 * @returns {number}
 */
function composePreviewUdpPort(channel) {
	return COMPOSE_PREVIEW_UDP_PORT_BASE + parseInt(String(channel), 10)
}

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
 * @param {{ fps?: number, resolutionScale?: string }} opts
 * @returns {string}
 */
function buildComposeFfmpegFilterChain(opts = {}) {
	const parts = []
	const scale = buildScaleFilter(opts.resolutionScale ?? 'half')
	if (scale) parts.push(scale)
	parts.push('format=yuv420p', `fps=${clampComposePreviewFps(opts.fps, 2)}`)
	return parts.join(',')
}

/**
 * Caspar FILE→image2 is unreliable on many builds; kept for optional static casparcg.config embed.
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
 * @param {number} channel
 * @returns {string}
 */
function composePreviewStreamUri(channel) {
	const ch = parseInt(String(channel), 10)
	const port = COMPOSE_PREVIEW_UDP_PORT_BASE + ch
	const localport = port + 10000
	return `udp://127.0.0.1:${port}?localport=${localport}`
}

/**
 * Video-only MPEG-TS STREAM args for Caspar ADD STREAM (receiver writes JPEG).
 * Must include stereo audio downmix — `-an` is not forwarded and breaks `-format mpegts` on this build.
 * @param {object} [composePreview]
 * @returns {string}
 */
function buildComposeStreamConsumerArgs(composePreview = {}) {
	const fps = clampComposePreviewFps(composePreview.fps, 2)
	const scale = buildScaleFilter(composePreview.resolutionScale ?? 'half')
	let filterV = `format=yuv420p,fps=${fps}`
	if (scale === 'scale=iw/2:ih/2') {
		filterV = `scale=w=iw/2:h=ih/2,format=yuv420p,fps=${fps}`
	} else if (scale) {
		filterV = `${scale},format=yuv420p,fps=${fps}`
	}
	const keyint = fps <= 5 ? 1 : Math.max(2 * fps, 8)
	const minKeyint = fps <= 5 ? 1 : fps
	const x264opts = `min-keyint=${minKeyint}:scenecut=0:repeat-headers=1`
	return `-filter:v ${filterV} -codec:v libx264 -preset:v ultrafast -tune:v zerolatency -g:v ${keyint} -x264-params:v ${x264opts} -filter:a aformat=channel_layouts=stereo,aresample=48000 -codec:a aac -b:a 64k -format mpegts`
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

module.exports = {
	COMPOSE_PREVIEW_FPS_MAX,
	COMPOSE_PREVIEW_FPS_MIN,
	COMPOSE_PREVIEW_UDP_PORT_BASE,
	clampComposePreviewFps,
	clampJpegQuality,
	normalizeResolutionScale,
	buildScaleFilter,
	buildComposeFfmpegFilterChain,
	buildComposeFfmpegConsumerArgs,
	buildComposeStreamConsumerArgs,
	composePreviewStreamUri,
	composePreviewUdpPort,
	getComposePreviewJpgBasename,
}
