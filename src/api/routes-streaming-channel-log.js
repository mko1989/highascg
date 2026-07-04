'use strict'

const path = require('path')
const { buildStreamingChannelStatusPayload, sanitizeLogExtra } = require('../streaming/streaming-channel-status')
const streamLog = require('../utils/buffered-logger').streaming
const { getMediaIngestBasePath } = require('../media/local-media')
const {
	STREAMING_RTMP_CONSUMER_INDEX,
	STREAMING_RECORD_CONSUMER_INDEX,
} = require('./routes-streaming-channel-shared')

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

function absPathToMediaId(config, absPath) {
	if (!absPath) return ''
	const base = getMediaIngestBasePath(config)
	const rel = path.relative(base, absPath)
	if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return path.basename(String(absPath))
	return rel.replace(/\\/g, '/')
}

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

module.exports = {
	broadcastStreamingChannelStatus,
	broadcastRecordStopped,
	pushRtmpLog,
	pushRecordLog,
}
