'use strict'

const { JSON_HEADERS, jsonBody } = require('./response')
const { buildStreamingChannelStatusPayload } = require('../streaming/streaming-channel-status')
const { handlePostRtmp } = require('./routes-streaming-channel-rtmp')
const { handlePostRecord } = require('./routes-streaming-channel-record')
const {
	broadcastStreamingChannelStatus,
	pushRtmpLog,
	pushRecordLog,
} = require('./routes-streaming-channel-log')
const {
	STREAMING_RTMP_CONSUMER_INDEX,
	STREAMING_RECORD_CONSUMER_INDEX,
} = require('./routes-streaming-channel-shared')

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

async function handle(method, p, body, ctx) {
	if (method === 'GET' && p === '/api/streaming-channel') return handleGet(ctx)
	if (method === 'POST' && p === '/api/streaming-channel/rtmp') return handlePostRtmp(body, ctx)
	if (method === 'POST' && p === '/api/streaming-channel/record') return handlePostRecord(body, ctx)
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
