'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	stripDeviceLocalFromProject,
	mergeSharedProjectIntoLocal,
} = require('../../src/config/config-classify')

/**
 * Mirrors receiveProjectFromPeer merge path (strip → merge) without disk/Caspar side effects.
 */
test('receiveProjectFromPeer merge path keeps follower machine slices off leader hardware', () => {
	const followerGraph = {
		version: 1,
		connectors: [{ id: 'follower-gpu-out', kind: 'gpu_out' }],
		edges: [{ id: 'e-follower', sourceId: 'follower-gpu-out', sinkId: 'deck-1' }],
	}
	const existing = {
		version: 2,
		name: 'Air Show',
		slug: 'air_show',
		scenes: { scenes: [{ id: 'look_a', name: 'Look A', layers: [] }] },
		hardwareConfig: {
			version: 2,
			deviceGraph: followerGraph,
			gpuPhysicalTopology: [{ physicalPortId: 'gpu_p0', slotOrder: 0, dpA: 'DP-0', dpB: '' }],
			osDisplay: { screen_1_system_id: 'DP-FOLLOWER' },
			casparServer: { host: '127.0.0.1', port: 5250 },
			fingerprint: { hostname: 'backup-box' },
			screenDestinations: { version: 1, destinations: [{ id: 'dest-local', label: 'Local PGM' }] },
		},
	}
	const leaderProject = {
		version: 2,
		name: 'Air Show',
		slug: 'air_show',
		savedAt: new Date().toISOString(),
		scenes: {
			scenes: [
				{ id: 'look_a', name: 'Look A', layers: [] },
				{ id: 'look_b', name: 'Look B from leader', layers: [] },
			],
		},
		hardwareConfig: {
			version: 2,
			deviceGraph: {
				version: 1,
				connectors: [{ id: 'leader-gpu-out', kind: 'gpu_out' }],
				edges: [{ id: 'e-leader' }],
			},
			gpuPhysicalTopology: [{ physicalPortId: 'gpu_p0', slotOrder: 0, dpA: 'DP-4', dpB: 'DP-5' }],
			osDisplay: { screen_1_system_id: 'DP-LEADER' },
			casparServer: { host: '10.0.0.5', port: 5250 },
			fingerprint: { hostname: 'leader-box' },
			screenDestinations: { version: 1, destinations: [{ id: 'dest-leader', label: 'Leader PGM' }] },
		},
	}

	const safe = stripDeviceLocalFromProject(leaderProject)
	assert.equal(safe.hardwareConfig?.deviceGraph, undefined)
	assert.equal(safe.hardwareConfig?.osDisplay, undefined)
	assert.equal(safe.hardwareConfig?.gpuPhysicalTopology, undefined)
	assert.equal(safe.hardwareConfig?.screenDestinations?.destinations?.[0]?.id, 'dest-leader')

	const merged = mergeSharedProjectIntoLocal(existing, safe)
	assert.equal(merged.scenes.scenes.length, 2)
	assert.equal(merged.scenes.scenes[1].id, 'look_b')
	assert.deepEqual(merged.hardwareConfig.deviceGraph, followerGraph)
	assert.equal(merged.hardwareConfig.osDisplay.screen_1_system_id, 'DP-FOLLOWER')
	assert.equal(merged.hardwareConfig.fingerprint.hostname, 'backup-box')
	assert.equal(merged.hardwareConfig.gpuPhysicalTopology[0].dpA, 'DP-0')
	assert.equal(merged.hardwareConfig.screenDestinations.destinations[0].id, 'dest-leader')
})
