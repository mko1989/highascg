'use strict'

const fs = require('node:fs')
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

test('caspar-restart exports systemd fallback helpers', () => {
	const mod = require('../../src/utils/caspar-restart')
	assert.equal(typeof mod.isCasparSystemdServerActive, 'function')
	assert.equal(typeof mod.restartCasparViaSystemd, 'function')
	assert.equal(typeof mod.isCasparSystemdControlInstalled, 'function')
})

test('reloadCasparAfterConfigWrite triggers systemd when supervisor down', () => {
	const src = fs.readFileSync(require('path').join(__dirname, '../../src/utils/caspar-restart.js'), 'utf8')
	assert.match(src, /restartCasparViaSystemd/)
	assert.match(src, /casparcg-server inactive/)
	assert.match(src, /post-nodm path/)
})

test('full-config-apply imports reloadCasparAfterConfigWrite', () => {
	const src = require('fs').readFileSync(
		require('path').join(__dirname, '../../src/utils/full-config-apply.js'),
		'utf8',
	)
	assert.match(src, /reloadCasparAfterConfigWrite/)
	assert.doesNotMatch(src, /reconnectMs:\s*90_000/)
})
