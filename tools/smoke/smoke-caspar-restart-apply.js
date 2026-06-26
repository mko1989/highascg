'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
	resolveApplyDisconnectWaitMs,
	resolveApplyReconnectWaitMs,
	reloadCasparAfterConfigWrite,
} = require('../../src/utils/caspar-restart')

test('apply restart waits: defaults avoid 90s hang window', () => {
	assert.equal(resolveApplyDisconnectWaitMs(), 4_000)
	assert.equal(resolveApplyReconnectWaitMs(), 45_000)
})

test('reloadCasparAfterConfigWrite: no amcp client', async () => {
	const res = await reloadCasparAfterConfigWrite({}, { log: () => {} })
	assert.deepEqual(res, {
		attempted: false,
		restartSent: false,
		disconnected: true,
		reconnected: false,
	})
})

test('full-config-apply imports reloadCasparAfterConfigWrite', () => {
	const src = require('fs').readFileSync(
		require('path').join(__dirname, '../../src/utils/full-config-apply.js'),
		'utf8',
	)
	assert.match(src, /reloadCasparAfterConfigWrite/)
	assert.doesNotMatch(src, /reconnectMs:\s*90_000/)
})
