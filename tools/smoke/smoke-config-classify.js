'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { classifyConfigKey, splitConfigForReplication, stripDeviceLocalFromProject } = require('../../src/config/config-classify')
const { SYSTEM_DISPLAY_KEYS } = require('../../src/api/settings-os')

test('device-local keys are never classified as show', () => {
	const deviceKeys = [
		'caspar',
		'casparServer',
		'deviceGraph',
		'gpuPhysicalTopology',
		'server',
		'screen_1_system_id',
		'screen_2_os_x',
		'multiview_os_mode',
		...SYSTEM_DISPLAY_KEYS,
	]
	for (const k of deviceKeys) {
		const tier = classifyConfigKey(k)
		assert.equal(tier, 'device', `expected device tier for ${k}, got ${tier}`)
	}
})

test('show keys classify as show', () => {
	for (const k of ['screenDestinations', 'audioRouting', 'streamOutputs', 'dmx']) {
		assert.equal(classifyConfigKey(k), 'show')
	}
})

test('splitConfigForReplication separates tiers', () => {
	const { shared, deviceLocal } = splitConfigForReplication({
		deviceGraph: { version: 1 },
		screenDestinations: { version: 1, destinations: [] },
		audioRouting: { version: 1 },
		screen_1_system_id: 'A',
		casparServer: { host: '127.0.0.1' },
	})
	assert.ok(deviceLocal.deviceGraph)
	assert.ok(shared.screenDestinations)
	assert.ok(shared.audioRouting)
	assert.equal(shared.deviceGraph, undefined)
	assert.ok(deviceLocal.screen_1_system_id)
	assert.ok(deviceLocal.casparServer)
})

test('stripDeviceLocalFromProject removes hardware device slices but keeps destinations', () => {
	const p = stripDeviceLocalFromProject({
		name: 'Show',
		hardwareConfig: {
			deviceGraph: { version: 1 },
			screenDestinations: { version: 1, destinations: [{ id: 'd1' }] },
			osDisplay: { screen_1_system_id: 'X' },
			casparServer: { host: '127.0.0.1' },
			streamOutputs: [{ id: 's1' }],
			audioRouting: { version: 1 },
		},
	})
	assert.equal(p.hardwareConfig.deviceGraph, undefined)
	assert.equal(p.hardwareConfig.screenDestinations.destinations[0].id, 'd1')
	assert.equal(p.hardwareConfig.osDisplay, undefined)
	assert.equal(p.hardwareConfig.casparServer, undefined)
	assert.equal(p.hardwareConfig.streamOutputs, undefined)
	assert.equal(p.hardwareConfig.audioRouting, undefined)
})
