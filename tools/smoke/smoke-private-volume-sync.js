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

test('getMachineId prefers replication.selfId', () => {
	const id = getMachineId({ config: { replication: { selfId: 'box-a' }, general: {} } })
	assert.equal(id, 'box-a')
})

test('syncPrivateTree merges host and volume files by mtime', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'priv-sync-'))
	const machine = 'smoke-test-' + Date.now()
	const hostDir = hostPrivateDir(machine)
	const volDir = path.join(tmp, 'vol-mirror')
	fs.mkdirSync(hostDir, { recursive: true })
	fs.mkdirSync(volDir, { recursive: true })
	fs.writeFileSync(path.join(hostDir, 'a.txt'), 'host-old\n')
	fs.writeFileSync(path.join(volDir, 'b.txt'), 'vol-only\n')
	const r = syncPrivateTree(hostDir, volDir, { dryRun: false })
	assert.ok(r.copied >= 2)
	assert.ok(fs.existsSync(path.join(hostDir, 'b.txt')))
	fs.rmSync(tmp, { recursive: true, force: true })
	fs.rmSync(hostDir, { recursive: true, force: true })
})

test('volumePrivateDir uses machine subfolder', () => {
	const p = volumePrivateDir('/home/casparcg/exfat', 'box-a')
	assert.ok(p.endsWith(path.join('.private', 'box-a')))
})
