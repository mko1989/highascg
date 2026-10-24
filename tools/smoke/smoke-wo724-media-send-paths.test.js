'use strict'

/**
 * WO-724 — Send media to a linked server failed on any folder or file name with a space (live 24.10, real two-box:
 * "media/projects/npcc/Tlo Orange Ball/BAZA 2.mp4: highascg-replication-ssh: disallowed path token: Orange\").
 * rsync ≥ 3.2.4 backslash-escapes the remote path on the remote command line, and the receiver's forced command
 * (tools/runtime/highascg-replication-ssh.sh) split that line on spaces. A push now names only <root>/media/ there
 * and carries the rest in rsync's file list (sync-project-media-rsync.js rsyncArgs).
 * WO-727: a PULL has to name the remote path, so the wrapper now splits words the way the shell would for rsync's
 * escapes (owner 24.10: "We need this"). Every refusal it had stays: unescaped metacharacters, quotes, "..",
 * anything outside media/ and template/ (canonical, so a symlink out is refused), escaped option words.
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

	it('WO-727: the escaped remote path that failed on the box (disallowed path token: Orange) now goes through', { skip: escapes ? false : 'rsync < 3.2.4 does not escape' }, () => {
		const r = run(['-avz', '--mkpath', '-e', fakeSsh, 'media/projects/npcc/Tlo Orange Ball/BAZA 2.mp4', `casparcg@peer:${dest}/media/projects/old form/`])
		assert.equal(r.status, 0, r.stderr)
		assert.equal(fs.readFileSync(path.join(dest, 'media/projects/old form/BAZA 2.mp4'), 'utf8'), 'clip')
	})

	it('WO-727: a pull of a file and of a folder with spaces, "&" and "(1)" (the hot-backup pair direction)', () => {
		fs.mkdirSync(path.join(dest, 'media/projects/pull me/sub dir'), { recursive: true })
		fs.writeFileSync(path.join(dest, 'media/projects/pull me/Tom & Jerry (1).mov'), 'pulled')
		fs.writeFileSync(path.join(dest, 'media/projects/pull me/sub dir/b.wav'), 'tone2')
		const local = fs.mkdtempSync(path.join(tmp, 'puller-'))
		const pull = (rel) => spawnSync('rsync', rsyncArgs('pull', rel, o()), { cwd: local, encoding: 'utf8', env: { ...process.env, WO724_DEST: dest, WO724_WRAPPER: WRAPPER } })
		let r = pull('media/projects/pull me/Tom & Jerry (1).mov')
		assert.equal(r.status, 0, r.stderr)
		assert.equal(fs.readFileSync(path.join(local, 'media/projects/pull me/Tom & Jerry (1).mov'), 'utf8'), 'pulled')
		r = pull('media/projects/pull me/')
		assert.equal(r.status, 0, r.stderr)
		assert.equal(fs.readFileSync(path.join(local, 'media/projects/pull me/sub dir/b.wav'), 'utf8'), 'tone2')
	})
})

describe('WO-727 the forced command still refuses everything it refused', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo727-wrapper-'))
	const root = path.join(tmp, 'repo')
	fs.mkdirSync(path.join(root, 'media'), { recursive: true })
	fs.mkdirSync(path.join(root, 'template'), { recursive: true })
	fs.symlinkSync('/etc', path.join(root, 'media', 'out'))
	const bin = path.join(tmp, 'bin')
	fs.mkdirSync(bin)
	// a stand-in rsync that prints the words it was given: what the wrapper would exec
	fs.writeFileSync(path.join(bin, 'rsync'), '#!/usr/bin/env bash\nfor a in "$@"; do printf "<%s>" "$a"; done\n', { mode: 0o755 })
	const wrap = (cmd) => spawnSync('bash', [WRAPPER], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HIGHASCG_REPO_ROOT: root, SSH_ORIGINAL_COMMAND: cmd } })
	after(() => fs.rmSync(tmp, { recursive: true, force: true }))

	it('escaped names become one word each, exec\'d without a shell', () => {
		const r = wrap(`rsync --server --sender -vlogDtprze.iLsfxCIvu . ${root}/media/a\\ b/Tom\\ \\&\\ Jerry\\ \\(1\\)\\;.png`)
		assert.equal(r.status, 0, r.stderr)
		assert.equal(r.stdout, `<--server><--sender><-vlogDtprze.iLsfxCIvu><.><${root}/media/a b/Tom & Jerry (1);.png>`)
	})

	for (const [why, cmd, err] of [
		['not rsync', 'echo pwned', /forbidden command/],
		['unescaped ;', 'rsync --server . MEDIA/x; touch /tmp/wo727', /forbidden metacharacters/],
		['$( )', 'rsync --server . MEDIA/x$(id)', /forbidden metacharacters/],
		['backticks', 'rsync --server . MEDIA/`id`', /forbidden metacharacters/],
		['quotes', "rsync --server . 'MEDIA/x'", /forbidden metacharacters/],
		['a newline', 'rsync --server . MEDIA/x\nid', /forbidden metacharacters/],
		['..', 'rsync --server . MEDIA/../../etc', /path traversal/],
		['escaped ..', 'rsync --server . media/\\.\\./\\.\\./etc', /path traversal/],
		['outside media / template', 'rsync --server . /etc/passwd', /not under media/],
		['escaped, outside', 'rsync --server . /etc/pass\\ wd', /not under media/],
		['a symlink out of media', 'rsync --server . MEDIA/out/', /not under media/],
		['an escaped option word', 'rsync --server -e\\ sh . MEDIA/x', /escaped characters in an option/],
		['a trailing backslash', 'rsync --server . MEDIA/x\\', /trailing backslash/],
		['escaped prefix', 'rsync\\ --server . MEDIA/x', /forbidden command/],
	]) {
		it(`refuses ${why}`, () => {
			const r = wrap(cmd.replace(/MEDIA/g, `${root}/media`))
			assert.notEqual(r.status, 0, r.stdout)
			assert.match(r.stderr, err)
			assert.equal(r.stdout, '', 'rsync never ran')
		})
	}
})

describe('WO-727 updates refresh the installed forced command', () => {
	const apply = fs.readFileSync(path.join(__dirname, '../../scripts/exfat/highascg-apply-server-drop.sh'), 'utf8')
	it('the drop helper (stick + web UI update) reinstalls the wrapper where sshd runs it, only if already installed', () => {
		assert.match(apply, /wrapper_dst="\$\{HIGHASCG_REPLICATION_SSH_WRAPPER:-\/usr\/local\/bin\/highascg-replication-ssh\}"/)
		assert.ok(apply.includes('if [[ "$EUID" -eq 0 && -f "$wrapper_dst" && -f "${dest}/tools/runtime/highascg-replication-ssh.sh" ]] &&'))
		assert.ok(apply.includes('install -m 0755 -o root -g root "${dest}/tools/runtime/highascg-replication-ssh.sh" "$wrapper_dst"'))
	})
})
