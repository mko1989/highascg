'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	stripDeviceLocalFromProject,
	mergeSharedProjectIntoLocal,
} = require('../../src/config/config-classify')

test('mergeSharedProjectIntoLocal preserves device-local hardware slices', () => {
	const existing = {
		name: 'Show',
		scenes: { s1: { id: 's1' } },
		hardwareConfig: {
			version: 2,
			deviceGraph: { nodes: [], edges: [] },
			screenDestinations: { version: 1, destinations: [{ id: 'dest-local' }] },
			streamOutputs: [{ id: 'local-stream' }],
			osDisplay: { screen_1_system_id: 'DP-1-local' },
			casparServer: { host: '127.0.0.1', port: 5250 },
			gpuPhysicalTopology: { gpus: [] },
			fingerprint: { hostname: 'follower-box' },
		},
	}
	const incoming = {
		name: 'Show Updated',
		scenes: { s1: { id: 's1', label: 'new' }, s2: { id: 's2' } },
		hardwareConfig: {
			version: 2,
			deviceGraph: { nodes: [{ id: 'n1' }], edges: [] },
			screenDestinations: { version: 1, destinations: [{ id: 'dest-leader' }] },
			streamOutputs: [{ id: 'leader-stream' }],
		},
	}
	const merged = mergeSharedProjectIntoLocal(existing, incoming)
	assert.equal(merged.name, 'Show Updated')
	assert.equal(merged.scenes.s2.id, 's2')
	assert.equal(merged.hardwareConfig.osDisplay.screen_1_system_id, 'DP-1-local')
	assert.equal(merged.hardwareConfig.casparServer.port, 5250)
	assert.equal(merged.hardwareConfig.fingerprint.hostname, 'follower-box')
	assert.deepEqual(merged.hardwareConfig.deviceGraph, { nodes: [], edges: [] })
	assert.equal(merged.hardwareConfig.screenDestinations.destinations[0].id, 'dest-leader')
	assert.deepEqual(merged.hardwareConfig.streamOutputs, [{ id: 'local-stream' }])
})

test('leader payload stripped before merge syncs destinations but keeps follower graph', () => {
	const existing = {
		name: 'Show',
		hardwareConfig: {
			deviceGraph: { version: 1, nodes: [{ id: 'follower-gpu' }], edges: [{ id: 'e1' }] },
			screenDestinations: { version: 1, destinations: [{ id: 'dest-local' }] },
		},
	}
	const incomingRaw = {
		name: 'Show Updated',
		hardwareConfig: {
			deviceGraph: { version: 1, nodes: [{ id: 'leader-gpu' }] },
			screenDestinations: { version: 1, destinations: [{ id: 'dest-leader' }] },
			osDisplay: { screen_1_system_id: 'LEADER-DP' },
		},
	}
	const incoming = stripDeviceLocalFromProject(incomingRaw)
	assert.equal(incoming.hardwareConfig?.deviceGraph, undefined)
	assert.equal(incoming.hardwareConfig?.screenDestinations?.destinations?.[0]?.id, 'dest-leader')
	const merged = mergeSharedProjectIntoLocal(existing, incoming)
	assert.equal(merged.hardwareConfig.deviceGraph.nodes[0].id, 'follower-gpu')
	assert.equal(merged.hardwareConfig.screenDestinations.destinations[0].id, 'dest-leader')
})

test('stripDeviceLocalFromProject removes device slices but keeps screen destinations', () => {
	const project = {
		hardwareConfig: {
			osDisplay: { screen_1_system_id: 'x' },
			casparServer: { host: '127.0.0.1' },
			deviceGraph: {},
			screenDestinations: { version: 1, destinations: [{ id: 'd1' }] },
		},
	}
	const stripped = stripDeviceLocalFromProject(project)
	assert.equal(stripped.hardwareConfig.osDisplay, undefined)
	assert.equal(stripped.hardwareConfig.casparServer, undefined)
	assert.equal(stripped.hardwareConfig.deviceGraph, undefined)
	assert.equal(stripped.hardwareConfig.screenDestinations.destinations[0].id, 'd1')
})
