'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { classifyConfigKey, splitConfigForReplication, stripDeviceLocalFromProject } = require('../../src/config/config-classify')
const { SYSTEM_DISPLAY_KEYS } = require('../../src/api/settings-os')

test('device-local keys are never classified as show', () => {
	const deviceKeys = [
		'caspar',
		'casparServer',
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
	for (const k of ['deviceGraph', 'screenDestinations', 'audioRouting']) {
		assert.equal(classifyConfigKey(k), 'show')
	}
})

test('splitConfigForReplication separates tiers', () => {
	const { shared, deviceLocal } = splitConfigForReplication({
		deviceGraph: { version: 1 },
		screen_1_system_id: 'A',
		casparServer: { host: '127.0.0.1' },
	})
	assert.ok(shared.deviceGraph)
	assert.ok(deviceLocal.screen_1_system_id)
	assert.ok(deviceLocal.casparServer)
})

test('stripDeviceLocalFromProject removes hardware device slices', () => {
	const p = stripDeviceLocalFromProject({
		name: 'Show',
		hardwareConfig: {
			deviceGraph: { version: 1 },
			osDisplay: { screen_1_system_id: 'X' },
			casparServer: { host: '127.0.0.1' },
		},
	})
	assert.ok(p.hardwareConfig.deviceGraph)
	assert.equal(p.hardwareConfig.osDisplay, undefined)
	assert.equal(p.hardwareConfig.casparServer, undefined)
})
