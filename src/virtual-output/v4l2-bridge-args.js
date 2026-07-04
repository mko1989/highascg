'use strict'

const { buildMjpegPixelFormatFilter } = require('../preview/compose-preview-ffmpeg-args')

const V4L2_BRIDGE_FPS_MAX = 60
const V4L2_BRIDGE_FPS_MIN = 1

/**
 * @param {unknown} fps
 * @param {number} [fallback]
 * @returns {number}
 */
function clampV4l2BridgeFps(fps, fallback = 50) {
	if (String(fps ?? '').trim().toLowerCase() === 'native') return fallback
	const n = parseInt(String(fps ?? ''), 10)
	if (!Number.isFinite(n)) return fallback
	return Math.max(V4L2_BRIDGE_FPS_MIN, Math.min(V4L2_BRIDGE_FPS_MAX, n))
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
	const s = String(scale ?? 'full')
		.trim()
		.toLowerCase()
	if (s === '75' || s === '0.75' || s === '75%') return '75'
	if (s === 'half' || s === '0.5' || s === '50%') return 'half'
	return 'full'
}

/**
 * @param {'half' | '75' | 'full'} resolutionScale
 * @returns {string | null}
 */
function buildScaleFilter(resolutionScale) {
	const s = normalizeResolutionScale(resolutionScale)
	if (s === '75') return 'scale=trunc(iw*3/4/2)*2:trunc(ih*3/4/2)*2'
	if (s === 'half') return 'scale=iw/2:ih/2'
	return null
}

/**
 * Resolve output fps from config (defaults to project/machine 50).
 * @param {object} config
 * @returns {number}
 */
function resolveV4l2BridgeFps(config) {
	const vc = config?.virtualCamera || {}
	const machineFps = parseInt(String(config?.machineProfile?.defaultProjectFps ?? ''), 10)
	const fallback = Number.isFinite(machineFps) && machineFps > 0 ? machineFps : 50
	return clampV4l2BridgeFps(vc.fps, fallback)
}

/**
 * Caspar ADD FILE → image2 overwriting JPEG (same as compose preview, full res by default).
 * @param {object} config
 * @returns {string}
 */
function buildV4l2BridgeCasparFfmpegArgs(config) {
	const vc = config?.virtualCamera || {}
	const fps = resolveV4l2BridgeFps(config)
	const parts = []
	const scale = buildScaleFilter(vc.resolutionScale ?? 'full')
	if (scale) parts.push(scale)
	parts.push(buildMjpegPixelFormatFilter(), `fps=${fps}`)
	const q = clampJpegQuality(vc.jpegQuality, 10)
	return `-filter:v ${parts.join(',')} -codec:v mjpeg -q:v:v ${q} -format image2 -update 1`
}

/**
 * @param {object} config
 * @param {number} channel
 * @returns {string}
 */
function getV4l2BridgeJpgBasename(config, channel) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	const prefix = String(config?.virtualCamera?.basenamePrefix || 'highascg_vcam').trim() || 'highascg_vcam'
	return `${prefix}/ch${ch}.jpg`
}

/**
 * @param {object} config
 * @param {number} channel
 * @returns {{ amcpPath: string, params: string }}
 */
function buildV4l2BridgeCasparAddParams(config, channel) {
	const amcpPath = `media/${getV4l2BridgeJpgBasename(config, channel)}`
	const args = buildV4l2BridgeCasparFfmpegArgs(config)
	return { amcpPath, params: `${amcpPath} ${args}` }
}

module.exports = {
	V4L2_BRIDGE_FPS_MAX,
	clampV4l2BridgeFps,
	clampJpegQuality,
	resolveV4l2BridgeFps,
	buildV4l2BridgeCasparFfmpegArgs,
	buildV4l2BridgeCasparAddParams,
	getV4l2BridgeJpgBasename,
	normalizeResolutionScale,
}
