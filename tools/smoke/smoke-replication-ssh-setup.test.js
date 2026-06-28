'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
	normalizeSshPublicKeyLine,
	installPeerAuthorizedKey,
	ensureReplicationSshKey,
} = require('../../src/replication/replication-ssh-setup')

test('normalizeSshPublicKeyLine accepts ed25519', () => {
	const line = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKeyMaterial test@host'
	assert.equal(normalizeSshPublicKeyLine(line), line)
	assert.equal(normalizeSshPublicKeyLine('not-a-key'), null)
})

test('installPeerAuthorizedKey is idempotent', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repl-ssh-'))
	const keyPath = path.join(tmp, 'repl_key')
	process.env.HIGHASCG_REPL_SSH_KEY = keyPath
	const authPath = path.join(tmp, '.ssh', 'authorized_keys')
	fs.mkdirSync(path.dirname(authPath), { recursive: true })
	const home = process.env.HOME
	process.env.HOME = tmp
	try {
		const { publicKeyLine } = ensureReplicationSshKey()
		const a = installPeerAuthorizedKey(publicKeyLine)
		const b = installPeerAuthorizedKey(publicKeyLine)
		assert.equal(a.installed, true)
		assert.equal(b.alreadyPresent, true)
		assert.match(fs.readFileSync(authPath, 'utf8'), /ssh-ed25519/)
	} finally {
		process.env.HOME = home
		delete process.env.HIGHASCG_REPL_SSH_KEY
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})
