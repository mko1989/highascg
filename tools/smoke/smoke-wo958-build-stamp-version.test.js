'use strict'
/**
 * WO-958 — the Devices tab showed every server as "2026.05.20": the cluster took a peer's version from the ping's
 * `appVersion` = package.json's version, frozen since May. The ping now carries `buildStamp` (BUILD_STAMP, what the
 * updater compares), the cluster and the replication inspector show it, and `appVersion` stays for the replication
 * min-version gate (a semver compare a build stamp would break).
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const { versionOf } = require('../../src/cluster/cluster-peers')
const { readBuildStampFromDir } = require('../../src/system/build-stamp')

test('versionOf: build stamp first, appVersion only for peers that predate it', () => {
	assert.equal(versionOf({ buildStamp: '2026-11-03_093850', appVersion: '2026.05.20' }), '2026-11-03_093850')
	assert.equal(versionOf({ appVersion: '2026.05.20' }), '2026.05.20')
	assert.equal(versionOf({}), '')
	assert.equal(versionOf(null), '')
})

test('the ping answers the running build stamp, appVersion unchanged', async () => {
	const { handleGet } = require('../../src/api/routes-replication-get')
	const ctx = { config: {}, log: () => {} }
	const r = await handleGet('/api/replication/ping', ctx, null)
	const body = JSON.parse(r.body)
	assert.equal(body.buildStamp, readBuildStampFromDir(ROOT))
	assert.equal(body.appVersion, require('../../package.json').version)
})

test('every cluster view and both inspectors read the stamp; the gate still reads appVersion', () => {
	const peers = read('src/cluster/cluster-peers.js')
	const stray = peers.split('\n').filter((l) => l.includes('appVersion') && !/^(const versionOf|\/\*\* WO-958)/.test(l))
	assert.deepEqual(stray, [], 'only versionOf reads appVersion')
	assert.equal((peers.match(/version: versionOf\(/g) || []).length, 4, 'live, self, invite, scan')
	assert.match(read('src/replication/replication-service-status.js'), /buildStamp: ping\.buildStamp \|\| null/)
	assert.match(read('godot/client/features/devices/replication_format.gd'), /\["App version", _or\(\[p\.get\("buildStamp"\), p\.get\("appVersion"\)\]\)\]/)
	assert.match(read('client/components/device-view-inspector-replication-shared.js'), /value: peer\.buildStamp \|\| peer\.appVersion \|\| '—'/)
	assert.match(read('src/replication/replication-handshake.js'), /semverGte\(appVersion, minAppVersion\(\)\)/)
})
