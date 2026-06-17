'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildStreamingRtmpFfmpegArgs } = require('../../src/streaming/streaming-channel-ffmpeg')

test('RTMP ffmpeg args use Caspar-forwarded -codec:v and -format flv (YouTube H.264)', () => {
	const args = buildStreamingRtmpFfmpegArgs('medium', { videoBitrateKbps: 4500, fps: 50 })
	assert.match(args, /-codec:v libx264/)
	assert.doesNotMatch(args, /-c:v /)
	assert.match(args, /-format flv/)
	assert.doesNotMatch(args, /-f flv/)
	assert.match(args, /-g:v 100/)
	assert.match(args, /-x264-params:v .*repeat-headers=1/)
	assert.match(args, /-filter:v format=yuv420p/)
	assert.doesNotMatch(args, /libx265/)
})

test('RTMP ignores hevc request — YouTube ingest requires H.264', () => {
	const args = buildStreamingRtmpFfmpegArgs('high', { videoCodec: 'hevc' })
	assert.match(args, /-codec:v libx264/)
	assert.doesNotMatch(args, /libx265/)
})
