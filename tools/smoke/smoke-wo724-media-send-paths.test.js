'use strict'

/**
 * WO-724 — Send media to a linked server failed on any folder or file name with a space (live 24.10, real two-box:
 * "media/projects/npcc/Tlo Orange Ball/BAZA 2.mp4: highascg-replication-ssh: disallowed path token: Orange\").
 * rsync ≥ 3.2.4 backslash-escapes the remote path on the remote command line, and the receiver's forced command
 * (tools/runtime/highascg-replication-ssh.sh, unchanged) splits that line on spaces. A push now names only
 * <root>/media/ there and carries the rest in rsync's file list (sync-project-media-rsync.js rsyncArgs).
 *
 * These run REAL rsync through the REAL wrapper: a fake `ssh` hands the remote command over as sshd does
 * (SSH_ORIGINAL_COMMAND = the joined words) into a scratch receiver root.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { rsyncArgs } = require('../../src/replication/sync-project-media-rsync')

const WRAPPER = path.join(__dirname, '../../tools/runtime/highascg-replication-ssh.sh')
const rsyncVersion = (() => {
	const r = spawnSync('rsync', ['--version'], { encoding: 'utf8' })
	const m = /version\s+(\d+)\.(\d+)\.(\d+)/.exec(r.stdout || '')
	return m ? m.slice(1).map(Number) : null
})()
const escapes = !!rsyncVersion && (rsyncVersion[0] > 3 || (rsyncVersion[0] === 3 && (rsyncVersion[1] > 2 || (rsyncVersion[1] === 2 && rsyncVersion[2] >= 4))))

describe('WO-724 Send media: names with spaces reach the linked server', { skip: rsyncVersion ? false : 'rsync not installed' }, () => {
	let tmp, src, dest, fakeSsh
	const o = () => ({ remote: 'casparcg@peer:', remoteRoot: dest, sshCommand: fakeSsh })
	const run = (args) => spawnSync('rsync', args, { cwd: src, encoding: 'utf8', env: { ...process.env, WO724_DEST: dest, WO724_WRAPPER: WRAPPER } })
	const put = (rel, body) => {
		fs.mkdirSync(path.dirname(path.join(src, rel)), { recursive: true })
		fs.writeFileSync(path.join(src, rel), body)
	}

	before(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo724-rsync-'))
		src = path.join(tmp, 'sender')
		dest = path.join(tmp, 'receiver')
		fs.mkdirSync(path.join(dest, 'media'), { recursive: true })
		fs.mkdirSync(path.join(dest, 'template'), { recursive: true })
		fakeSsh = path.join(tmp, 'fake-ssh')
		// rsync runs: fake-ssh [ssh options] host rsync --server … ; sshd would join the words into SSH_ORIGINAL_COMMAND
		fs.writeFileSync(fakeSsh, '#!/usr/bin/env bash\nwhile [[ "$1" == -* ]]; do case "$1" in -o|-i|-p|-l) shift 2 ;; *) shift ;; esac; done\nshift\nSSH_ORIGINAL_COMMAND="$*" HIGHASCG_REPO_ROOT="$WO724_DEST" exec bash "$WO724_WRAPPER"\n', { mode: 0o755 })
		put('media/projects/npcc/Tlo Orange Ball/BAZA 2.mp4', 'clip')
		put('media/projects/godot test/Tom & Jerry (1).png', 'still')
		put('media/projects/godot test/sub dir/a.wav', 'tone')
		put('template/my set/lower third.html', '<html></html>')
	})
	after(() => fs.rmSync(tmp, { recursive: true, force: true }))

	it('a push names only <root>/media/ on the remote side', () => {
		const a = rsyncArgs('push', 'media/projects/npcc/Tlo Orange Ball/BAZA 2.mp4', { remote: 'u@h:', remoteRoot: '/r', sshCommand: 'ssh' })
		assert.deepEqual(a.slice(-3), ['--relative', 'media/./projects/npcc/Tlo Orange Ball/BAZA 2.mp4', 'u@h:/r/media/'])
		assert.deepEqual(rsyncArgs('pull', 'media/x/', { remote: 'u@h:', remoteRoot: '/r', sshCommand: 'ssh' }).slice(-2), ['u@h:/r/media/x/', './media/x/'])
	})

	it('a file in a folder with spaces arrives at the same path', () => {
		const r = run(rsyncArgs('push', 'media/projects/npcc/Tlo Orange Ball/BAZA 2.mp4', o()))
		assert.equal(r.status, 0, r.stderr)
		assert.equal(fs.readFileSync(path.join(dest, 'media/projects/npcc/Tlo Orange Ball/BAZA 2.mp4'), 'utf8'), 'clip')
	})

	it('a project folder with spaces, "&" and "(1)" in names arrives whole', () => {
		const r = run(rsyncArgs('push', 'media/projects/godot test/', o()))
		assert.equal(r.status, 0, r.stderr)
		assert.equal(fs.readFileSync(path.join(dest, 'media/projects/godot test/Tom & Jerry (1).png'), 'utf8'), 'still')
		assert.equal(fs.readFileSync(path.join(dest, 'media/projects/godot test/sub dir/a.wav'), 'utf8'), 'tone')
	})

	it('templates land under template/', () => {
		const r = run(rsyncArgs('push', 'template/my set/lower third.html', o()))
		assert.equal(r.status, 0, r.stderr)
		assert.ok(fs.existsSync(path.join(dest, 'template/my set/lower third.html')))
	})

	it('the wrapper still refuses a destination outside media/ and template/', () => {
		const r = run(['-avz', '-e', fakeSsh, 'media/projects/npcc/', `casparcg@peer:${dest}/etc/`])
		assert.notEqual(r.status, 0)
		assert.match(r.stderr, /path not under media\/ or template\//)
	})

	it('the old form (spaces in the remote path) is what failed on the box', { skip: escapes ? false : 'rsync < 3.2.4 does not escape' }, () => {
		const r = run(['-avz', '--mkpath', '-e', fakeSsh, 'media/projects/npcc/Tlo Orange Ball/BAZA 2.mp4', `casparcg@peer:${dest}/media/projects/npcc/Tlo Orange Ball/`])
		assert.notEqual(r.status, 0)
		assert.match(r.stderr, /disallowed path token: Orange/)
	})
})
