'use strict'

/**
 * WO-319 — AMCP arguments for the GUI live-stream consumer (one composed channel, hardware
 * encoded once, decoded once in the browser by WebCodecs).
 *
 * VERIFIED LIVE on this box 2026-07-21 against Caspar 2.6.0 253c16c Dev, on the on-air 2160p50
 * operator channel, added and removed with no disturbance:
 *   - `h264_nvenc` IS available inside Caspar's own ffmpeg consumer — no external transcode hop.
 *   - Output was valid MPEG-TS: h264 Main 3840x2160 @50 (yuv420p) + AAC-LC stereo.
 *   - `nvidia-smi encoder.stats` showed 1 session @49fps while attached, 0 after REMOVE, so the
 *     encode runs on the dedicated NVENC block and is released cleanly.
 *   - Keyframes landed exactly 1.000s apart, i.e. `-g:v` is honoured — that bounds how long a
 *     joining browser waits for its first decodable frame.
 *
 * THREE TRAPS, each of which cost a failed attempt. They are the reason this builder exists
 * instead of a string literal at the call site:
 *
 * 1. THE AUDIO ARGS ARE MANDATORY. Left to itself the consumer initialises an mp2 audio encoder,
 *    which cannot accept this box's 16-channel bus:
 *      "Specified channel layout 'hexadecagonal' is not supported by the mp2 encoder"
 *    That kills the WHOLE consumer — video included — and Caspar then retries every 2s forever,
 *    filling the log with reconnect spam. A silent video-only stream is NOT an option here.
 * 2. `-an` IS SILENTLY IGNORED. It is not a `-name:stream` option, so it never reaches ffmpeg and
 *    the mp2 path still initialises. You must actively downmix instead of trying to disable audio.
 * 3. THE OPTION GRAMMAR IS `-name:stream`. Caspar's ffmpeg_consumer maps `-name value` into an
 *    options map; plain `-f`, `-vf`, `-g`, `-ac` are dropped as "Unused option". In particular the
 *    muxer needs `-format mpegts`, NOT `-f mpegts`, or ffmpeg errors "Unable to choose an output
 *    format". This mirrors what src/streaming/caspar-ffmpeg-setup.js already documents for the
 *    RTMP path; the same rules apply here.
 */

/** Low-latency NVENC preset: p1 = fastest, ull = ultra-low-latency tuning. */
const DEFAULT_PRESET = 'p1'
const DEFAULT_TUNE = 'ull'
const DEFAULT_BITRATE_KBPS = 8000
const DEFAULT_FPS = 50
/** Keyframe every ~0.5s: bounds a joining/recovering client's wait to <= 1 GOP. Shorter = snappier
 * recovery from a WiFi hiccup (stale-drop resyncs to the next keyframe); the near-static operator
 * screen makes the extra keyframes almost free on bandwidth. */
const DEFAULT_GOP = 25

const MIN_BITRATE_KBPS = 500
const MAX_BITRATE_KBPS = 60000

/**
 * @param {unknown} v
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 */
function clampInt(v, min, max, fallback) {
	const n = parseInt(String(v ?? ''), 10)
	if (!Number.isFinite(n)) return fallback
	return Math.max(min, Math.min(max, n))
}

/**
 * Strict range check for identifiers. Deliberately NOT clampInt: clamping an out-of-range
 * CHANNEL would silently retarget the consumer at a valid-but-wrong channel (channel 0 becoming
 * channel 1 would attach the GUI stream to a program bus). Tuning knobs may be clamped; addresses
 * may not.
 * @param {unknown} v
 * @param {number} min
 * @param {number} max
 * @returns {number|null} null when absent or out of range
 */
function strictInt(v, min, max) {
	if (v === null || v === undefined || v === '') return null
	const n = Number(v)
	if (!Number.isInteger(n) || n < min || n > max) return null
	return n
}

