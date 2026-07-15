'use strict'

const path = require('path')
const { getChannelMap } = require('../config/routing')
const { buildAudioDownmixFilterChain } = require('../streaming/streaming-channel-ffmpeg')
const { destinationAudioLayoutsByMain } = require('../config/screen-destinations')

const STREAMING_RTMP_CONSUMER_INDEX = 97
const STREAMING_RECORD_CONSUMER_INDEX = 96

function isRemoveNotFoundError(err) {
	const msg = err?.message || String(err || '')
	return /404\s+REMOVE\s+FAILED/i.test(msg) || /MEDIAFILE_NOT_FOUND.*REMOVE/i.test(msg)
}

function joinCasparMediaFile(dir, file) {
	const d = String(dir || '').trim().replace(/[/\\]+$/, '')
	if (!d) return file
	if (/^[A-Za-z]:[\\/]/.test(d)) return path.win32.join(d, file)
	return path.posix.join(d.replace(/\\/g, '/'), file.replace(/\\/g, '/'))
}

function localDateTimeStampForFilename() {
	const d = new Date()
	const pad = (n, z = 2) => String(n).padStart(z, '0')
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`
}

function safeFileStem(s, fallback = 'record') {
	const raw = String(s || '').trim()
	const cleaned = raw
		.replace(/[\\/:*?"<>|]+/g, '_')
		.replace(/\s+/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_+|_+$/g, '')
	return cleaned || fallback
}

function parseMediaPathFromBlob(blob) {
	const s = blob == null ? '' : Array.isArray(blob) ? blob.join('\n') : String(blob)
	if (!s) return ''
	const m = s.match(/<media-path>\s*([^<]+?)\s*<\/media-path>/i)
	return m ? m[1].trim() : ''
}

function isAbsolutePath(p) {
	const s = String(p || '').trim()
	return s.startsWith('/') || /^[A-Za-z]:[\\/]/.test(s)
}

async function resolveCasparMediaDir(ctx) {
	const ov = process.env.HIGHASCG_PGM_RECORD_DIR
	if (ov && String(ov).trim()) return String(ov).trim()
	let p = parseMediaPathFromBlob(ctx.gatheredInfo?.infoPaths)
	if (p) return p
	try {
		if (ctx.amcp?.query?.infoPaths) {
			const r = await ctx.amcp.query.infoPaths()
			p = parseMediaPathFromBlob(r?.data)
			if (p) return p
		}
	} catch (e) {
		ctx.log?.('debug', `[Streaming channel] INFO PATHS query: ${e?.message || e}`)
	}
	p = parseMediaPathFromBlob(ctx.gatheredInfo?.infoConfig)
	if (p && isAbsolutePath(p)) return p
	const local = (ctx.config?.local_media_path || '').trim()
	if (local) return isAbsolutePath(local) ? local : path.resolve(local)
	return null
}

/**
 * @param {object} [opts]
 * @param {number} [opts.crf]
 * @param {string} [opts.videoCodec]
 * @param {string} [opts.encoderPreset]
 * @param {number} [opts.videoBitrateKbps]
 * @param {string} [opts.audioCodec]
 * @param {number} [opts.audioBitrateKbps]
 * @param {string} [opts.programLayout] - WO-172 T172.5: 'stereo' | '4ch' | '8ch' | '16ch'
 *   (`screen_N_audio_layout` id) of the cabled source's program bus. Defaults to 'stereo'
 *   (today's behavior, byte-identical for stereo sources).
 * @param {string} [opts.audioSourcePair] - WO-249 T249.2: 'all' | '1+2' | '3+4' | '5+6' | '7+8' for pair selection.
 * @param {(msg: string, context?: object) => void} [opts.logWarn] - optional warn logger.
 */
function recordFfmpegArgs(opts = {}) {
	const crf = Number.isFinite(Number(opts.crf)) ? Math.min(51, Math.max(18, Math.round(Number(opts.crf)))) : 26
	const codec = String(opts.videoCodec || 'h264').toLowerCase() === 'hevc' ? 'libx265' : 'libx264'
	const preset = String(opts.encoderPreset || 'veryfast').trim().toLowerCase() || 'veryfast'
	const vbrRaw = parseInt(String(opts.videoBitrateKbps ?? ''), 10)
	const useVbr = Number.isFinite(vbrRaw) && vbrRaw >= 200
	const video = [
		`-codec:v ${codec}`,
		`-preset:v ${preset}`,
		useVbr ? `-b:v ${vbrRaw}k` : `-crf:v ${crf}`,
		`-tune:v zerolatency`,
		`-filter:v format=yuv420p`,
	].join(' ')
	const audioCodec = String(opts.audioCodec || 'aac').toLowerCase()
	if (audioCodec === 'none') return `${video} -an`
	if (audioCodec === 'copy') return `${video} -codec:a copy`
	// WO-172 T172.4: was a single comma-joined `-filter:a aresample=48000,aformat=...` — the exact
	// syntax documented (src/streaming/streaming-channel-ffmpeg.js) as causing `400
	// COMMAND_UNKNOWN_DATA` on some Caspar builds. Now the same chained two-pass form RTMP uses.
	// T172.5: layout-aware — stereo (default) is byte-identical to the prior chained form.
	// WO-249 T249.2: pass audioSourcePair for pair selection on multichannel buses.
	const { filterA, ac } = buildAudioDownmixFilterChain(opts.programLayout, opts.audioSourcePair, opts.logWarn)
	const filterArgsStr = filterA.map((f) => `-filter:a ${f}`).join(' ')
	const acArg = ac != null ? ` -ac ${ac}` : ''
	const abrRaw = parseInt(String(opts.audioBitrateKbps ?? ''), 10)
	const abr = Number.isFinite(abrRaw) ? Math.max(32, abrRaw) : 128
	return [video, filterArgsStr + acArg, `-codec:a aac`, `-b:a ${abr}k`].join(' ')
}

