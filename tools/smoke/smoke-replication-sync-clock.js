'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { updateClockOffsetFromPing, leaderTimeToLocal } = require('../../src/replication/sync-clock')

test('leaderTimeToLocal converts leader timestamps to local wall clock', () => {
	const runtime = { clockOffsetMs: 0 }
	updateClockOffsetFromPing(runtime, 1_000_000, { serverTimeMs: 1_000_416 })
	assert.equal(runtime.clockOffsetMs, 416)
	assert.equal(leaderTimeToLocal(runtime, 1_000_416), 1_000_000)
	assert.equal(leaderTimeToLocal(runtime, 1_001_916), 1_001_500)
})
