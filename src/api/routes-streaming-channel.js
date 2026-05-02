/**
 * Dedicated streaming channel: RTMP (ADD STREAM) + file record (ADD FILE) on `channelMap.streamingCh`.
 * @see work/27_WO_STREAMING_CHANNEL.md
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getChannelMap, resolveStreamingChannelRoute, resolveStreamingChannelRouteForRole } = require('../config/routing')
const { buildStreamingRtmpAddParams } = require('../streaming/streaming-channel-ffmpeg')
const { param } = require('../caspar/amcp-utils')
const path = require('path')

const STREAMING_RTMP_CONSUMER_INDEX = 97
const STREAMING_RECORD_CONSUMER_INDEX = 96

function ensureStreamLogStore(ctx) {
	if (!ctx._streamingChannelLogs || typeof ctx._streamingChannelLogs !== 'object') {
		ctx._streamingChannelLogs = { rtmp: [] }
	}
	if (!Array.isArray(ctx._streamingChannelLogs.rtmp)) ctx._streamingChannelLogs.rtmp = []
	return ctx._streamingChannelLogs
}

function pushRtmpLog(ctx, level, message, extra) {
	const store = ensureStreamLogStore(ctx)
	const row = {
		ts: new Date().toISOString(),
		level: String(level || 'info'),
		message: String(message || ''),
		...(extra && typeof extra === 'object' ? { extra } : {}),
	}
	store.rtmp.push(row)
	if (store.rtmp.length > 80) store.rtmp = store.rtmp.slice(-80)
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
	const map = getChannelMap(ctx.config || {}, ctx.switcherOutputBusByChannel)
	const rtmp = ctx.streamingChannelRtmp || { active: false }
	const rec = ctx.streamingChannelRecord || { active: false }
	const logs = ensureStreamLogStore(ctx)
	const vRoute = resolveStreamingChannelRoute(ctx.config || {})
	const aRoute = resolveStreamingChannelRouteForRole(ctx.config || {}, 'audio')
	const sc = ctx.config?.streamingChannel && typeof ctx.config.streamingChannel === 'object' ? ctx.config.streamingChannel : {}
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			enabled: map.streamingCh != null,
			channel: map.streamingCh,
			contentLayer: map.streamingContentLayer,
			videoSource: sc.videoSource ?? 'program_1',
			audioSource: sc.audioSource == null || sc.audioSource === '' ? 'follow_video' : String(sc.audioSource),
			route: vRoute,
			audioRoute: aRoute,
			splitAvRouted: vRoute && aRoute && vRoute !== aRoute && map.streamingContentLayer >= 2,
			rtmp: {
				active: !!rtmp.active,
				url: rtmp.url || null,
				outputId: rtmp.outputId || null,
				consumerIndex: rtmp.consumerIndex ?? STREAMING_RTMP_CONSUMER_INDEX,
				lastError: rtmp.lastError || null,
				logs: logs.rtmp,
			},
			record: { active: !!rec.active, path: rec.path || null, outputId: rec.outputId || null },
		}),
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
			ctx.log?.('info', `[Streaming channel] RTMP started ch${ch}: ${built.url}`)
			pushRtmpLog(ctx, 'info', `RTMP started on ch${ch}`, { url: built.url, consumerIndex: usedIndex })
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
		ctx.log?.('info', `[Streaming channel] RTMP stopped ch${ch}`)
		pushRtmpLog(ctx, 'info', `RTMP stopped on ch${ch}`, { url })
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, active: false, amcp: res }) }
	} catch (e) {
		const msg = e?.message || String(e)
		if (isRemoveNotFoundError(e)) {
			ctx.streamingChannelRtmp = { active: false, url: null, consumerIndex: null, lastError: null }
			pushRtmpLog(ctx, 'warn', `RTMP stop fallback: stream already absent on ch${ch}`, { url, error: msg })
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, active: false, warning: msg }) }
		}
		ctx.streamingChannelRtmp = { active: false, url: null, consumerIndex: null, lastError: msg }
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
		try {
			const res = await ctx.amcp.basic.add(ch, 'FILE', paramsAfterPath, STREAMING_RECORD_CONSUMER_INDEX)
			ctx.streamingChannelRecord = { active: true, path: absPath, channel: ch, outputId: outputId || null }
			ctx.log?.('info', `[Streaming channel] Record started ch${ch} → ${absPath}`)
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: true, recording: true, path: absPath, channel: ch, crf, amcp: res }),
			}
		} catch (e) {
			const msg = e?.message || String(e)
			ctx.log?.('warn', `[Streaming channel] Record start failed: ${msg}`)
			return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
		}
	}

	if (!ctx.streamingChannelRecord.active) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Not recording' }) }
	}
	try {
		const res = await ctx.amcp.basic.remove(ch, null, STREAMING_RECORD_CONSUMER_INDEX)
		const outPath = ctx.streamingChannelRecord.path
		ctx.streamingChannelRecord = { active: false, path: null, channel: null }
		ctx.log?.('info', `[Streaming channel] Record stopped ch${ch}`)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, recording: false, path: outPath, amcp: res }) }
	} catch (e) {
		const msg = e?.message || String(e)
		if (isRemoveNotFoundError(e)) {
			ctx.streamingChannelRecord = { active: false, path: null, channel: null }
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, recording: false, warning: msg }) }
		}
		ctx.streamingChannelRecord = { active: false, path: null, channel: null }
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
	STREAMING_RTMP_CONSUMER_INDEX,
	STREAMING_RECORD_CONSUMER_INDEX,
}
