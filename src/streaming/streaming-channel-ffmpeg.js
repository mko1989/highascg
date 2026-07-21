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
 *
 * WO-249 T249.2: extend with `audioSourcePair` to select a specific stereo pair from a multichannel
 * program bus. When 'all' (default), uses the first pair (c0/c1); specific pairs ('3+4', etc.) are
 * mapped to their channel indices ('3+4' → [2,3] → c0=c2|c1=c3). If the selected pair exceeds the
 * resolved layout's channel count, logs a warn and falls back to first pair.
 *
 * @param {string} [programLayout] - 'stereo' | '4ch' | '8ch' | '16ch' (i.e. `screen_N_audio_layout` id)
 * @param {string} [audioSourcePair] - 'all' | '1+2' | '3+4' | '5+6' | '7+8' (default: 'all')
 * @param {(msg: string, context?: object) => void} [logWarn] - optional warn logger
 * @returns {{ filterA: string[], ac: number | null }}
 */
function buildAudioDownmixFilterChain(programLayout, audioSourcePair, logWarn) {
	const layout = String(programLayout || 'stereo').toLowerCase()
	const channels = layout === '16ch' ? 16 : layout === '8ch' ? 8 : layout === '4ch' ? 4 : 2
	if (channels <= 2) {
		return { filterA: ['aresample=48000', 'aformat=channel_layouts=stereo'], ac: null }
	}
	const pair = String(audioSourcePair || 'all').trim().toLowerCase()
	if (!pair || pair === 'all') {
		return { filterA: ['aresample=48000', 'pan=stereo|c0=c0|c1=c1'], ac: 2 }
	}
	const match = String(pair).match(/^(\d+)\+(\d+)$/)
	if (!match) {
		return { filterA: ['aresample=48000', 'pan=stereo|c0=c0|c1=c1'], ac: 2 }
	}
	const ch0 = Number(match[1]) - 1
	const ch1 = Number(match[2]) - 1
	if (ch0 < 0 || ch1 < 0 || ch0 >= channels || ch1 >= channels) {
		if (logWarn) {
			logWarn(`audioSourcePair ${pair} exceeds resolved layout channel count ${channels}; falling back to 1+2`, {
				pair,
				channels,
			})
		}
		return { filterA: ['aresample=48000', 'pan=stereo|c0=c0|c1=c1'], ac: 2 }
	}
	if (ch0 === ch1) {
		return { filterA: ['aresample=48000', 'pan=stereo|c0=c0|c1=c1'], ac: 2 }
	}
	return { filterA: [`aresample=48000`, `pan=stereo|c0=c${ch0}|c1=c${ch1}`], ac: 2 }
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
	// WO-249 T249.2: pass audioSourcePair for pair selection on multichannel buses.
	const { filterA, ac } = buildAudioDownmixFilterChain(opts.programLayout, opts.audioSourcePair, opts.logWarn)
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
		`-format ${String(opts.containerFormat || 'flv')}`,
	].join(' ')
}

/**
 * SRT output URL with ffmpeg/libsrt query options. The bundled Caspar binary links
 * libsrt-gnutls.so.1.5 (verified via ldd 2026-07-21), so `ADD … STREAM srt://…` goes through
 * Caspar's own ffmpeg consumer — no external process.
 *
 * ffmpeg's `latency` option is in MICROSECONDS (libsrt doc), while every SRT UI on earth speaks
 * milliseconds — the owner-facing field is ms and converted here, in one place.
 * @param {string} srtUrl e.g. srt://host:9000 (existing query params are preserved)
 * @param {{ latencyMs?: number|string, streamId?: string, mode?: string }} [opts]
 * @returns {string|null}
 */
function buildSrtOutputUrl(srtUrl, opts = {}) {
	const base = String(srtUrl || '').trim()
	if (!base || !/^srt:\/\//i.test(base)) return null
	const params = []
	const latMs = parseInt(String(opts.latencyMs ?? ''), 10)
	if (Number.isFinite(latMs) && latMs > 0) params.push(`latency=${Math.min(8000, latMs) * 1000}`)
	const sid = String(opts.streamId || '').trim()
	if (sid) params.push(`streamid=${encodeURIComponent(sid)}`)
	const mode = String(opts.mode || '').trim().toLowerCase()
	if (mode === 'listener' || mode === 'caller') params.push(`mode=${mode}`)
	// WO-307: libsrt rejects a passphrase outside 10-79 chars outright — better to omit it and let
	// the connection fail on an obviously-wrong length than hand Caspar a passphrase it will bounce
	// with a cryptic AMCP error. Silent length-guard here, not upstream, because this is the single
	// choke point every SRT URL (Start button AND any future caller) passes through.
	const pass = String(opts.passphrase || '').trim()
	if (pass.length >= 10 && pass.length <= 79) {
		params.push(`passphrase=${encodeURIComponent(pass)}`, 'pbkeylen=16')
	}
	if (!params.length) return base
	return base + (base.includes('?') ? '&' : '?') + params.join('&')
}

/**
 * SRT variant of {@link buildStreamingRtmpAddParams}: same encoder pipeline, but MPEG-TS container
 * (SRT carries TS, not FLV). `opts.passphrase` — WO-307 — must be resolved server-side from the
 * project credentials (project-stream-credentials.js), the same rule the RTMP stream key already
 * follows: never accept a passphrase from the client body except a freshly-typed, unsaved value as
 * a last resort before the operator hits Save.
 * @param {string} srtUrl
 * @param {'low'|'medium'|'high'} quality
 * @param {object} [opts] encoder opts plus { latencyMs, streamId, mode }
 */
function buildStreamingSrtAddParams(srtUrl, quality, opts = {}) {
	const url = buildSrtOutputUrl(srtUrl, opts)
	if (!url) return null
	return { url, args: buildStreamingRtmpFfmpegArgs(quality, { ...opts, containerFormat: 'mpegts' }) }
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

module.exports = {
	buildStreamingRtmpFfmpegArgs,
	buildStreamingRtmpAddParams,
	buildSrtOutputUrl,
	buildStreamingSrtAddParams,
	buildAudioDownmixFilterChain,
}
