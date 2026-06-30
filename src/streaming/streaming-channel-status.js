'use strict'

const { getChannelMap, resolveStreamingChannelRoute, resolveStreamingChannelRouteForRole } = require('../config/routing')

/**
 * Mask RTMP stream key in URL path (last segment). Server keeps full URL internally for AMCP REMOVE.
 * @param {unknown} url
 */
function redactStreamUrl(url) {
	const s = String(url || '').trim()
	if (!s) return s
	try {
		const u = new URL(s.replace(/^rtmps?:\/\//i, 'https://').replace(/^rtmp:\/\//i, 'http://'))
		const parts = u.pathname.split('/').filter(Boolean)
		if (parts.length >= 2) {
			parts[parts.length - 1] = '****'
			const scheme = /^rtmps:/i.test(s) ? 'rtmps' : 'rtmp'
			return `${scheme}://${u.host}/${parts.join('/')}`
		}
	} catch {
		/* fall through */
	}
	const slash = s.lastIndexOf('/')
	if (slash > 'rtmp://'.length) return `${s.slice(0, slash + 1)}****`
	return s
}

/**
 * Redact stream keys inside quoted AMCP STREAM params.
 * @param {unknown} command
 */
function redactAmcpStreamCommand(command) {
	const s = String(command || '')
	if (!s) return s
	return s.replace(/(STREAM\s+"[^"]*\/)([^"/?#]+)(")/gi, '$1****$3')
}

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
	const rec = ctx.streamingChannelRecord || { active: false }
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
			active: !!rec.active,
			path: rec.path || null,
			outputId: rec.outputId || null,
			channel: rec.channel ?? null,
			lastError: rec.lastError || null,
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
