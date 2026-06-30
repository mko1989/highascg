/**
 * Dedicated streaming channel: RTMP (ADD STREAM) + file record (ADD FILE) on `channelMap.streamingCh`.
 * @see work/27_WO_STREAMING_CHANNEL.md
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getChannelMap } = require('../config/routing')
const { buildStreamingRtmpAddParams } = require('../streaming/streaming-channel-ffmpeg')
const {
	buildStreamingChannelStatusPayload,
	sanitizeLogExtra,
} = require('../streaming/streaming-channel-status')
const streamLog = require('../utils/buffered-logger').streaming
const { param } = require('../caspar/amcp-utils')
const path = require('path')
const { getMediaIngestBasePath } = require('../media/local-media')

const STREAMING_RTMP_CONSUMER_INDEX = 97
const STREAMING_RECORD_CONSUMER_INDEX = 96
const LOG_RING_MAX = 80

function ensureStreamLogStore(ctx) {
	if (!ctx._streamingChannelLogs || typeof ctx._streamingChannelLogs !== 'object') {
		ctx._streamingChannelLogs = { rtmp: [], record: [] }
	}
	if (!Array.isArray(ctx._streamingChannelLogs.rtmp)) ctx._streamingChannelLogs.rtmp = []
	if (!Array.isArray(ctx._streamingChannelLogs.record)) ctx._streamingChannelLogs.record = []
	return ctx._streamingChannelLogs
}

function trimLogRing(store, key) {
	if (!Array.isArray(store[key])) store[key] = []
	if (store[key].length > LOG_RING_MAX) store[key] = store[key].slice(-LOG_RING_MAX)
}

function logToBufferedCategory(level, message, extra) {
	const suffix = extra && typeof extra === 'object' ? ` ${JSON.stringify(extra)}` : ''
	const line = `[Streaming channel] ${message}${suffix}`
	const fn = streamLog[String(level)] || streamLog.info
	fn(line)
}

function broadcastStreamingChannelStatus(ctx) {
	if (typeof ctx._wsBroadcast !== 'function') return
	ctx._wsBroadcast(
		'streaming_channel',
		buildStreamingChannelStatusPayload(ctx, {
			rtmpConsumerIndex: STREAMING_RTMP_CONSUMER_INDEX,
			recordConsumerIndex: STREAMING_RECORD_CONSUMER_INDEX,
		}),
	)
}

/**
 * @param {object} config
 * @param {string | null | undefined} absPath
 */
function absPathToMediaId(config, absPath) {
	if (!absPath) return ''
	const base = getMediaIngestBasePath(config)
	const rel = path.relative(base, absPath)
	if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return path.basename(String(absPath))
	return rel.replace(/\\/g, '/')
}

/**
 * @param {object} ctx
 * @param {string | null | undefined} absPath
 */
function broadcastRecordStopped(ctx, absPath) {
	if (typeof ctx._wsBroadcast !== 'function' || !absPath) return
	ctx._wsBroadcast('record_stopped', {
		mediaId: absPathToMediaId(ctx.config || {}, absPath),
		absPath,
	})
}

function pushKindLog(ctx, kind, level, message, extra) {
	const store = ensureStreamLogStore(ctx)
	const safeExtra = extra ? sanitizeLogExtra(extra) : undefined
	const row = {
		ts: new Date().toISOString(),
		level: String(level || 'info'),
		message: String(message || ''),
		...(safeExtra && typeof safeExtra === 'object' ? { extra: safeExtra } : {}),
	}
	store[kind].push(row)
	trimLogRing(store, kind)
	logToBufferedCategory(level, message, safeExtra)
	broadcastStreamingChannelStatus(ctx)
}

function pushRtmpLog(ctx, level, message, extra) {
	pushKindLog(ctx, 'rtmp', level, message, extra)
}

function pushRecordLog(ctx, level, message, extra) {
	pushKindLog(ctx, 'record', level, message, extra)
}

function parseStreamStatusPollMs() {
	const n = parseInt(String(process.env.HIGHASCG_STREAM_STATUS_POLL_MS || ''), 10)
	return Number.isFinite(n) && n >= 5000 ? n : 0
}

function stopStreamingStatusPoll(ctx) {
	if (ctx._streamingChannelRtmpPollTimer) {
		clearInterval(ctx._streamingChannelRtmpPollTimer)
		ctx._streamingChannelRtmpPollTimer = null
	}
}

function startStreamingStatusPoll(ctx) {
	stopStreamingStatusPoll(ctx)
	const ms = parseStreamStatusPollMs()
	if (!ms || !ctx.streamingChannelRtmp?.active) return
	ctx._streamingChannelRtmpPollTimer = setInterval(() => {
		void pollRtmpHealth(ctx)
	}, ms)
}

