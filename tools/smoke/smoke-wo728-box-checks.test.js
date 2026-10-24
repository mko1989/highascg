'use strict'

/**
 * WO-728 — box checks: root-installed copies vs the repo (tools/runtime/check-installed-helpers.js), the live media
 * copy check (tools/e2e/replication-check.js, needs sshd — only its inputs are checked here), and what the first live
 * run found: replication keys with a full shell in authorized_keys (WO-729, restrictPlainReplicationKeys).
 * The clock step runs with the 3-sandbox scenario in smoke-wo725-cluster-e2e.test.js.
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { checkInstalledHelpers } = require('../runtime/check-installed-helpers')
const { restrictPlainReplicationKeys } = require('../../src/replication/replication-ssh-setup')
const { FILES, DIR } = require('../e2e/replication-check')

const REPO = path.resolve(__dirname, '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo728-'))
after(() => fs.rmSync(tmp, { recursive: true, force: true }))
const put = (rel, body) => {
	fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true })
	fs.writeFileSync(path.join(tmp, rel), body)
}

describe('WO-728 installed root copies vs the repo', () => {
	put('repo/scripts/exfat/highascg-apply-server-drop.sh', 'new')
	put('repo/scripts/lib/lib.sh', 'same')
	put('repo/tools/runtime/capture-boot-xrandr.sh', 'cap')
	put('repo/tools/runtime/highascg-replication-ssh.sh', 'wrap v2')
	put('repo/scripts/deprecated/old-helper.sh', 'old')
	put('lib/highascg-apply-server-drop.sh', 'old')
	put('lib/lib.sh', 'same')
	put('lib/old-helper.sh', 'old')
	put('bin/highascg-capture-boot-xrandr.sh', 'cap')
	put('bin/highascg-replication-ssh', 'wrap v1')
	put('bin/highascg-display-mode', 'heredoc')
	put('bin/unrelated-tool', 'x')
	const rows = checkInstalledHelpers({
		repo: path.join(tmp, 'repo'),
		installed: [{ dir: path.join(tmp, 'lib') }, { dir: path.join(tmp, 'bin'), only: /^highascg-/ }],
	})
	const by = Object.fromEntries(rows.map((r) => [path.basename(r.installed), r]))

	it('a copy older than the repo is reported, with its repo file', () => {
		assert.equal(by['highascg-apply-server-drop.sh'].status, 'differs')
		assert.deepEqual(by['highascg-apply-server-drop.sh'].sources, ['scripts/exfat/highascg-apply-server-drop.sh'])
	})
	it('the forced command sshd runs is matched to tools/runtime/highascg-replication-ssh.sh (WO-727)', () => {
		assert.equal(by['highascg-replication-ssh'].status, 'differs')
		assert.deepEqual(by['highascg-replication-ssh'].sources, ['tools/runtime/highascg-replication-ssh.sh'])
	})
	it('installed under a highascg- prefix still finds its source; equal copies pass', () => {
		assert.equal(by['highascg-capture-boot-xrandr.sh'].status, 'same')
		assert.equal(by['lib.sh'].status, 'same')
	})
	it('no repo file (heredoc / compiled, or only in deprecated/) = generated, not compared', () => {
		assert.equal(by['highascg-display-mode'].status, 'generated')
		assert.equal(by['old-helper.sh'].status, 'generated')
		assert.equal(by['unrelated-tool'], undefined, 'only highascg-* in /usr/local/bin')
	})
	it('the real repo has a source for the forced command and the updaters', () => {
		for (const f of ['tools/runtime/highascg-replication-ssh.sh', 'scripts/exfat/highascg-apply-server-drop.sh', 'scripts/exfat/highascg-webui-server-update.sh'])
			assert.ok(fs.existsSync(path.join(REPO, f)), f)
	})
})

describe('WO-729 replication keys never keep a full shell', () => {
	const K = (tag, comment) => `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${tag}Material ${comment}`
	const auth = path.join(tmp, 'authorized_keys')
	const deploy = K('Deploy', 'casparcg-leader-deploy')
	const forced = `from="192.168.0.13",command="/usr/local/bin/highascg-replication-ssh",no-pty ${K('Forced', 'highascg-replication@a')}`
	fs.writeFileSync(auth, [deploy, K('Self', 'highascg-replication@highascg-nvidia-595'), K('Peer', 'highascg-replication@b'), forced, ''].join('\n'))
	const first = restrictPlainReplicationKeys(auth)
	const lines = fs.readFileSync(auth, 'utf8').split('\n')

	it('every plain replication key is bound to the forced command, without a pty or forwarding', () => {
		assert.equal(first.restricted, 2)
		for (const tag of ['Self', 'Peer']) {
			const l = lines.find((x) => x.includes(`AAAAI${tag}Material`))
			assert.match(l, /^command="[^"]*highascg-replication-ssh[^"]*",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 /)
		}
	})
	it('other keys and keys that already have options are left exactly as they were', () => {
		assert.equal(lines[0], deploy)
		assert.equal(lines[3], forced)
	})
	it('the file before the change is kept once (.pre-wo729), 0600; a second pass changes nothing', () => {
		assert.match(fs.readFileSync(`${auth}.pre-wo729`, 'utf8'), /AAAAISelfMaterial highascg-replication@/)
		assert.equal(fs.statSync(auth).mode & 0o777, 0o600)
		assert.deepEqual(restrictPlainReplicationKeys(auth), { ok: true, restricted: 0 })
		assert.deepEqual(restrictPlainReplicationKeys(path.join(tmp, 'none')), { ok: true, restricted: 0 })
	})
	it('the server does it on start, never from a sandbox (it shares ~/.ssh)', () => {
		const svc = fs.readFileSync(path.join(REPO, 'src/replication/replication-service.js'), 'utf8')
		// concat: a literal require string here would count as this file's own require (check-require-integrity)
		assert.ok(svc.includes('if (!req' + "uire('../bootstrap/sandbox').isSandbox()) {"))
		assert.ok(svc.includes('req' + "uire('./replication-ssh-setup').restrictPlainReplicationKeys(undefined, { log: ctx.log })"))
	})
	it('the manual setup script no longer adds plain keys (self or via ssh-copy-id)', () => {
		const sh = fs.readFileSync(path.join(REPO, 'scripts/replication/setup-replication-ssh.sh'), 'utf8')
		assert.doesNotMatch(sh, /^\s*ssh-copy-id\b/m)
		assert.doesNotMatch(sh, />>\s*"\$HOME\/\.ssh\/authorized_keys"/)
		assert.ok(sh.includes('install_peer_key_file "${KEY}.pub" ""'))
		assert.ok(sh.includes('setup-replication-ssh.sh --install-peer-key "$f"'))
	})
})

describe('WO-728 live media copy check: what it sends', () => {
	it('names carry every character that broke or that rsync escapes, inside one throwaway folder', () => {
		const names = Object.keys(FILES).join('|')
		for (const c of [' ', '&', '(', "'", '[', '#']) assert.ok(names.includes(c), JSON.stringify(c))
		assert.equal(DIR, 'media/.highascg-check/')
	})
})
