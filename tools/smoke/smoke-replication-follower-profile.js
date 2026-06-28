'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const {
	mergeLocalHardwareIntoProject,
	pickLocalSlices,
	LOCAL_PROFILE_PATH,
} = require('../../src/replication/follower-machine-profile')

test('pickLocalSlices keeps device and routing slices only', () => {
	const picked = pickLocalSlices({
		version: 2,
		deviceGraph: { connectors: [{ id: 'c1' }], edges: [] },
		screenDestinations: { version: 1, destinations: [{ id: 'd1' }] },
		streamOutputs: [{ id: 's1' }],
		scenes: { should: 'drop' },
	})
	assert.equal(picked.deviceGraph.connectors[0].id, 'c1')
	assert.equal(picked.streamOutputs[0].id, 's1')
	assert.equal(picked.screenDestinations, undefined)
	assert.equal(picked.scenes, undefined)
})

test('mergeLocalHardwareIntoProject overlays follower machine profile', () => {
	const merged = mergeLocalHardwareIntoProject(
		{ name: 'Show', hardwareConfig: { version: 2, deviceGraph: { connectors: [{ id: 'old' }] } } },
		{
			version: 2,
			deviceGraph: { connectors: [{ id: 'local' }], edges: [] },
		},
	)
	assert.equal(merged.hardwareConfig.deviceGraph.connectors[0].id, 'local')
	assert.equal(merged.hardwareConfig.screenDestinations, undefined)
	assert.equal(merged.name, 'Show')
})

test('LOCAL_PROFILE_PATH lives under config/', () => {
	assert.ok(String(LOCAL_PROFILE_PATH).endsWith(path.join('config', 'replication-local-machine.json')))
})
