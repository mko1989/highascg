'use strict'

/**
 * The hardware-reconcile modal was appearing on every startup on a machine whose project was saved
 * before the hostname migration. ensureHardwareHostname() rewrites `highascg-nvidia-*` to the
 * MAC-derived `highascg####`, and isLikelySameMachine() compared hostnames only — so the box no
 * longer recognised its own saved project, sameMachine went false, and project-import-flow's
 * bootstrap/reconnect suppression never fired.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const MISMATCH_SRC = path.join(__dirname, '..', '..', 'client', 'lib', 'project-hardware-mismatch.js')

/** @returns {Promise<{ isLikelySameMachine: Function }>} */
async function loadModule() {
	return import('file://' + MISMATCH_SRC)
}

function liveCtx(host) {
	return { deviceSnapBuild: { host }, deviceViewSnap: null, settings: null }
}

test('hardwareId identifies the machine across a hostname rename', async () => {
	const { isLikelySameMachine } = await loadModule()
	const saved = { fingerprint: { hostname: 'highascg-nvidia-595', hardwareId: '7579', mac: '10:7c:61:3e:b9:db' } }
	assert.equal(
		isLikelySameMachine(saved, liveCtx({ hostname: 'highascg7579', hardwareId: '7579' })),
		true,
		'same hardwareId, renamed host → same machine',
	)
	assert.equal(
		isLikelySameMachine(saved, liveCtx({ hostname: 'highascg1234', hardwareId: '1234' })),
		false,
		'different hardwareId → genuinely a different machine, modal SHOULD appear',
	)
})

test('MAC matches when hardwareId is absent from the live side', async () => {
	const { isLikelySameMachine } = await loadModule()
	const saved = { fingerprint: { hostname: 'highascg-nvidia-595', mac: '10:7C:61:3E:B9:DB' } }
	assert.equal(
		isLikelySameMachine(saved, liveCtx({ hostname: 'highascg7579', mac: '10:7c:61:3e:b9:db' })),
		true,
		'MAC compare is case-insensitive',
	)
	assert.equal(isLikelySameMachine(saved, liveCtx({ hostname: 'highascg7579', mac: 'aa:bb:cc:dd:ee:ff' })), false)
})

test('legacy projects with no stable id are still recognised after the rename', async () => {
	const { isLikelySameMachine } = await loadModule()
	/* This is the case the owner actually hit: saved long before hardwareId existed. */
	for (const legacy of ['highascg-nvidia-595', 'casparcg']) {
		assert.equal(
			isLikelySameMachine({ fingerprint: { hostname: legacy } }, liveCtx({ hostname: 'highascg7579' })),
			true,
			`legacy hostname ${legacy} vs migrated host → same machine`,
		)
	}
	assert.equal(
		isLikelySameMachine({ fingerprint: { hostname: 'someone-elses-box' } }, liveCtx({ hostname: 'highascg7579' })),
		false,
		'an unrelated hostname must NOT be waved through',
	)
})

test('identical hostnames and missing data behave as before', async () => {
	const { isLikelySameMachine } = await loadModule()
	assert.equal(isLikelySameMachine({ fingerprint: { hostname: 'highascg7579' } }, liveCtx({ hostname: 'highascg7579' })), true)
	assert.equal(isLikelySameMachine({ fingerprint: {} }, liveCtx({ hostname: 'highascg7579' })), false)
	assert.equal(isLikelySameMachine({ fingerprint: { hostname: 'highascg7579' } }, liveCtx({})), false)
})
