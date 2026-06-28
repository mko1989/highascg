'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

test('replication-reconcile imports applyLiveIntentOnFollower for catch-up path', () => {
	const reconcile = require('../../src/replication/replication-reconcile')
	const mirror = require('../../src/replication/mirror-apply')
	assert.equal(typeof reconcile.applyLiveStateFromLeader, 'function')
	assert.equal(typeof reconcile.catchUpLiveStateFromLeader, 'function')
	assert.equal(typeof mirror.applyLiveIntentOnFollower, 'function')
})
