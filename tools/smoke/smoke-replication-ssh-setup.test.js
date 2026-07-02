'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const {
	normalizeSshPublicKeyLine,
	installPeerAuthorizedKey,
	ensureReplicationSshKey,
	buildForcedCommandAuthorizedKeysEntry,
	extractSshPublicKeyMaterial,
} = require('../../src/replication/replication-ssh-setup')

const SAMPLE_KEY =
	'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKeyMaterialForReplication highascg-replication-peer'

test('normalizeSshPublicKeyLine accepts ed25519', () => {
	const line = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKeyMaterial test@host'
	assert.equal(normalizeSshPublicKeyLine(line), line)
	assert.equal(normalizeSshPublicKeyLine('not-a-key'), null)
})

test('buildForcedCommandAuthorizedKeysEntry adds rsync-only wrapper', () => {
	const entry = buildForcedCommandAuthorizedKeysEntry(SAMPLE_KEY, { fromHost: '192.168.0.28' })
	assert.ok(entry)
	assert.match(entry, /^from="192\.168\.0\.28",command=".*highascg-replication-ssh/)
	assert.match(entry, /no-port-forwarding/)
	assert.match(entry, /ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKeyMaterialForReplication/)
})

test('installPeerAuthorizedKey upgrades plain key to forced-command entry', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repl-ssh-'))
	const keyPath = path.join(tmp, 'repl_key')
	process.env.HIGHASCG_REPL_SSH_KEY = keyPath
	const authPath = path.join(tmp, '.ssh', 'authorized_keys')
	fs.mkdirSync(path.dirname(authPath), { recursive: true })
	const home = process.env.HOME
	process.env.HOME = tmp
	try {
		const { publicKeyLine } = ensureReplicationSshKey()
		const plain = normalizeSshPublicKeyLine(publicKeyLine)
		fs.writeFileSync(authPath, `${plain}\n`, { mode: 0o600 })

		const out = installPeerAuthorizedKey(publicKeyLine, { fromHost: '10.0.0.5' })
		assert.equal(out.installed, true)
		assert.equal(out.upgraded, true)

		const text = fs.readFileSync(authPath, 'utf8')
		const lines = text.trim().split('\n')
		assert.equal(lines.length, 1)
		assert.match(lines[0], /command="[^"]*highascg-replication-ssh/)
		assert.match(lines[0], /from="10\.0\.0\.5"/)
	} finally {
		process.env.HOME = home
		delete process.env.HIGHASCG_REPL_SSH_KEY
		fs.rmSync(tmp, { recursive: true, force: true })
	}
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
		const a = installPeerAuthorizedKey(publicKeyLine, { fromHost: '10.0.0.8' })
		const b = installPeerAuthorizedKey(publicKeyLine, { fromHost: '10.0.0.8' })
		assert.equal(a.installed, true)
		assert.equal(b.alreadyPresent, true)
		assert.match(fs.readFileSync(authPath, 'utf8'), /ssh-ed25519/)
	} finally {
		process.env.HOME = home
		delete process.env.HIGHASCG_REPL_SSH_KEY
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('extractSshPublicKeyMaterial strips authorized_keys options', () => {
	const entry = buildForcedCommandAuthorizedKeysEntry(SAMPLE_KEY, { fromHost: '192.168.0.1' })
	assert.equal(
		extractSshPublicKeyMaterial(entry),
		'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKeyMaterialForReplication',
	)
})

test('highascg-replication-ssh wrapper rejects shell commands', () => {
	const wrapper = path.join(__dirname, '../../tools/runtime/highascg-replication-ssh.sh')
	const denied = spawnSync('bash', [wrapper], {
		env: { ...process.env, SSH_ORIGINAL_COMMAND: 'echo pwned' },
		encoding: 'utf8',
	})
	assert.notEqual(denied.status, 0)
	assert.match(denied.stderr || '', /forbidden command/)
})

test('highascg-replication-ssh wrapper rejects paths outside media/template', () => {
	const wrapper = path.join(__dirname, '../../tools/runtime/highascg-replication-ssh.sh')
	const denied = spawnSync('bash', [wrapper], {
		env: {
			...process.env,
			HIGHASCG_REPO_ROOT: '/home/casparcg/highascg',
			SSH_ORIGINAL_COMMAND: 'rsync --server -vlogDtprze.iLsfxCIvu . /etc/passwd',
		},
		encoding: 'utf8',
	})
	assert.notEqual(denied.status, 0)
	assert.match(denied.stderr || '', /path not under media/)
})

test('highascg-replication-ssh wrapper accepts media paths', () => {
	const wrapper = path.join(__dirname, '../../tools/runtime/highascg-replication-ssh.sh')
	const allowed = spawnSync('bash', [wrapper], {
		env: {
			...process.env,
			HIGHASCG_REPO_ROOT: '/home/casparcg/highascg',
			SSH_ORIGINAL_COMMAND: 'rsync --server -vlogDtprze.iLsfxCIvu . media/projects/demo/',
		},
		encoding: 'utf8',
		input: '',
		timeout: 2000,
	})
	assert.doesNotMatch(allowed.stderr || '', /forbidden command|path not under|disallowed path/)
})
