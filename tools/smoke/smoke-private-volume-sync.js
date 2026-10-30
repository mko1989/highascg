'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const test = require('node:test')
const assert = require('node:assert/strict')
const { getMachineId, sanitizeMachineId } = require('../../src/config/machine-identity')
const { hostPrivateDir, volumePrivateDir, syncPrivateTree } = require('../../src/system/private-volume-sync')

test('sanitizeMachineId strips unsafe characters', () => {
	assert.equal(sanitizeMachineId(' Box A! '), 'Box-A')
})

test('getMachineId: hardware hostname first, then replication.selfId', () => {
	// WO-836: getMachineId() prefers the hardware-identity hostname (machine-identity.js:13-16) over replication.selfId, so
	// this box answers with its own hostname; selfId is only the fallback where no hostname resolves.
	const { getHardwareIdentity } = require('../../src/system/hardware-identity')
	const hostname = getHardwareIdentity({ networkCfg: undefined })?.hostname
	const id = getMachineId({ config: { replication: { selfId: 'box-a' }, general: {} } })
	assert.equal(id, hostname ? sanitizeMachineId(hostname) : 'box-a')
})

test('syncPrivateTree merges host and volume files by mtime', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'priv-sync-'))
	const machine = 'smoke-test-' + Date.now()
	// syncPrivateTree refuses a host dir outside REPO_ROOT/.private (assertUnderRoot), so this one must live there; the
	// try/finally (WO-836) removes it even when an assert fails, so a red run no longer leaves it for Syncthing to ship.
	const hostDir = hostPrivateDir(machine)
	const volDir = path.join(tmp, 'vol-mirror')
	try {
		fs.mkdirSync(hostDir, { recursive: true })
		fs.mkdirSync(volDir, { recursive: true })
		fs.writeFileSync(path.join(hostDir, 'a.txt'), 'host-old\n')
		fs.writeFileSync(path.join(volDir, 'b.txt'), 'vol-only\n')
		const r = syncPrivateTree(hostDir, volDir, { dryRun: false })
		assert.ok(r.copied >= 2)
		assert.ok(fs.existsSync(path.join(hostDir, 'b.txt')))
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
		fs.rmSync(hostDir, { recursive: true, force: true })
	}
})

test('volumePrivateDir uses machine subfolder', () => {
	const p = volumePrivateDir('/home/casparcg/exfat', 'box-a')
	assert.ok(p.endsWith(path.join('.private', 'box-a')))
})
