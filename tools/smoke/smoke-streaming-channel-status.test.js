'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	redactStreamUrl,
	redactAmcpStreamCommand,
	buildStreamingChannelStatusPayload,
} = require('../../src/streaming/streaming-channel-status')

test('redactStreamUrl masks final path segment', () => {
	assert.equal(redactStreamUrl('rtmp://live.example.com/app/my-secret-key'), 'rtmp://live.example.com/app/****')
	assert.equal(redactStreamUrl('rtmps://a.b/c/d/key123'), 'rtmps://a.b/c/d/****')
})

test('redactAmcpStreamCommand masks key inside quoted STREAM url', () => {
	const cmd = 'ADD 5-97 STREAM "rtmp://host/app/secret" -codec:v libx264'
	assert.equal(
		redactAmcpStreamCommand(cmd),
		'ADD 5-97 STREAM "rtmp://host/app/****" -codec:v libx264',
	)
})

test('buildStreamingChannelStatusPayload includes record.logs array', () => {
	const ctx = {
		config: { streamingChannel: { enabled: true, videoSource: 'program_1' }, screen_count: 1 },
		streamingChannelRtmp: { active: false },
		streamingChannelRecord: { active: true, path: '/media/rec.mp4', outputId: 'rec_1' },
		_streamingChannelLogs: {
			rtmp: [{ ts: 't', level: 'info', message: 'x' }],
			record: [{ ts: 't', level: 'info', message: 'rec start' }],
		},
	}
	const p = buildStreamingChannelStatusPayload(ctx)
	assert.ok(Array.isArray(p.rtmp.logs))
	assert.ok(Array.isArray(p.record.logs))
	assert.equal(p.record.logs.length, 1)
	assert.equal(p.rtmp.url, null)
})
