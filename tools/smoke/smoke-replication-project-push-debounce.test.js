'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	scheduleProjectPushToPeer,
	cancelScheduledProjectPushToPeer,
	flushProjectPushToPeer,
} = require('../../src/replication/project-push-debounce')
const replicateProjects = require('../../src/replication/replicate-projects')

function leaderCtx() {
	return {
		config: {
			replication: {
				enabled: true,
				role: 'leader',
				pairId: 'pair-1',
				peer: { host: '192.168.0.28', port: 4200, token: 'secret' },
			},
		},
		persistence: { get: () => ({}), set: () => {} },
		_replication: {
			roleState: { getRole: () => 'leader' },
			projectsPushed: 0,
		},
		log: () => {},
	}
}

test('scheduleProjectPushToPeer coalesces to one push with latest project', () => {
	cancelScheduledProjectPushToPeer()
	const orig = replicateProjects.pushProjectToPeer
	/** @type {Array<{ reason?: string, sceneCount: number }>} */
	const calls = []
	replicateProjects.pushProjectToPeer = async (_ctx, _rt, project, opts = {}) => {
		calls.push({
			reason: opts.reason,
			sceneCount: project?.scenes?.scenes?.length ?? 0,
		})
		return { ok: true }
	}

	try {
		const ctx = leaderCtx()
		scheduleProjectPushToPeer(ctx, { name: 'A', scenes: { scenes: [{ id: '1' }] } })
		scheduleProjectPushToPeer(ctx, { name: 'A', scenes: { scenes: [{ id: '1' }, { id: '2' }] } })
		assert.equal(calls.length, 0)
		flushProjectPushToPeer()
		assert.equal(calls.length, 1)
		assert.equal(calls[0].reason, 'autosave')
		assert.equal(calls[0].sceneCount, 2)
	} finally {
		replicateProjects.pushProjectToPeer = orig
		cancelScheduledProjectPushToPeer()
	}
})

test('scheduleProjectPushToPeer skips when not leader', () => {
	cancelScheduledProjectPushToPeer()
	const orig = replicateProjects.pushProjectToPeer
	let calls = 0
	replicateProjects.pushProjectToPeer = async () => {
		calls += 1
		return { ok: true }
	}

	try {
		const ctx = leaderCtx()
		ctx._replication.roleState.getRole = () => 'follower'
		scheduleProjectPushToPeer(ctx, { name: 'A', scenes: { scenes: [] } })
		flushProjectPushToPeer()
		assert.equal(calls, 0)
	} finally {
		replicateProjects.pushProjectToPeer = orig
		cancelScheduledProjectPushToPeer()
	}
})

test('autosave merge path removes look on follower when leader sends fewer scenes', () => {
	const {
		stripDeviceLocalFromProject,
		mergeSharedProjectIntoLocal,
	} = require('../../src/config/config-classify')

	const existing = {
		name: 'Show',
		slug: 'show',
		scenes: {
			scenes: [
				{ id: 'look_a', name: 'A', layers: [] },
				{ id: 'look_b', name: 'B', layers: [] },
			],
		},
		hardwareConfig: {
			deviceGraph: { version: 1, connectors: [], edges: [] },
			fingerprint: { hostname: 'follower' },
		},
	}
	const leaderAutosaved = {
		name: 'Show',
		slug: 'show',
		scenes: { scenes: [{ id: 'look_a', name: 'A', layers: [] }] },
	}
	const merged = mergeSharedProjectIntoLocal(existing, stripDeviceLocalFromProject(leaderAutosaved))
	assert.equal(merged.scenes.scenes.length, 1)
	assert.equal(merged.scenes.scenes[0].id, 'look_a')
	assert.equal(merged.hardwareConfig.fingerprint.hostname, 'follower')
})
