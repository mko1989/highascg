'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { notifyReplicationStatusChanged } = require('../../src/replication/replication-ui-notify')

test('notifyReplicationStatusChanged broadcasts replication_status on operator ws', () => {
	const events = []
	const ctx = {
		_wsBroadcast(event, data) {
			events.push({ event, data })
		},
	}
	notifyReplicationStatusChanged(ctx, 'peer-ws-connected')
	assert.equal(events.length, 1)
	assert.equal(events[0].event, 'replication_status')
	assert.equal(events[0].data.hint, 'peer-ws-connected')
})
