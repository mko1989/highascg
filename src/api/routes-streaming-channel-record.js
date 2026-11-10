'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getChannelMap } = require('../config/routing')
const { buildStreamingChannelStatusPayload } = require('../streaming/streaming-channel-status')
const { param } = require('../caspar/amcp-utils')
const {
	STREAMING_RTMP_CONSUMER_INDEX,
	STREAMING_RECORD_CONSUMER_INDEX,
	isRemoveNotFoundError,
	joinCasparMediaFile,
	localDateTimeStampForFilename,
	safeFileStem,
	resolveCasparMediaDir,
	recordFfmpegArgs,
	resolveRecordOutputConfig,
	ensureRecordSessions,
	recordSessionKey,
	allocateRecordConsumerIndex,
	resolveRecordSourceChannel,
	resolveSourceProgramAudioLayout,
} = require('./routes-streaming-channel-shared')
const { pushRecordLog, broadcastRecordStopped } = require('./routes-streaming-channel-log')

/** The record file's name under Caspar's media folder: in the active show's folder for a `folder: 'project'` row. */
function recordRelativeName(ctx, outCfg, mediaDir, fileName, deps = {}) {
	if (String(outCfg?.folder || '') !== 'project') return fileName
	const path = require('path')
	let projectDir
	try {
		projectDir = (deps.ensureProjectMediaDir || require('../media/project-media-root').ensureProjectMediaDir)(ctx.config, '', ctx.persistence || require('../utils/persistence'))
	} catch {
		projectDir = null
	}
	const rel = projectDir ? path.relative(path.resolve(mediaDir), path.resolve(projectDir)) : ''
	if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
		ctx.log?.('warn', '[Streaming channel] Record: no project folder under the media folder, recording into the media root')
		return fileName
	}
	return `${rel.split(path.sep).join('/')}/${fileName}`
}

