'use strict'

const { joinRtmpServerUrlAndStreamKey } = require('../config/rtmp-output')

/**
 * FFmpeg args for Caspar `ADD ch-N STREAM <rtmp_url> <args>` — output URL is first token.
 * Caspar’s ffmpeg map uses **`-name:stream`**-style options; **`-f`** is not forwarded — use **`-format`** for mux
 * (same lesson as `caspar-ffmpeg-setup.js` for MPEG-TS). Comma-joined **`-filter:a`** tokens have caused
 * `400 COMMAND_UNKNOWN_DATA` on some builds, so we chain **two** **`-filter:a`** passes.
 */
function buildStreamingRtmpFfmpegArgs(quality, opts = {}) {
	const q = String(quality || 'medium').toLowerCase()
	let preset = 'veryfast'
	let vbr = 4500
	if (q === 'high') {
		preset = 'medium'
		vbr = 8000
	} else if (q === 'low') {
		preset = 'ultrafast'
		vbr = 2500
	}
	const codec = String(opts.videoCodec || 'h264').toLowerCase() === 'hevc' ? 'libx265' : 'libx264'
	const customPreset = String(opts.encoderPreset || '').trim().toLowerCase()
	if (customPreset) preset = customPreset
	const customBitrate = parseInt(String(opts.videoBitrateKbps ?? ''), 10)
	if (Number.isFinite(customBitrate) && customBitrate >= 200) vbr = customBitrate
	const audioCodec = String(opts.audioCodec || 'aac').toLowerCase()
	const abrRaw = parseInt(String(opts.audioBitrateKbps ?? ''), 10)
	const abr = Number.isFinite(abrRaw) ? Math.max(32, abrRaw) : 128
	let audioPart = `-filter:a aresample=48000 -filter:a aformat=channel_layouts=stereo -codec:a aac -b:a ${abr}k`
	if (audioCodec === 'copy') audioPart = '-codec:a copy'
	if (audioCodec === 'none') audioPart = '-an'
	return [
		`-format mpegts -i -`,
		`-c:v ${codec} -preset:v ${preset} -b:v ${vbr}k -tune:v zerolatency -filter:v format=yuv420p`,
		audioPart,
		`-format flv`,
	].join(' ')
}

/**
 * @param {string} serverUrl
 * @param {string} streamKey
 * @param {'low'|'medium'|'high'} quality
 */
function buildStreamingRtmpAddParams(serverUrl, streamKey, quality, opts = {}) {
	const url = joinRtmpServerUrlAndStreamKey(serverUrl, streamKey)
	if (!url) return null
	return { url, args: buildStreamingRtmpFfmpegArgs(quality, opts) }
}

module.exports = { buildStreamingRtmpFfmpegArgs, buildStreamingRtmpAddParams }
