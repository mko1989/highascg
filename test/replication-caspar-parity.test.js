'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { compareCasparParity } = require('../src/replication/caspar-parity')

test('compareCasparParity flags backup needing more channels', () => {
	const leader = [
		{ index: 1, videoMode: '1080p5000' },
		{ index: 2, videoMode: '1080p5000' },
		{ index: 3, videoMode: '1080p5000' },
	]
	const follower = [{ index: 1, videoMode: '1080p5000' }]
	const out = compareCasparParity(leader, follower)
	assert.equal(out.ok, false)
	assert.equal(out.followerNeedsMoreChannels, true)
	assert.equal(out.missingCount, 2)
	assert.match(out.mismatches[0].message, /needs 2 more/)
})

test('compareCasparParity ok when channel count and video-mode match', () => {
	const channels = [
		{ index: 1, videoMode: '1080p5000' },
		{ index: 2, videoMode: '1080p5000' },
	]
	const out = compareCasparParity(channels, channels)
	assert.equal(out.ok, true)
})

test('compareCasparParity reports video-mode mismatch', () => {
	const leader = [{ index: 1, videoMode: '1080p6000' }]
	const follower = [{ index: 1, videoMode: '1080p5000' }]
	const out = compareCasparParity(leader, follower)
	assert.equal(out.ok, false)
	assert.equal(out.mismatches.some((m) => m.kind === 'video_mode'), true)
})