function resolveStreamOutputConfig(config, outputId) {
	const outputs = Array.isArray(config?.streamOutputs) ? config.streamOutputs : []
	return outputs.find((x) => String(x?.id || '') === String(outputId || '')) || outputs[0] || null
}

function resolveRecordOutputConfig(config, outputId) {
	const outputs = Array.isArray(config?.recordOutputs) ? config.recordOutputs : []
	return outputs.find((x) => String(x?.id || '') === String(outputId || '')) || outputs[0] || null
}

function ensureRecordSessions(ctx) {
	if (!ctx.streamingChannelRecords || typeof ctx.streamingChannelRecords !== 'object') {
		ctx.streamingChannelRecords = {}
	}
	const legacy = ctx.streamingChannelRecord
	if (legacy?.active) {
		const key = String(legacy.outputId || '_legacy').trim() || '_legacy'
		if (!ctx.streamingChannelRecords[key]?.active) {
			ctx.streamingChannelRecords[key] = {
				active: true,
				path: legacy.path || null,
				channel: legacy.channel ?? null,
				outputId: legacy.outputId || key,
				lastError: legacy.lastError || null,
				consumerIndex: STREAMING_RECORD_CONSUMER_INDEX,
			}
		}
	}
	return ctx.streamingChannelRecords
}

function recordSessionKey(outputId, outCfg) {
	const id = String(outputId || outCfg?.id || '').trim()
	return id || '_default'
}

function allocateRecordConsumerIndex(sessions, ch) {
	const used = new Set()
	for (const s of Object.values(sessions)) {
		if (s?.active && s.channel === ch && Number.isFinite(Number(s.consumerIndex))) {
			used.add(Number(s.consumerIndex))
		}
	}
	for (let idx = STREAMING_RECORD_CONSUMER_INDEX; idx >= 90; idx--) {
		if (!used.has(idx)) return idx
	}
	return null
}

/**
 * WO-172 T172.5: resolve the program-bus audio layout ('stereo' | '4ch' | '8ch' | '16ch') for a
 * stream/record `source` value (e.g. `program_2`, `preview_1`, `multiview`), by looking up the
 * cabled destination's `audioLayout` (`screenDestinations[].audioLayout`, keyed by mainScreenIndex —
 * same derivation the Caspar XML generator uses for `screen_N_audio_layout`, see
 * `src/config/build-caspar-generator-config.js:281-288` / `src/config/screen-destinations.js:129-138`).
 * Multiview has no per-layout audio (`buildMultiviewChannel` emits no `<channel-layout>`) — 'stereo'.
 * @param {Record<string, unknown>} config
 * @param {string} [source] - e.g. 'program_1', 'preview_2', 'multiview'
 * @returns {string} 'stereo' | '4ch' | '8ch' | '16ch'
 */
function resolveSourceProgramAudioLayout(config, source) {
	const src = String(source || 'program_1').toLowerCase()
	if (src === 'multiview') return 'stereo'
	const m = src.match(/^(?:program|preview)[_-]?(\d+)$/)
	if (!m) return 'stereo'
	const mainIdx = Math.max(0, (parseInt(m[1], 10) || 1) - 1)
	const byMain = destinationAudioLayoutsByMain(config || {})
	return String(byMain[mainIdx] || 'stereo')
}

function resolveRecordSourceChannel(ctx, outputId) {
	const config = ctx.config || {}
	const map = getChannelMap(config, ctx.switcherOutputBusByChannel)
	const outputs = Array.isArray(config?.recordOutputs) ? config.recordOutputs : []
	const picked = outputs.find((x) => String(x?.id || '') === String(outputId || '')) || outputs[0] || {}
	const source = String(picked?.source || 'program_1').toLowerCase()
	if (source === 'multiview' && map.multiviewCh != null) return map.multiviewCh
	const pm = source.match(/^program[_-]?(\d+)$/)
	if (pm) {
		const i = parseInt(pm[1], 10)
		if (i >= 1 && i <= map.screenCount) return map.programCh(i)
	}
	const pr = source.match(/^preview[_-]?(\d+)$/)
	if (pr) {
		const i = parseInt(pr[1], 10)
		if (i >= 1 && i <= map.screenCount) {
			const ch = map.previewCh(i)
			if (ch != null) return ch
		}
	}
	return map.programCh(1)
}

module.exports = {
	STREAMING_RTMP_CONSUMER_INDEX,
	STREAMING_RECORD_CONSUMER_INDEX,
	isRemoveNotFoundError,
	joinCasparMediaFile,
	localDateTimeStampForFilename,
	safeFileStem,
	resolveCasparMediaDir,
	recordFfmpegArgs,
	resolveStreamOutputConfig,
	resolveRecordOutputConfig,
	ensureRecordSessions,
	recordSessionKey,
	allocateRecordConsumerIndex,
	resolveRecordSourceChannel,
	resolveSourceProgramAudioLayout,
}
