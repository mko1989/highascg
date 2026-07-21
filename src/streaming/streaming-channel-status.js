'use strict'

const { getChannelMap, resolveStreamingChannelRoute, resolveStreamingChannelRouteForRole } = require('../config/routing')
// WO-307: redaction logic lives in a zero-dependency leaf module so the AMCP transport layer
// (amcp-client-transport.js) can require it directly without pulling in ../config/routing.
const { redactStreamUrl, redactAmcpStreamCommand } = require('./stream-secret-redact')

/**
 * @param {unknown} extra
 */
function sanitizeLogExtra(extra) {
	if (!extra || typeof extra !== 'object') return extra
	const out = { ...extra }
	if (out.url != null) out.url = redactStreamUrl(out.url)
	if (typeof out.command === 'string') out.command = redactAmcpStreamCommand(out.command)
	return out
}

/**
 * @param {object} ctx
 * @param {{ rtmpConsumerIndex?: number, recordConsumerIndex?: number }} [opts]
 */
function buildStreamingChannelStatusPayload(ctx, opts = {}) {
	const rtmpIdx = opts.rtmpConsumerIndex ?? 97
	const recordIdx = opts.recordConsumerIndex ?? 96
	const map = getChannelMap(ctx.config || {}, ctx.switcherOutputBusByChannel)
	const rtmp = ctx.streamingChannelRtmp || { active: false }
	const recordSessions =
		ctx.streamingChannelRecords && typeof ctx.streamingChannelRecords === 'object'
			? ctx.streamingChannelRecords
			: {}
	const legacyRec = ctx.streamingChannelRecord || { active: false }
	const activeRecordEntries = Object.entries(recordSessions).filter(([, s]) => s?.active)
	if (!activeRecordEntries.length && legacyRec.active) {
		const key = String(legacyRec.outputId || '_legacy').trim() || '_legacy'
		activeRecordEntries.push([key, legacyRec])
	}
	const activeRecordOutputs = activeRecordEntries.map(([id]) => id)
	const primaryRec = activeRecordEntries[0]?.[1] || legacyRec
	const logs =
		ctx._streamingChannelLogs && typeof ctx._streamingChannelLogs === 'object'
			? ctx._streamingChannelLogs
			: { rtmp: [], record: [] }
	const vRoute = resolveStreamingChannelRoute(ctx.config || {})
	const aRoute = resolveStreamingChannelRouteForRole(ctx.config || {}, 'audio')
	const sc =
		ctx.config?.streamingChannel && typeof ctx.config.streamingChannel === 'object'
			? ctx.config.streamingChannel
			: {}
	return {
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
			url: rtmp.url ? redactStreamUrl(rtmp.url) : null,
			outputId: rtmp.outputId || null,
			consumerIndex: rtmp.consumerIndex ?? rtmpIdx,
			lastError: rtmp.lastError || null,
			logs: Array.isArray(logs.rtmp) ? logs.rtmp : [],
		},
		record: {
			active: activeRecordOutputs.length > 0,
			activeOutputs: activeRecordOutputs,
			path: primaryRec.path || null,
			outputId: primaryRec.outputId || activeRecordOutputs[0] || null,
			channel: primaryRec.channel ?? null,
			lastError: primaryRec.lastError || null,
			sessions: activeRecordEntries.map(([id, s]) => ({
				outputId: id,
				path: s.path || null,
				channel: s.channel ?? null,
				consumerIndex: s.consumerIndex ?? recordIdx,
			})),
			logs: Array.isArray(logs.record) ? logs.record : [],
		},
	}
}

module.exports = {
	redactStreamUrl,
	redactAmcpStreamCommand,
	sanitizeLogExtra,
	buildStreamingChannelStatusPayload,
}
