'use strict'

const { buildMjpegPixelFormatFilter } = require('../preview/compose-preview-ffmpeg-args')
const { casparUdpStreamUri } = require('../streaming/caspar-ffmpeg-setup')

const V4L2_BRIDGE_FPS_MAX = 60
const V4L2_BRIDGE_FPS_MIN = 1
const V4L2_BRIDGE_MODES = Object.freeze(['jpeg', 'stream'])
const V4L2_BRIDGE_STREAM_PORT_DEFAULT = 5555

/**
 * WO-399 (owner): 'stream' is the DEFAULT — "package the virtual cam output to a simple
 * lowest performance hungry stream and an ffmpeg subprocess that receives the stream and
 * pipes it into v4l2". The jpg flipbook (WO-137) survives only as an explicit legacy opt-in;
 * it re-decoded one JPEG 50×/s for ~39 % of a core.
 * @param {unknown} mode
 * @returns {'jpeg' | 'stream'}
 */
function normalizeV4l2BridgeMode(mode) {
	const m = String(mode ?? 'stream')
		.trim()
		.toLowerCase()
	return m === 'jpeg' ? 'jpeg' : 'stream'
}

/**
 * @param {object} config
 * @returns {'jpeg' | 'stream'}
 */
function resolveV4l2BridgeMode(config) {
	return normalizeV4l2BridgeMode(config?.virtualCamera?.mode)
}

/**
 * @param {unknown} port
 * @returns {number}
 */
function clampV4l2BridgeStreamPort(port) {
	const n = parseInt(String(port ?? ''), 10)
	if (!Number.isFinite(n) || n < 1024 || n > 65535) return V4L2_BRIDGE_STREAM_PORT_DEFAULT
	return n
}

/**
 * @param {object} config
 * @returns {number}
 */
function resolveV4l2BridgeStreamPort(config) {
	return clampV4l2BridgeStreamPort(config?.virtualCamera?.streamPort)
}

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

/**
 * Caspar ADD STREAM → mjpeg over NUT on loopback UDP (WO-145 spike, 2026-07-08):
 * - NUT, not mpegts: mpegts muxes mjpeg as a private data stream the relay cannot demux
 *   ("codec mjpeg is muxed as a private data stream and may not be recognized upon reading").
 * - `?localport=` keeps Caspar's send socket off the relay's listen port (see caspar-ffmpeg-setup.js).
 * - Audio stream is mandatory in the mux: the default mp2 encoder rejects Caspar's 16-ch
 *   'hexadecagonal' layout and kills the consumer — downmix to stereo aac. The relay drops it (-an);
 *   the virtual mic keeps using the snd-aloop path (consumer 711).
 * - Caspar's ffmpeg consumer only forwards `-name:stream` options; `-vcodec` / `-preset` are dropped.
 * @param {object} config
 * @returns {{ streamUri: string, port: number, params: string }}
 */
function buildV4l2BridgeCasparStreamAddParams(config) {
	const vc = config?.virtualCamera || {}
	const port = resolveV4l2BridgeStreamPort(config)
	const streamUri = casparUdpStreamUri(port)
	const fps = resolveV4l2BridgeFps(config)
	const parts = []
	const scale = buildScaleFilter(vc.resolutionScale ?? 'full')
	if (scale) parts.push(scale)
	parts.push(buildMjpegPixelFormatFilter(), `fps=${fps}`)
	const q = clampJpegQuality(vc.jpegQuality, 10)
	const params =
		`${streamUri} -format nut -filter:v ${parts.join(',')} -codec:v mjpeg -q:v:v ${q}` +
		' -filter:a aformat=channel_layouts=stereo,aresample=48000 -codec:a aac -b:a 128k'
	return { streamUri, port, params }
}

module.exports = {
	V4L2_BRIDGE_FPS_MAX,
	V4L2_BRIDGE_MODES,
	V4L2_BRIDGE_STREAM_PORT_DEFAULT,
	clampV4l2BridgeFps,
	clampJpegQuality,
	resolveV4l2BridgeFps,
	normalizeV4l2BridgeMode,
	resolveV4l2BridgeMode,
	clampV4l2BridgeStreamPort,
	resolveV4l2BridgeStreamPort,
	buildV4l2BridgeCasparFfmpegArgs,
	buildV4l2BridgeCasparAddParams,
	buildV4l2BridgeCasparStreamAddParams,
	getV4l2BridgeJpgBasename,
	normalizeResolutionScale,
}
