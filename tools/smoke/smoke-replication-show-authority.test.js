'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')
const {
	isShowDataExfatPair,
	leaderOwnsActiveShow,
	shouldAllowExfatPullShowData,
	shouldSyncShowDataPairFromExfat,
} = require('../../src/replication/replication-show-authority')
const { normalizeReplicationConfig } = require('../../src/config/replication-config')

test('isShowDataExfatPair identifies project/state pairs', () => {
	assert.equal(isShowDataExfatPair('usb-projects'), true)
	assert.equal(isShowDataExfatPair('usb-modular-config'), false)
})

test('leaderOwnsActiveShow when leaderAvailable or role leader', () => {
	assert.equal(
		leaderOwnsActiveShow(normalizeReplicationConfig({ enabled: false, leaderAvailable: true, role: 'auto' })),
		true,
	)
	assert.equal(
		leaderOwnsActiveShow(normalizeReplicationConfig({ enabled: true, role: 'leader', leaderAvailable: true })),
		true,
	)
	assert.equal(
		leaderOwnsActiveShow(normalizeReplicationConfig({ enabled: true, role: 'follower', leaderAvailable: false })),
		false,
	)
})

test('shouldSyncShowDataPairFromExfat blocks leader pull', () => {
	const leader = normalizeReplicationConfig({ enabled: true, role: 'leader', leaderAvailable: true })
	const follower = normalizeReplicationConfig({ enabled: true, role: 'follower' })
	assert.equal(shouldSyncShowDataPairFromExfat('usb-projects', leader), false)
	assert.equal(shouldSyncShowDataPairFromExfat('usb-projects', follower), true)
	assert.equal(shouldSyncShowDataPairFromExfat('usb-modular-config', leader), true)
})

test('syncOneFilePair blockExfatToProject skips volume → project', () => {
	const { syncOneFilePair } = require('../../src/system/exfat-sync-fs')
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exfat-block-'))
	const exfat = path.join(dir, 'stick.json')
	const project = path.join(dir, 'local.json')
	fs.writeFileSync(exfat, '{"from":"stick"}')
	fs.writeFileSync(project, '{"from":"local"}')
	const r = syncOneFilePair(exfat, project, 'both', false, 'test', 'x.json', { blockExfatToProject: true })
	assert.equal(r.copied, 0)
	assert.equal(r.skipped, 1)
	assert.equal(fs.readFileSync(project, 'utf8'), '{"from":"local"}')
	fs.rmSync(dir, { recursive: true, force: true })
})