async function pollRtmpHealth(ctx) {
	if (!ctx.streamingChannelRtmp?.active || !ctx.amcp) return
	const map = getChannelMap(ctx.config || {}, ctx.switcherOutputBusByChannel)
	const ch = map.streamingCh
	if (ch == null) return
	try {
		const info = await ctx.amcp.info(ch)
		const blob = info?.data == null ? '' : Array.isArray(info.data) ? info.data.join('\n') : String(info.data)
		const hasFfmpeg = /ffmpeg|stream consumer|<stream>/i.test(blob)
		pushRtmpLog(ctx, 'debug', `Health ch${ch}: ${hasFfmpeg ? 'STREAM consumer seen in INFO' : 'no STREAM consumer in INFO'}`, {
			channel: ch,
		})
	} catch (e) {
		pushRtmpLog(ctx, 'warn', `Health ch${ch}: INFO query failed`, { error: e?.message || String(e) })
	}
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
	const af = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo'
	const abrRaw = parseInt(String(opts.audioBitrateKbps ?? ''), 10)
	const abr = Number.isFinite(abrRaw) ? Math.max(32, abrRaw) : 128
	return [video, `-filter:a ${af}`, `-codec:a aac`, `-b:a ${abr}k`].join(' ')
}
function resolveStreamOutputConfig(config, outputId) {
	const outputs = Array.isArray(config?.streamOutputs) ? config.streamOutputs : []
	return outputs.find((x) => String(x?.id || '') === String(outputId || '')) || outputs[0] || null
}

function resolveRecordOutputConfig(config, outputId) {
	const outputs = Array.isArray(config?.recordOutputs) ? config.recordOutputs : []
	return outputs.find((x) => String(x?.id || '') === String(outputId || '')) || outputs[0] || null
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


function isRemoveNotFoundError(err) {
	const msg = err?.message || String(err || '')
	return /404\s+REMOVE\s+FAILED/i.test(msg) || /MEDIAFILE_NOT_FOUND.*REMOVE/i.test(msg)
}

/**
 * @param {object} ctx
 */
function handleGet(ctx) {
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody(
			buildStreamingChannelStatusPayload(ctx, {
				rtmpConsumerIndex: STREAMING_RTMP_CONSUMER_INDEX,
				recordConsumerIndex: STREAMING_RECORD_CONSUMER_INDEX,
			}),
		),
	}
}

/**
 * @param {string} body
 * @param {object} ctx
 */