async function handlePostRecord(body, ctx) {
	if (!ctx.amcp) {
		return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
	}
	const map = getChannelMap(ctx.config || {}, ctx.switcherOutputBusByChannel)
	const b = parseBody(body)
	const action = b.action === 'stop' ? 'stop' : 'start'
	const outputId = String(b.outputId || '').trim()
	const outCfg = resolveRecordOutputConfig(ctx.config || {}, outputId)
	let ch
	try {
		ch = outputId ? resolveRecordSourceChannel(ctx, outputId) : map.streamingCh
	} catch (e) {
		if (e?.code === 'NOT_HERE') return require('./screen-not-here').notHereReply(ctx, e) // WO-1029 C1c
		throw e
	}
	if (ch == null) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'No recording source channel available' }) }
	}

	const sessions = ensureRecordSessions(ctx)
	const sessionKey = recordSessionKey(outputId, outCfg)

	if (action === 'start') {
		if (sessions[sessionKey]?.active) {
			return {
				status: 400,
				headers: JSON_HEADERS,
				body: jsonBody({ error: `Record output ${sessionKey} is already recording — stop it first` }),
			}
		}
		const consumerIndex = allocateRecordConsumerIndex(sessions, ch)
		if (consumerIndex == null) {
			return {
				status: 400,
				headers: JSON_HEADERS,
				body: jsonBody({
					error: `No free FILE consumer slot on channel ${ch} (max ${STREAMING_RECORD_CONSUMER_INDEX - 89} simultaneous records per channel)`,
				}),
			}
		}
		const crf =
			b.crf != null && Number.isFinite(Number(b.crf))
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
		// WO-1031 (owner: "H.264 to the project folder"): a row with folder 'project' records into the active show's
		// media folder (media/projects/<slug>/), so the recording travels with the show's media. Caspar's FILE consumer
		// takes a path under its media folder; a project folder outside it (or none) falls back to the media root.
		const relName = recordRelativeName(ctx, outCfg, dir, fileName)
		const absPath = joinCasparMediaFile(dir, relName)
		// WO-172 T172.5: layout-aware downmix — resolve the cabled source's program-bus audio layout
		// (screenDestinations[].audioLayout) so non-stereo buses (e.g. this rig's discrete-8ch) get an
		// explicit pan= downmix instead of a blind stereo remix.
		const recordSource = String(outCfg?.source || 'program_1')
		const programLayout = resolveSourceProgramAudioLayout(ctx.config || {}, recordSource)
		const args = recordFfmpegArgs({
			crf,
			videoCodec: b.videoCodec || outCfg?.videoCodec,
			videoBitrateKbps: b.videoBitrateKbps ?? outCfg?.videoBitrateKbps,
			encoderPreset: b.encoderPreset || outCfg?.encoderPreset,
			audioCodec: b.audioCodec || outCfg?.audioCodec,
			audioBitrateKbps: b.audioBitrateKbps ?? outCfg?.audioBitrateKbps,
			programLayout,
		})
		const paramsAfterPath = `${param(relName)} ${args}`
		const addCmd = `ADD ${ch}-${consumerIndex} FILE ${paramsAfterPath}`
		// WO-172 T172.7: full ADD line + resolved source channel + layout, at error level visibility
		// (info) so an ffprobe-style audio complaint can be cross-checked against exactly what was sent.
		pushRecordLog(ctx, 'info', `Record start requested on ch${ch} (source=${recordSource}, layout=${programLayout})`, {
			path: absPath,
			outputId: sessionKey,
			crf,
			consumerIndex,
			source: recordSource,
			programLayout,
			command: addCmd,
		})
		try {
			const res = await ctx.amcp.basic.add(ch, 'FILE', paramsAfterPath, consumerIndex)
			sessions[sessionKey] = {
				active: true,
				path: absPath,
				channel: ch,
				outputId: sessionKey,
				lastError: null,
				consumerIndex,
			}
			ctx.streamingChannelRecord = sessions[sessionKey]
			ctx.log?.('info', `[Streaming channel] Record started ch${ch} → ${absPath} (${sessionKey})`)
			pushRecordLog(ctx, 'info', `Record started on ch${ch}`, { path: absPath, outputId: sessionKey, consumerIndex })
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({
					ok: true,
					recording: true,
					path: absPath,
					channel: ch,
					outputId: sessionKey,
					crf,
					amcp: res,
					status: buildStreamingChannelStatusPayload(ctx, {
						rtmpConsumerIndex: STREAMING_RTMP_CONSUMER_INDEX,
						recordConsumerIndex: STREAMING_RECORD_CONSUMER_INDEX,
					}),
				}),
			}
		} catch (e) {
			const msg = e?.message || String(e)
			sessions[sessionKey] = { active: false, path: null, channel: ch, outputId: sessionKey, lastError: msg, consumerIndex }
			ctx.streamingChannelRecord = { active: false, path: null }
			ctx.log?.('warn', `[Streaming channel] Record start failed: ${msg}`)
			pushRecordLog(ctx, 'error', `Record start failed on ch${ch}`, { error: msg, command: addCmd, outputId: sessionKey })
			return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
		}
	}

	const session = sessions[sessionKey]
	if (!session?.active) {
		const fallbackKey = Object.keys(sessions).find((k) => sessions[k]?.active)
		if (!outputId && fallbackKey) {
			return await handlePostRecord(JSON.stringify({ action: 'stop', outputId: fallbackKey }), ctx)
		}
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Not recording' }) }
	}
	const recCh = session.channel ?? ch
	const recIdx = Number.isFinite(Number(session.consumerIndex)) ? Number(session.consumerIndex) : STREAMING_RECORD_CONSUMER_INDEX
	try {
		const res = await ctx.amcp.basic.remove(recCh, null, recIdx)
		const outPath = session.path
		sessions[sessionKey] = { active: false, path: null, channel: null, outputId: sessionKey, lastError: null, consumerIndex: recIdx }
		const anyActive = Object.values(sessions).some((s) => s?.active)
		ctx.streamingChannelRecord = anyActive
			? Object.values(sessions).find((s) => s?.active) || { active: false, path: null }
			: { active: false, path: null }
		ctx.log?.('info', `[Streaming channel] Record stopped ch${recCh} (${sessionKey})`)
		pushRecordLog(ctx, 'info', `Record stopped on ch${recCh}`, { path: outPath, outputId: sessionKey })
		broadcastRecordStopped(ctx, outPath)
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: true,
				recording: false,
				path: outPath,
				outputId: sessionKey,
				amcp: res,
				status: buildStreamingChannelStatusPayload(ctx, {
					rtmpConsumerIndex: STREAMING_RTMP_CONSUMER_INDEX,
					recordConsumerIndex: STREAMING_RECORD_CONSUMER_INDEX,
				}),
			}),
		}
	} catch (e) {
		const msg = e?.message || String(e)
		if (isRemoveNotFoundError(e)) {
			const outPath = session.path
			sessions[sessionKey] = { active: false, path: null, channel: null, outputId: sessionKey, lastError: null, consumerIndex: recIdx }
			const anyActive = Object.values(sessions).some((s) => s?.active)
			ctx.streamingChannelRecord = anyActive
				? Object.values(sessions).find((s) => s?.active) || { active: false, path: null }
				: { active: false, path: null }
			pushRecordLog(ctx, 'warn', `Record stop fallback: file consumer already absent on ch${recCh}`, {
				path: outPath,
				error: msg,
				outputId: sessionKey,
			})
			broadcastRecordStopped(ctx, outPath)
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({
					ok: true,
					recording: false,
					warning: msg,
					outputId: sessionKey,
					status: buildStreamingChannelStatusPayload(ctx, {
						rtmpConsumerIndex: STREAMING_RTMP_CONSUMER_INDEX,
						recordConsumerIndex: STREAMING_RECORD_CONSUMER_INDEX,
					}),
				}),
			}
		}
		sessions[sessionKey] = { active: false, path: null, channel: null, outputId: sessionKey, lastError: msg, consumerIndex: recIdx }
		ctx.streamingChannelRecord = { active: false, path: null, channel: null, lastError: msg }
		pushRecordLog(ctx, 'error', `Record stop failed on ch${recCh}`, { error: msg, outputId: sessionKey })
		return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
	}
}

module.exports = {
	handlePostRecord,
	recordRelativeName,
}
