'use strict'

const { joinRtmpServerUrlAndStreamKey } = require('../config/rtmp-url')

/**
 * WO-172 T172.5: layout-aware audio downmix filter chain, shared by RTMP (this file) and record
 * (`src/api/routes-streaming-channel-shared.js`) ffmpeg arg builders.
 *
 * Stereo program buses (the overwhelming common case): identical two-pass filter chain as before this
 * WO — byte-for-byte — so existing stereo streams/records are unaffected (WO-172 smoke asserts this).
 *
 * Discrete multi-channel program buses (e.g. this rig's `discrete-8ch` custom layout — linear pairs
 * c0..c7, NOT ffmpeg/Caspar's stock 7.1 `8ch` surround order — see `src/config/audio-channel-layouts.js`
 * `DISCRETE_8CH_LAYOUT_ID`) need an explicit `pan=` picking the c0/c1 pair (the "PGM 1+2" stereo pair —
 * mirrors `ROUTE_OUTPUT_CHANNELS['1+2']` in `client/lib/audio-routes.js`) instead of a blind
 * `channel_layouts=stereo` remix, which on FFmpeg's default downmixer blends/attenuates the wrong
 * channels for a linear-pair bus (this is the "audio is buggy" complaint for non-stereo program buses).
 * @param {string} [programLayout] - 'stereo' | '4ch' | '8ch' | '16ch' (i.e. `screen_N_audio_layout` id)
 * @returns {{ filterA: string[], ac: number | null }}
 */
function buildAudioDownmixFilterChain(programLayout) {
	const layout = String(programLayout || 'stereo').toLowerCase()
	const channels = layout === '16ch' ? 16 : layout === '8ch' ? 8 : layout === '4ch' ? 4 : 2
	if (channels <= 2) {
		return { filterA: ['aresample=48000', 'aformat=channel_layouts=stereo'], ac: null }
	}
	return { filterA: ['aresample=48000', 'pan=stereo|c0=c0|c1=c1'], ac: 2 }
}

/**
 * FFmpeg args for Caspar `ADD ch-N STREAM <rtmp_url> <args>` — output URL is first token.
 * Caspar’s ffmpeg map uses **`-name:stream`**-style options; **`-f`** / **`-c:v`** are not forwarded —
 * use **`-format`** and **`-codec:v`** (see `caspar-ffmpeg-setup.js`). Comma-joined **`-filter:a`** tokens
 * have caused `400 COMMAND_UNKNOWN_DATA` on some builds, so we chain two **`-filter:a`** passes.
 *
 * YouTube RTMP requires H.264 in FLV with regular keyframes — always libx264 here (never HEVC).
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
	const customPreset = String(opts.encoderPreset || '').trim().toLowerCase()
	if (customPreset) preset = customPreset
	const customBitrate = parseInt(String(opts.videoBitrateKbps ?? ''), 10)
	if (Number.isFinite(customBitrate) && customBitrate >= 200) vbr = customBitrate

	const fps = Math.max(1, parseInt(String(opts.fps ?? '50'), 10) || 50)
	const keyint = Math.max(25, fps * 2)
	const minKeyint = Math.max(1, Math.floor(fps))
	const x264opts = `min-keyint=${minKeyint}:scenecut=0:repeat-headers=1`

	const audioCodec = String(opts.audioCodec || 'aac').toLowerCase()
	const abrRaw = parseInt(String(opts.audioBitrateKbps ?? ''), 10)
	const abr = Number.isFinite(abrRaw) ? Math.max(32, abrRaw) : 128
	// WO-172 T172.5: layout-aware downmix — stereo program buses (the default when `programLayout`
	// is unset) produce the exact same filter chain as before this WO.
	const { filterA, ac } = buildAudioDownmixFilterChain(opts.programLayout)
	const filterArgsStr = filterA.map((f) => `-filter:a ${f}`).join(' ')
	const acArg = ac != null ? ` -ac ${ac}` : ''
	let audioPart = `${filterArgsStr}${acArg} -codec:a aac -b:a ${abr}k`
	if (audioCodec === 'copy') audioPart = '-codec:a copy'
	if (audioCodec === 'none') audioPart = '-an'

	return [
		`-format mpegts -i -`,
		`-filter:v format=yuv420p`,
		`-codec:v libx264 -preset:v ${preset} -b:v ${vbr}k -tune:v zerolatency -profile:v high`,
		`-g:v ${keyint}`,
		`-x264-params:v ${x264opts}`,
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

module.exports = { buildStreamingRtmpFfmpegArgs, buildStreamingRtmpAddParams, buildAudioDownmixFilterChain }