/**
 * Loopback URI for the GUI stream. Caspar SENDS to `port`; the local reader binds it, so Caspar
 * must bind a DIFFERENT local port or the two collide (same rule as the RTMP preview path).
 * @param {number} port
 * @returns {string}
 */
function guiStreamUdpUri(port) {
	const p = clampInt(port, 1024, 65535, 52300)
	return `udp://127.0.0.1:${p}?localport=${p + 1}`
}

/**
 * Build the ffmpeg argument string for `ADD <ch>-<idx> STREAM <uri> <args>`.
 *
 * @param {{ bitrateKbps?: number, fps?: number, gop?: number, preset?: string, tune?: string,
 *   scale?: string|null }} [opts] `scale` is an optional ffmpeg scale expression (e.g. '1920:1080')
 *   for downscaling the composed channel before encode.
 * @returns {string}
 */
function buildGuiStreamNvencArgs(opts = {}) {
	const bitrate = clampInt(opts.bitrateKbps, MIN_BITRATE_KBPS, MAX_BITRATE_KBPS, DEFAULT_BITRATE_KBPS)
	const fps = clampInt(opts.fps, 1, 120, DEFAULT_FPS)
	const gop = clampInt(opts.gop, 1, 600, DEFAULT_GOP)
	const preset = String(opts.preset || DEFAULT_PRESET).trim() || DEFAULT_PRESET
	const tune = String(opts.tune || DEFAULT_TUNE).trim() || DEFAULT_TUNE

	// yuv420p is required for browser decode; WebCodecs/H.264 hardware paths reject 4:4:4.
	const scale = String(opts.scale || '').trim()
	const filterV = scale ? `scale=${scale},format=yuv420p` : 'format=yuv420p'

	const parts = [
		`-filter:v ${filterV}`,
		`-codec:v h264_nvenc`,
		`-preset:v ${preset}`,
		`-tune:v ${tune}`,
		`-b:v ${bitrate}k`,
		`-g:v ${gop}`,
		// TRAP 1 + 2: mandatory. Without this the mp2 default fails on the 16-channel bus and
		// takes the entire consumer down; `-an` would be ignored, so downmix instead.
		`-filter:a aformat=channel_layouts=stereo,aresample=48000`,
		`-codec:a aac`,
		`-b:a 128k`,
		// TRAP 3: `-format`, never `-f`.
		`-format mpegts`,
	]
	return parts.join(' ')
}

/**
 * Full `ADD` command for the GUI stream consumer.
 * @param {{ channel: number, consumerIndex: number, port: number,
 *   args?: Parameters<typeof buildGuiStreamNvencArgs>[0] }} spec
 * @returns {string}
 */
function buildGuiStreamAddCommand(spec) {
	const ch = strictInt(spec?.channel, 1, 256)
	const idx = strictInt(spec?.consumerIndex, 1, 10000)
	if (ch === null || idx === null) {
		throw new Error('GUI stream consumer requires a valid channel and consumer index')
	}
	const uri = guiStreamUdpUri(spec?.port)
	return `ADD ${ch}-${idx} STREAM ${uri} ${buildGuiStreamNvencArgs(spec?.args)}`
}

/**
 * @param {{ channel: number, consumerIndex: number }} spec
 * @returns {string}
 */
function buildGuiStreamRemoveCommand(spec) {
	const ch = strictInt(spec?.channel, 1, 256)
	const idx = strictInt(spec?.consumerIndex, 1, 10000)
	if (ch === null || idx === null) {
		throw new Error('GUI stream consumer requires a valid channel and consumer index')
	}
	return `REMOVE ${ch}-${idx}`
}

module.exports = {
	DEFAULT_PRESET,
	DEFAULT_TUNE,
	DEFAULT_BITRATE_KBPS,
	DEFAULT_FPS,
	DEFAULT_GOP,
	guiStreamUdpUri,
	buildGuiStreamNvencArgs,
	buildGuiStreamAddCommand,
	buildGuiStreamRemoveCommand,
}
