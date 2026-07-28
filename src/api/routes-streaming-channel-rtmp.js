'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getChannelMap } = require('../config/routing')
const { buildStreamingRtmpAddParams, buildStreamingSrtAddParams } = require('../streaming/streaming-channel-ffmpeg')
const { param } = require('../caspar/amcp-utils')
const {
	STREAMING_RTMP_CONSUMER_INDEX,
	isRemoveNotFoundError,
	resolveStreamOutputConfig,
	resolveSourceProgramAudioLayout,
} = require('./routes-streaming-channel-shared')
const { pushRtmpLog } = require('./routes-streaming-channel-log')
const { redactStreamUrl } = require('../streaming/streaming-channel-status')
const projectStore = require('../engine/project-store')
const { resolveStreamCredential } = require('../engine/project-stream-credentials')

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

function startStreamingStatusPoll(ctx) {
	stopStreamingStatusPoll(ctx)
	const ms = parseStreamStatusPollMs()
	if (!ms || !ctx.streamingChannelRtmp?.active) return
	ctx._streamingChannelRtmpPollTimer = setInterval(() => {
		void pollRtmpHealth(ctx)
	}, ms)
}

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
		// WO-261: credentials are resolved SERVER-side from the ACTIVE project (config is fallback-only).
		// The client no longer sends streamKey; a freshly typed (unsaved) rtmpServerUrl in the body is
		// accepted only as a last resort so the URL box still works before Save.
		const persistence = ctx.persistence || require('../utils/persistence')
		let activeProject = null
		try {
			activeProject = projectStore.loadProjectBySlug(persistence)
		} catch (_) {}
		const resolved = resolveStreamCredential(ctx.config || {}, activeProject, outputId || 'streamingChannel')
		const serverUrl = resolved.rtmpServerUrl || String(b.rtmpServerUrl || '').trim()
		const streamKey = resolved.streamKey
		const quality = String(b.quality || outCfg?.quality || 'medium').toLowerCase()
		// WO-172 T172.5: layout-aware downmix — resolve the cabled source's program-bus audio layout
		// (screenDestinations[].audioLayout) so non-stereo buses (e.g. this rig's discrete-8ch) get an
		// explicit pan= downmix instead of a blind stereo remix.
		const videoSource = String((ctx.config?.streamingChannel && ctx.config.streamingChannel.videoSource) || 'program_1')
		const programLayout = resolveSourceProgramAudioLayout(ctx.config || {}, videoSource)
		// WO-249 pair selection is per stream output (Devices-tab inspector / streamOutputs entry),
		// inheriting the streamingChannel value only as legacy fallback for configs that predate it.
		const VALID_PAIRS = new Set(['all', '1+2', '3+4', '5+6', '7+8'])
		const rawPair = String(
			b.audioSourcePair
			|| outCfg?.audioSourcePair
			|| (ctx.config?.streamingChannel && ctx.config.streamingChannel.audioSourcePair)
			|| 'all',
		).trim()
		const audioSourcePair = VALID_PAIRS.has(rawPair) ? rawPair : 'all'
		const encoderOpts = {
			videoCodec: b.videoCodec || outCfg?.videoCodec,
			videoBitrateKbps: b.videoBitrateKbps ?? outCfg?.videoBitrateKbps,
			encoderPreset: b.encoderPreset || outCfg?.encoderPreset,
			audioCodec: b.audioCodec || outCfg?.audioCodec,
			audioBitrateKbps: b.audioBitrateKbps ?? outCfg?.audioBitrateKbps,
			programLayout,
			audioSourcePair,
			logWarn: (msg, ctx) => pushRtmpLog(ctx, 'warn', msg, ctx),
		}
		// SRT shares the whole encoder pipeline with RTMP; only the container (mpegts) and the URL
		// differ, and there is no stream-key credential. The bundled Caspar links libsrt (ldd-verified
		// 2026-07-21) so ADD … STREAM srt:// runs in Caspar's own ffmpeg consumer.
		const outType = String(outCfg?.type || b.type || 'rtmp').toLowerCase()
		const built =
			outType === 'srt'
				? buildStreamingSrtAddParams(String(b.srtUrl || outCfg?.srtUrl || '').trim(), quality, {
						...encoderOpts,
						latencyMs: b.srtLatencyMs ?? outCfg?.srtLatencyMs,
						streamId: b.srtStreamId ?? outCfg?.srtStreamId,
						mode: b.srtMode ?? outCfg?.srtMode,
						// WO-307: resolved server-side ONLY, same rule as `streamKey` above — the
						// client never sends a passphrase on Start, saved or otherwise.
						passphrase: resolved.srtPassphrase,
					})
				: buildStreamingRtmpAddParams(serverUrl, streamKey, quality, encoderOpts)
		if (!built) {
			return {
				status: 400,
				headers: JSON_HEADERS,
				body: jsonBody({
					error: outType === 'srt' ? 'srtUrl required (srt://host:port)' : 'rtmpServerUrl and streamKey required',
				}),
			}
		}
		const params = `${param(built.url)} ${built.args}`.trim()
		const addWithIdxCmd = `ADD ${ch}-${STREAMING_RTMP_CONSUMER_INDEX} STREAM ${params}`
		const addNoIdxCmd = `ADD ${ch} STREAM ${params}`
		/** @param {string} cmd @returns {string} same line with the stream key masked */
		const maskCmd = (cmd) => String(cmd).split(built.url).join(redactStreamUrl(built.url))
		// WO-172 T172.7: full ADD line + resolved source channel + layout, at error level visibility
		// (info) so an ffprobe-style audio complaint can be cross-checked against exactly what was sent.
		/* The command carries the destination URL, and therefore the STREAM KEY. `url` was already
		 * redacted here while `command` shipped the key verbatim into the journal and Caspar's log
		 * — observed 2026-07-20 with a live YouTube key. Redact the URL inside the command too;
		 * the ADD line stays readable for the WO-172 cross-check it exists for. */
		const redactedCmd = maskCmd(addWithIdxCmd)
		pushRtmpLog(ctx, 'info', `RTMP start requested on ch${ch} (source=${videoSource}, layout=${programLayout})`, {
			url: redactStreamUrl(built.url),
			quality,
			channel: ch,
			source: videoSource,
			programLayout,
			command: redactedCmd,
		})
		try {
			let res
			let usedIndex = STREAMING_RTMP_CONSUMER_INDEX
			try {
				res = await ctx.amcp.raw(addWithIdxCmd)
				pushRtmpLog(ctx, 'debug', 'AMCP ADD STREAM with consumer index accepted', { command: maskCmd(addWithIdxCmd) })
			} catch (e1) {
				const msg1 = e1?.message || String(e1)
				pushRtmpLog(ctx, 'warn', 'AMCP ADD with consumer index failed, trying fallback syntax', {
					command: maskCmd(addWithIdxCmd),
					error: msg1,
				})
				res = await ctx.amcp.raw(addNoIdxCmd)
				usedIndex = null
				pushRtmpLog(ctx, 'debug', 'AMCP ADD STREAM without consumer index accepted', { command: maskCmd(addNoIdxCmd) })
			}
			ctx.streamingChannelRtmp = { active: true, url: built.url, consumerIndex: usedIndex, lastError: null, outputId: outputId || null }
			ctx.log?.('info', `[Streaming channel] RTMP started ch${ch}`)
			pushRtmpLog(ctx, 'info', `RTMP started on ch${ch}`, { url: redactStreamUrl(built.url), consumerIndex: usedIndex })
			startStreamingStatusPoll(ctx)
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: true, active: true, url: redactStreamUrl(built.url), amcp: res }),
			}
		} catch (e) {
			const msg = e?.message || String(e)
			ctx.streamingChannelRtmp = { ...ctx.streamingChannelRtmp, active: false, lastError: msg }
			ctx.log?.('warn', `[Streaming channel] RTMP start failed: ${msg}`)
			pushRtmpLog(ctx, 'error', `RTMP start failed on ch${ch}`, { error: msg, command: maskCmd(addNoIdxCmd) })
			stopStreamingStatusPoll(ctx)
			return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
		}
	}

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
		} catch {
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

module.exports = {
	handlePostRtmp,
	stopStreamingStatusPoll,
}
