'use strict'

/**
 * WO-721 — owner 24.10: "Install to disk calamares is greyed out when running the iso".
 *  B. Calamares' shellprocess@release_bridge ran with NO script on every ISO since WO-481 ("No script given for
 *     ShellProcessJob" in the live session log): settings.conf scheduled the step but never declared the instance
 *     that binds it to shellprocess@release_bridge.conf. The fix script is EXECUTED here against a temp root.
 *  A. GET /api/system/setup spawned `eggs calamares --help` (≤ 8 s cold) in a synchronous route the Godot client
 *     abandons at 15 s, and the pane hid every reason in a tooltip / left the button locked on a failed check.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const cp = require('node:child_process')

const ROOT = path.join(__dirname, '..', '..')
const LIVE_USB = path.join(ROOT, 'tools/eggs/live-usb')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** An eggs-shaped settings.conf: one instance, exec sequence starting at partition. */
const EGGS_SETTINGS = `---
modules-search:
  - local
instances:
  - id: mkinitramfs
    module: shellprocess
    config: shellprocess@mkinitramfs.conf
sequence:
  - show:
      - welcome
      - partition
  - exec:
      - partition
      - mount
`

/** Run fix-calamares-shellprocess.sh for real on a temp root (only its "must be root" guard is cut). */
function runFix(rootDir) {
	const HERE = 'HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"'
	const src = read('tools/eggs/live-usb/fix-calamares-shellprocess.sh')
		.replace(/^\[\[ "\$\(id -u\)" -eq 0 \]\] \|\| \{\n[\s\S]*?\n\}\n/m, '')
		.replace(HERE, 'HERE="$(pwd)"')
	assert.ok(!src.includes('id -u'), 'the root guard is removed')
	// stdin script: HERE is the cwd — the real helper directory. Bash 5.3 (Ubuntu 26.04) treats BASH_SOURCE[0] of a
	// stdin script as unbound under set -u (5.2 gave ""), so the HERE line is pinned to the cwd explicitly.
	assert.ok(src.includes('HERE="$(pwd)"'), 'the HERE line was found')
	return cp.execFileSync('bash', ['-s'], { cwd: LIVE_USB, input: src, encoding: 'utf8', env: { ...process.env, HIGHASCG_CALAMARES_ROOT: rootDir } })
}

function tempRoot(settings) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo721-'))
	fs.mkdirSync(path.join(dir, 'etc/calamares/modules'), { recursive: true })
	fs.writeFileSync(path.join(dir, 'etc/calamares/settings.conf'), settings)
	return dir
}

const count = (s, re) => (s.match(re) || []).length

test('B: a fresh eggs settings.conf gets the release_bridge instance AND the step, once, idempotently', () => {
	const dir = tempRoot(EGGS_SETTINGS)
	try {
		runFix(dir)
		const conf = path.join(dir, 'etc/calamares/settings.conf')
		const once = fs.readFileSync(conf, 'utf8')
		assert.match(once, /\n {2}- id: release_bridge\n {4}module: shellprocess\n {4}config: shellprocess@release_bridge\.conf\n/)
		assert.equal(count(once, /^\s*-\s*id:\s*release_bridge\s*$/gm), 1)
		assert.equal(count(once, /^\s*-\s*shellprocess@release_bridge\s*$/gm), 1)
		const exec = once.slice(once.indexOf('- exec:'))
		assert.ok(exec.indexOf('shellprocess@release_bridge') < exec.indexOf('- partition'), 'released before partition')
		assert.ok(fs.existsSync(path.join(dir, 'etc/calamares/modules/shellprocess@release_bridge.conf')), 'its config is written')
		runFix(dir)
		assert.equal(fs.readFileSync(conf, 'utf8'), once, 'a second run changes nothing')
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('B: the shipped WO-481 state (step scheduled, no instance) gains the instance without a second step', () => {
	const dir = tempRoot(EGGS_SETTINGS.replace('  - exec:\n', '  - exec:\n      - shellprocess@release_bridge\n'))
	try {
		runFix(dir)
		const out = fs.readFileSync(path.join(dir, 'etc/calamares/settings.conf'), 'utf8')
		assert.equal(count(out, /^\s*-\s*id:\s*release_bridge\s*$/gm), 1)
		assert.equal(count(out, /^\s*-\s*shellprocess@release_bridge\s*$/gm), 1, 'the config: line must not fool the step check')
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('B: the squashfs patch aborts the build when the rebuilt image lacks the instance or the step', () => {
	const src = read('tools/eggs/live-usb/patch-iso-squashfs-calamares.sh')
	const gate = src.slice(src.indexOf('# WO-721'))
	assert.match(gate, /unsquashfs -cat "\$SQ" etc\/calamares\/settings\.conf/)
	assert.match(gate, /id:\[\[:space:\]\]\*release_bridge/)
	assert.match(gate, /-\[\[:space:\]\]\*shellprocess@release_bridge\[\[:space:\]\]\*\$/)
	assert.match(gate, /exit 1/)
})

test('A: the status route never spawns eggs, and asks sudo about the launcher itself', () => {
	const calls = []
	const realExecFileSync = cp.execFileSync
	const realAccess = fs.accessSync
	cp.execFileSync = (file, args) => {
		calls.push([file, ...(args || [])])
		return ''
	}
	fs.accessSync = () => {} // every binary "exists" — CI has no Calamares
	try {
		delete require.cache[require.resolve('../../src/api/routes-system-setup')]
		const { detectCalamaresStatus } = require('../../src/api/routes-system-setup')
		const st = detectCalamaresStatus()
		assert.equal(st.installed, true)
		assert.equal(st.sudoLaunchAvailable, true, 'sudo exit 0 for the launcher = allowed')
		assert.ok(!calls.some((c) => /eggs/.test(c[0])), `no eggs spawn: ${JSON.stringify(calls)}`)
		assert.deepEqual(calls.find((c) => c[0] === 'sudo'), ['sudo', '-n', '-l', '/usr/local/bin/launch-calamares.sh'])
	} finally {
		cp.execFileSync = realExecFileSync
		fs.accessSync = realAccess
	}
})

test('A: the pane shows the reason on screen and a failed check does not lock the button', () => {
	const src = read('godot/client/features/settings/nuclear_pane.gd')
	assert.match(src, /_install_why = _note\(""\)/, 'a visible line under the button')
	const fail = src.slice(src.indexOf('if not r.ok or not (r.data is Dictionary):'), src.indexOf('var cs: Dictionary'))
	assert.match(fail, /_install\.disabled = false/, 'unknown status leaves the installer usable (the route re-checks)')
	assert.match(fail, /_install_why\.text = /)
	assert.match(src, /_install_why\.text = \("Calamares not installed on this system"/)
})
