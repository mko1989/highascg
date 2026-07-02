'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { stripDeviceLocalFromProject } = require('../../src/config/config-classify')
const {
	buildHotBackupMetadata,
	hotBackupPeerLabel,
	hotBackupPeerBoxForViewer,
} = require('../../src/replication/project-hot-backup')

test('buildHotBackupMetadata stores leader self and follower peer', () => {
	const meta = buildHotBackupMetadata(
		{},
		'leader',
		{
			pairId: 'pair-1',
			peer: { hardwareId: '7579', hostname: 'highascg7579', host: '10.0.0.12' },
		},
	)
	assert.equal(meta.role, 'leader')
	assert.equal(meta.pairId, 'pair-1')
	assert.equal(meta.peer.hardwareId, '7579')
	assert.equal(meta.peer.hostname, 'highascg7579')
	assert.ok(meta.pairedAt)
})

test('hotBackupPeerLabel swaps for follower viewer', () => {
	const meta = {
		role: 'leader',
		self: { hardwareId: '1234', hostname: 'highascg1234', host: '10.0.0.5' },
		peer: { hardwareId: '7579', hostname: 'highascg7579', host: '10.0.0.12' },
	}
	assert.equal(hotBackupPeerLabel(meta, 'leader'), 'highascg7579')
	assert.equal(hotBackupPeerLabel(meta, 'follower'), 'highascg1234')
	assert.equal(hotBackupPeerBoxForViewer(meta, 'follower')?.host, '10.0.0.5')
})

test('stripDeviceLocalFromProject keeps project.hotBackup (show tier)', () => {
	const project = {
		name: 'Show',
		scenes: { scenes: [] },
		hotBackup: {
			pairId: 'pair-1',
			role: 'leader',
			self: { hardwareId: '1234', hostname: 'highascg1234', host: '10.0.0.5' },
			peer: { hardwareId: '7579', hostname: 'highascg7579', host: '10.0.0.12' },
			pairedAt: '2026-07-01T12:00:00.000Z',
		},
		hardwareConfig: {
			deviceGraph: { version: 1 },
			osDisplay: { screen_1_system_id: 'DP-1' },
		},
	}
	const stripped = stripDeviceLocalFromProject(project)
	assert.equal(stripped.hotBackup?.pairId, 'pair-1')
	assert.equal(stripped.hotBackup?.peer?.hardwareId, '7579')
	assert.equal(stripped.hardwareConfig?.deviceGraph, undefined)
})
