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

test('buildStreamingChannelStatusPayload includes record.logs and activeOutputs', () => {
	const ctx = {
		config: { streamingChannel: { enabled: true, videoSource: 'program_1' }, screen_count: 1 },
		streamingChannelRtmp: { active: false },
		streamingChannelRecords: {
			rec_1: { active: true, path: '/media/a.mp4', outputId: 'rec_1', channel: 3, consumerIndex: 96 },
			rec_2: { active: true, path: '/media/b.mp4', outputId: 'rec_2', channel: 5, consumerIndex: 96 },
		},
		_streamingChannelLogs: {
			rtmp: [{ ts: 't', level: 'info', message: 'x' }],
			record: [{ ts: 't', level: 'info', message: 'rec start' }],
		},
	}
	const p = buildStreamingChannelStatusPayload(ctx)
	assert.ok(Array.isArray(p.rtmp.logs))
	assert.ok(Array.isArray(p.record.logs))
	assert.equal(p.record.logs.length, 1)
	assert.deepEqual(p.record.activeOutputs.sort(), ['rec_1', 'rec_2'])
	assert.equal(p.record.active, true)
	assert.equal(p.rtmp.url, null)
})