async function handlePostRtmp(body, ctx) {
	if (!ctx.amcp) {
		return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
	}
	const map = getChannelMap(ctx.config || {}, ctx.switcherOutputBusByChannel)
	if (map.streamingCh == null) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Streaming channel disabled — enable in Settings → Screens' }) }
	}
	const b = parseBody(body)
	const action = b.action === 'stop' ? 'stop' : 'start'
	const ch = map.streamingCh
	const outputId = String(b.outputId || '').trim()
	const outCfg = resolveStreamOutputConfig(ctx.config || {}, outputId)

	if (!ctx.streamingChannelRtmp) ctx.streamingChannelRtmp = { active: false, url: null }

	if (action === 'start') {
		if (ctx.streamingChannelRtmp.active) {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'RTMP already running — stop first' }) }
		}
		const serverUrl = String(b.rtmpServerUrl || '').trim()
		const streamKey = String(b.streamKey || '').trim()
		const quality = String(b.quality || outCfg?.quality || 'medium').toLowerCase()
		const built = buildStreamingRtmpAddParams(serverUrl, streamKey, quality, {
			videoCodec: b.videoCodec || outCfg?.videoCodec,
			videoBitrateKbps: b.videoBitrateKbps ?? outCfg?.videoBitrateKbps,
			encoderPreset: b.encoderPreset || outCfg?.encoderPreset,
			audioCodec: b.audioCodec || outCfg?.audioCodec,
			audioBitrateKbps: b.audioBitrateKbps ?? outCfg?.audioBitrateKbps,
		})
		if (!built) {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'rtmpServerUrl and streamKey required' }) }
		}
		const params = `${param(built.url)} ${built.args}`.trim()
		const addWithIdxCmd = `ADD ${ch}-${STREAMING_RTMP_CONSUMER_INDEX} STREAM ${params}`
		const addNoIdxCmd = `ADD ${ch} STREAM ${params}`
		pushRtmpLog(ctx, 'info', `RTMP start requested on ch${ch}`, { url: built.url, quality })
		try {
			let res
			let usedIndex = STREAMING_RTMP_CONSUMER_INDEX
			try {
				res = await ctx.amcp.raw(addWithIdxCmd)
				pushRtmpLog(ctx, 'debug', 'AMCP ADD STREAM with consumer index accepted', {
					command: addWithIdxCmd,
				})
			} catch (e1) {
				const msg1 = e1?.message || String(e1)
				pushRtmpLog(ctx, 'warn', 'AMCP ADD with consumer index failed, trying fallback syntax', {
					command: addWithIdxCmd,
					error: msg1,
				})
				res = await ctx.amcp.raw(addNoIdxCmd)
				usedIndex = null
				pushRtmpLog(ctx, 'debug', 'AMCP ADD STREAM without consumer index accepted', {
					command: addNoIdxCmd,
				})
			}
			ctx.streamingChannelRtmp = { active: true, url: built.url, consumerIndex: usedIndex, lastError: null, outputId: outputId || null }
			ctx.log?.('info', `[Streaming channel] RTMP started ch${ch}`)
			pushRtmpLog(ctx, 'info', `RTMP started on ch${ch}`, { url: built.url, consumerIndex: usedIndex })
			startStreamingStatusPoll(ctx)
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: true, active: true, url: built.url, amcp: res }),
			}
		} catch (e) {
			const msg = e?.message || String(e)
			ctx.streamingChannelRtmp = { ...ctx.streamingChannelRtmp, active: false, lastError: msg }
			ctx.log?.('warn', `[Streaming channel] RTMP start failed: ${msg}`)
			pushRtmpLog(ctx, 'error', `RTMP start failed on ch${ch}`, { error: msg, command: addNoIdxCmd })
			stopStreamingStatusPoll(ctx)
			return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
		}
	}

	/* stop */
	if (!ctx.streamingChannelRtmp.active) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'RTMP not active' }) }
	}
	const url = ctx.streamingChannelRtmp.url
	try {
		const idx = Number.isFinite(Number(ctx.streamingChannelRtmp?.consumerIndex))
			? Number(ctx.streamingChannelRtmp.consumerIndex)
			: STREAMING_RTMP_CONSUMER_INDEX
		let res
		try {
			res = await ctx.amcp.raw(`REMOVE ${ch}-${idx} STREAM ${param(url)}`)
		} catch (e1) {
			res = await ctx.amcp.raw(`REMOVE ${ch} STREAM ${param(url)}`)
		}
		ctx.streamingChannelRtmp = { active: false, url: null, consumerIndex: idx, lastError: null }
		stopStreamingStatusPoll(ctx)
		ctx.log?.('info', `[Streaming channel] RTMP stopped ch${ch}`)
		pushRtmpLog(ctx, 'info', `RTMP stopped on ch${ch}`, { url })
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, active: false, amcp: res }) }
	} catch (e) {
		const msg = e?.message || String(e)
		if (isRemoveNotFoundError(e)) {
			ctx.streamingChannelRtmp = { active: false, url: null, consumerIndex: null, lastError: null }
			stopStreamingStatusPoll(ctx)
			pushRtmpLog(ctx, 'warn', `RTMP stop fallback: stream already absent on ch${ch}`, { url, error: msg })
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, active: false, warning: msg }) }
		}
		ctx.streamingChannelRtmp = { active: false, url: null, consumerIndex: null, lastError: msg }
		stopStreamingStatusPoll(ctx)
		pushRtmpLog(ctx, 'error', `RTMP stop failed on ch${ch}`, { url, error: msg })
		return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
	}
}

/**
 * @param {string} body
 * @param {object} ctx
 */
async function handlePostRecord(body, ctx) {
	if (!ctx.amcp) {
		return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
	}
	const map = getChannelMap(ctx.config || {}, ctx.switcherOutputBusByChannel)
	const b = parseBody(body)
	const action = b.action === 'stop' ? 'stop' : 'start'
	const outputId = String(b.outputId || '').trim()
	const outCfg = resolveRecordOutputConfig(ctx.config || {}, outputId)
	const ch = outputId ? resolveRecordSourceChannel(ctx, outputId) : map.streamingCh
	if (ch == null) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'No recording source channel available' }) }
	}

	if (!ctx.streamingChannelRecord) ctx.streamingChannelRecord = { active: false, path: null }

	if (action === 'start') {
		if (ctx.streamingChannelRecord.active) {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Already recording — stop first' }) }
		}
		const crf = b.crf != null && Number.isFinite(Number(b.crf))
			? Math.min(51, Math.max(18, Math.round(Number(b.crf))))
			: Number.isFinite(Number(outCfg?.crf))
				? Math.min(51, Math.max(18, Math.round(Number(outCfg.crf))))
				: 26
		const dir = await resolveCasparMediaDir(ctx)
		if (!dir) {
			pushRecordLog(ctx, 'error', 'Record start failed: could not resolve Caspar media folder', { outputId })
			return {
				status: 502,
				headers: JSON_HEADERS,
				body: jsonBody({ error: 'Could not resolve Caspar media folder for recording.' }),
			}
		}
		const recLabel = safeFileStem(outCfg?.name || outCfg?.label || outputId || 'record')
		const fileName = `${recLabel}_${localDateTimeStampForFilename()}.mp4`
		const absPath = joinCasparMediaFile(dir, fileName)
		const args = recordFfmpegArgs({
			crf,
			videoCodec: b.videoCodec || outCfg?.videoCodec,
			videoBitrateKbps: b.videoBitrateKbps ?? outCfg?.videoBitrateKbps,
			encoderPreset: b.encoderPreset || outCfg?.encoderPreset,
			audioCodec: b.audioCodec || outCfg?.audioCodec,
			audioBitrateKbps: b.audioBitrateKbps ?? outCfg?.audioBitrateKbps,
		})
		const paramsAfterPath = `${param(fileName)} ${args}`
		const addCmd = `ADD ${ch}-${STREAMING_RECORD_CONSUMER_INDEX} FILE ${paramsAfterPath}`
		pushRecordLog(ctx, 'info', `Record start requested on ch${ch}`, { path: absPath, outputId: outputId || null, crf })
		try {
			const res = await ctx.amcp.basic.add(ch, 'FILE', paramsAfterPath, STREAMING_RECORD_CONSUMER_INDEX)
			ctx.streamingChannelRecord = {
				active: true,
				path: absPath,
				channel: ch,
				outputId: outputId || null,
				lastError: null,
			}
			ctx.log?.('info', `[Streaming channel] Record started ch${ch} → ${absPath}`)
			pushRecordLog(ctx, 'info', `Record started on ch${ch}`, { path: absPath, outputId: outputId || null })
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: true, recording: true, path: absPath, channel: ch, crf, amcp: res }),
			}
		} catch (e) {
			const msg = e?.message || String(e)
			ctx.streamingChannelRecord = { ...ctx.streamingChannelRecord, active: false, lastError: msg }
			ctx.log?.('warn', `[Streaming channel] Record start failed: ${msg}`)
			pushRecordLog(ctx, 'error', `Record start failed on ch${ch}`, { error: msg, command: addCmd })
			return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
		}
	}

	if (!ctx.streamingChannelRecord.active) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Not recording' }) }
	}
	const recCh = ctx.streamingChannelRecord.channel ?? ch
	try {
		const res = await ctx.amcp.basic.remove(recCh, null, STREAMING_RECORD_CONSUMER_INDEX)
		const outPath = ctx.streamingChannelRecord.path
		ctx.streamingChannelRecord = { active: false, path: null, channel: null, lastError: null }
		ctx.log?.('info', `[Streaming channel] Record stopped ch${recCh}`)
		pushRecordLog(ctx, 'info', `Record stopped on ch${recCh}`, { path: outPath })
		broadcastRecordStopped(ctx, outPath)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, recording: false, path: outPath, amcp: res }) }
	} catch (e) {
		const msg = e?.message || String(e)
		if (isRemoveNotFoundError(e)) {
			const outPath = ctx.streamingChannelRecord.path
			ctx.streamingChannelRecord = { active: false, path: null, channel: null, lastError: null }
			pushRecordLog(ctx, 'warn', `Record stop fallback: file consumer already absent on ch${recCh}`, { path: outPath, error: msg })
			broadcastRecordStopped(ctx, outPath)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, recording: false, warning: msg }) }
		}
		ctx.streamingChannelRecord = { active: false, path: null, channel: null, lastError: msg }
		pushRecordLog(ctx, 'error', `Record stop failed on ch${recCh}`, { error: msg })
		return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
	}
}

/**
 * @param {string} method
 * @param {string} p
 * @param {string} body
 * @param {object} ctx
 */
async function handle(method, p, body, ctx) {
	if (method === 'GET' && p === '/api/streaming-channel') return handleGet(ctx)
	if (method === 'POST' && p === '/api/streaming-channel/rtmp') return await handlePostRtmp(body, ctx)
	if (method === 'POST' && p === '/api/streaming-channel/record') return await handlePostRecord(body, ctx)
	return null
}

module.exports = {
	handle,
	handleGet,
	broadcastStreamingChannelStatus,
	pushRtmpLog,
	pushRecordLog,
	STREAMING_RTMP_CONSUMER_INDEX,
	STREAMING_RECORD_CONSUMER_INDEX,
}
