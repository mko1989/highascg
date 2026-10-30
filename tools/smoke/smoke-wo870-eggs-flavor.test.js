'use strict'

/**
 * WO-870 Phase 1 — the ISO build scripts are gated on the penguins-eggs flavor (offline, no root, no real eggs).
 *
 * Every case runs bash with PATH = <temp stub dir>:<temp dir of tool symlinks>, so the real /usr/bin/eggs (coa)
 * is unreachable. Each scenario first asserts `command -v eggs` resolves to the stub, before anything runs.
 * The stub behaves like the real CLIs: cobra-style `Error: unknown flag: --max` for the removed flags on the new
 * flavor, `unknown command "remaster"` on the legacy one, and a `--help` command list the probe classifies.
 */
const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const EGGS = path.join(ROOT, 'tools/eggs/live-usb')
const CLI_LIB = path.join(EGGS, 'eggs-cli-lib.sh')
const RUN_LIB = path.join(EGGS, 'eggs-run-lib.sh')
const KERNEL_LIB = path.join(EGGS, 'eggs-kernel-lib.sh')
const SYNC = path.join(EGGS, 'sync-eggs-kernel-and-purge-stale.sh')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const code = (rel) => read(rel).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')

const REMOVED = ['--nointeractive', '--max', '--excludes', '--basename', '--theme']
const TOOLS = ['bash', 'readlink', 'basename', 'timeout', 'grep', 'awk', 'dirname', 'tee', 'mktemp', 'sed', 'cat', 'tr', 'sort', 'tail', 'head', 'env', 'seq', 'cut', 'sha256sum', 'uname']

const NEW_HELP = `penguins-eggs (eggs) is the universal live system remastering framework.

Usage:
  eggs [command]

Available Commands:
  destroy     Free the nest and unmount filesystems
  remaster    Start a system remastering (ISO production)
  sysinstall  Launch the system installer (GUI or TUI)
  version     Print the version number of eggs
`
const LEGACY_HELP = `Perfect your system, spread it, share it

COMMANDS
  dad         ask help from daddy
  kill        free the nest
  produce     produce a live image from your system
`

/** A fake eggs. flavor 'new' = remaster CLI (cobra), 'legacy' = produce CLI. Records argv + call order. */
function eggsStub(flavor) {
	const help = flavor === 'new' ? NEW_HELP : LEGACY_HELP
	const sub = flavor === 'new' ? 'remaster' : 'produce'
	const other = flavor === 'new' ? 'produce' : 'remaster'
	return `#!/bin/bash
for a in "$@"; do
  if [ "$a" = --help ] || [ "$a" = -h ]; then cat <<'HELP'
${help}HELP
    exit 0
  fi
done
if [ "$1" = "${other}" ]; then echo "Error: unknown command \\"$1\\" for \\"eggs\\"" >&2; exit 1; fi
if [ "$1" != "${sub}" ]; then echo "stub: unsupported command $1" >&2; exit 2; fi
${flavor === 'new' ? `for a in "$@"; do case "$a" in ${REMOVED.join('|')}) echo "Error: unknown flag: $a" >&2; exit 1;; esac; done` : ''}
printf '%s\\n' "$@" >"$EGGS_STUB_DIR/argv"
echo "eggs" >>"$EGGS_STUB_DIR/order"
exit "\${EGGS_STUB_RC:-0}"
`
}

let tmp
before(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo870-flavor-'))
})
after(() => {
	fs.rmSync(tmp, { recursive: true, force: true })
})

/** One isolated scenario: stub dir (first on PATH) + tool-symlink dir. `stubs` = { name: body }. */
function scenario(stubs = {}) {
	const d = fs.mkdtempSync(path.join(tmp, 's-'))
	const stubDir = path.join(d, 'stubbin')
	const toolDir = path.join(d, 'tools')
	fs.mkdirSync(stubDir)
	fs.mkdirSync(toolDir)
	for (const t of TOOLS) {
		for (const base of ['/usr/bin', '/bin']) {
			if (fs.existsSync(path.join(base, t))) {
				fs.symlinkSync(path.join(base, t), path.join(toolDir, t))
				break
			}
		}
	}
	for (const [name, body] of Object.entries(stubs)) fs.writeFileSync(path.join(stubDir, name), body, { mode: 0o755 })
	const env = { PATH: `${stubDir}:${toolDir}`, HOME: d, EGGS_STUB_DIR: d }
	return { d, stubDir, env }
}

function bash(sc, script, extraEnv = {}) {
	return spawnSync('/bin/bash', ['-c', script], { encoding: 'utf8', env: { ...sc.env, ...extraEnv } })
}

const flavorOf = (sc, extraEnv) => {
	const r = bash(sc, `source "${CLI_LIB}"; highascg_eggs_flavor`, extraEnv)
	assert.equal(r.status, 0, r.stderr)
	return r.stdout.trim()
}

/** Stub config scripts that record their call order next to the eggs stub. */
function configStubs(sc, verifyRc = 0) {
	const inst = path.join(sc.d, 'install-config.sh')
	const ver = path.join(sc.d, 'verify-config.sh')
	fs.writeFileSync(inst, `#!/bin/bash\necho "install $*" >>"$EGGS_STUB_DIR/order"\n`, { mode: 0o755 })
	fs.writeFileSync(ver, `#!/bin/bash\necho verify >>"$EGGS_STUB_DIR/order"\nexit ${verifyRc}\n`, { mode: 0o755 })
	return { HIGHASCG_EGGS_INSTALL_CONFIG: inst, HIGHASCG_EGGS_VERIFY_CONFIG: ver }
}

const argvOf = (sc) => fs.readFileSync(path.join(sc.d, 'argv'), 'utf8').trimEnd().split('\n')
const orderOf = (sc) => (fs.existsSync(path.join(sc.d, 'order')) ? fs.readFileSync(path.join(sc.d, 'order'), 'utf8').trim().split('\n') : [])

describe('WO-870 isolation: the stub is never the real eggs', () => {
	it('command -v eggs resolves to the stub dir, and the real /usr/bin/eggs is unreachable', () => {
		const sc = scenario({ eggs: eggsStub('new') })
		const r = bash(sc, 'command -v eggs')
		assert.equal(r.stdout.trim(), path.join(sc.stubDir, 'eggs'))
		const none = scenario()
		assert.equal(bash(none, 'command -v eggs || echo MISSING').stdout.trim(), 'MISSING')
	})
})

describe('WO-870 highascg_eggs_flavor', () => {
	it('new: --help lists remaster', () => {
		const sc = scenario({ eggs: eggsStub('new') })
		assert.equal(bash(sc, 'command -v eggs').stdout.trim(), path.join(sc.stubDir, 'eggs'))
		assert.equal(flavorOf(sc), 'new')
	})

	it('legacy: --help lists produce', () => {
		const sc = scenario({ eggs: eggsStub('legacy') })
		assert.equal(bash(sc, 'command -v eggs').stdout.trim(), path.join(sc.stubDir, 'eggs'))
		assert.equal(flavorOf(sc), 'legacy')
	})

	it('none: no eggs on PATH, and an eggs whose help names neither command', () => {
		assert.equal(flavorOf(scenario()), 'none')
		const odd = scenario({ eggs: '#!/bin/bash\necho "hello"\n' })
		assert.equal(flavorOf(odd), 'none')
	})

	it('a binary that resolves to .../coa is new WITHOUT being executed', () => {
		const sc = scenario({ coa: '#!/bin/bash\ntouch "$EGGS_STUB_DIR/coa-was-run"\n' })
		fs.symlinkSync(path.join(sc.stubDir, 'coa'), path.join(sc.stubDir, 'eggs'))
		assert.equal(bash(sc, 'readlink -f "$(command -v eggs)"').stdout.trim(), path.join(sc.stubDir, 'coa'))
		assert.equal(flavorOf(sc), 'new')
		assert.ok(!fs.existsSync(path.join(sc.d, 'coa-was-run')), 'the probe must not run coa')
	})

	it('EGGS_BIN=eggs-legacy picks the legacy binary even when a new eggs is first on PATH', () => {
		const sc = scenario({ eggs: eggsStub('new'), 'eggs-legacy': eggsStub('legacy') })
		assert.equal(flavorOf(sc), 'new')
		assert.equal(flavorOf(sc, { EGGS_BIN: 'eggs-legacy' }), 'legacy')
		const r = bash(sc, `source "${CLI_LIB}"; highascg_eggs_bin; highascg_eggs_conf_dir`, { EGGS_BIN: 'eggs-legacy' })
		assert.deepEqual(r.stdout.trim().split('\n'), [path.join(sc.stubDir, 'eggs-legacy'), '/etc/penguins-eggs-legacy.d'])
	})

	it('HIGHASCG_EGGS_BIN names a missing binary: none', () => {
		const sc = scenario({ eggs: eggsStub('new') })
		assert.equal(flavorOf(sc, { HIGHASCG_EGGS_BIN: 'no-such-eggs' }), 'none')
	})

	it('conf dir, nest and ISO globs follow the flavor', () => {
		const q = (sc, fn) => bash(sc, `source "${CLI_LIB}"; ${fn}`).stdout.trim()
		const n = scenario({ eggs: eggsStub('new') })
		const l = scenario({ eggs: eggsStub('legacy') })
		assert.equal(q(n, 'highascg_eggs_conf_dir'), '/etc/penguins-eggs.d')
		assert.equal(q(l, 'highascg_eggs_conf_dir'), '/etc/penguins-eggs.d', 'old `eggs` keeps the old dir; only eggs-legacy moves')
		assert.equal(q(n, 'highascg_eggs_nest'), '/home/eggs')
		assert.equal(q(n, 'highascg_eggs_iso_glob highascg-nvidia-615'), 'highascg-nvidia-615-*.iso')
		assert.equal(q(l, 'highascg_eggs_iso_glob highascg-nvidia-615'), 'highascg-nvidia-615_*.iso')
		assert.equal(q(scenario(), 'highascg_eggs_iso_glob b'), 'b-*.iso\nb_*.iso')
		assert.equal(bash(n, `source "${CLI_LIB}"; highascg_eggs_conf_dir`, { EGGS_CONF_DIR: '/x/y' }).stdout.trim(), '/x/y')
	})
})

describe('WO-870 highascg_eggs_build_iso: new flavor', () => {
	const build = (sc, extra = {}) =>
		bash(sc, `source "${RUN_LIB}"; highascg_eggs_build_iso highascg-nvidia-615 /theme/dir`, {
			HIGHASCG_FINDMNT: path.join(sc.d, 'findmnt-none'),
			...configStubs(sc),
			...extra,
		})

	function withFindmnt(sc, body) {
		fs.writeFileSync(path.join(sc.d, 'findmnt-none'), `#!/bin/bash\n${body}\n`, { mode: 0o755 })
	}

	it('runs `remaster --clone --anonymous` with none of the removed flags, after apply + verify of the config', () => {
		const sc = scenario({ eggs: eggsStub('new') })
		withFindmnt(sc, 'exit 0')
		assert.equal(bash(sc, 'command -v eggs').stdout.trim(), path.join(sc.stubDir, 'eggs'))
		const r = build(sc)
		assert.equal(r.status, 0, r.stdout + r.stderr)
		assert.deepEqual(argvOf(sc), ['remaster', '--clone', '--anonymous'])
		for (const f of REMOVED) assert.ok(!argvOf(sc).includes(f), `${f} must not be passed`)
		assert.deepEqual(orderOf(sc), ['install --apply', 'verify', 'eggs'])
		assert.ok(!/(basename|theme)/i.test(argvOf(sc).join(' ')), 'basename/theme live in custom.yaml and the branding dir')
	})

	it('the stub really rejects the removed flags (the test discriminates)', () => {
		const sc = scenario({ eggs: eggsStub('new') })
		for (const f of REMOVED) {
			const r = bash(sc, `eggs remaster ${f} x`)
			assert.equal(r.status, 1)
			assert.match(r.stderr, new RegExp(`Error: unknown flag: ${f}`))
		}
	})

	it('HIGHASCG_EGGS_STOP_AFTER is passed through as --stop-after STEP', () => {
		const sc = scenario({ eggs: eggsStub('new') })
		withFindmnt(sc, 'exit 0')
		const r = build(sc, { HIGHASCG_EGGS_STOP_AFTER: 'mount-logic' })
		assert.equal(r.status, 0, r.stdout + r.stderr)
		assert.deepEqual(argvOf(sc), ['remaster', '--clone', '--anonymous', '--stop-after', 'mount-logic'])
		assert.match(r.stdout, /remaster --clone --anonymous --stop-after mount-logic/, 'the command line is printed')
	})

	it('a failing config verify stops before eggs runs', () => {
		const sc = scenario({ eggs: eggsStub('new') })
		withFindmnt(sc, 'exit 0')
		const r = bash(sc, `source "${RUN_LIB}"; highascg_eggs_build_iso b /t`, {
			HIGHASCG_FINDMNT: path.join(sc.d, 'findmnt-none'),
			...configStubs(sc, 1),
		})
		assert.equal(r.status, 1)
		assert.match(r.stderr, /verify-eggs-config\.sh failed/)
		assert.deepEqual(orderOf(sc), ['install --apply', 'verify'])
	})

	it('eggs failure: exit status survives (also through the tee log), mounts left => reboot, do not rm', () => {
		const sc = scenario({ eggs: eggsStub('new') })
		withFindmnt(sc, 'echo /home/eggs/liveroot/usr; echo /home/eggs/liveroot/proc')
		const log = path.join(sc.d, 'build.log')
		const r = build(sc, { EGGS_STUB_RC: '7', HIGHASCG_EGGS_LOG: log })
		assert.equal(r.status, 7, r.stdout + r.stderr)
		assert.match(r.stderr, /reboot, do not rm/)
		assert.match(r.stderr, /mounts under \/home\/eggs/)
		assert.ok(fs.existsSync(log))
	})

	it('eggs failure with nothing mounted: status kept, no reboot advice', () => {
		const sc = scenario({ eggs: eggsStub('new') })
		withFindmnt(sc, 'echo /; echo /boot/efi')
		const r = build(sc, { EGGS_STUB_RC: '3' })
		assert.equal(r.status, 3)
		assert.ok(!/reboot, do not rm/.test(r.stderr))
		assert.match(r.stderr, /no mounts left/)
	})

	it('flavor none refuses without running anything', () => {
		const sc = scenario()
		const r = bash(sc, `source "${RUN_LIB}"; highascg_eggs_build_iso b /t`, configStubs(sc))
		assert.equal(r.status, 1)
		assert.match(r.stderr, /no usable penguins-eggs/)
		assert.deepEqual(orderOf(sc), [])
	})
})

describe('WO-870 highascg_eggs_build_iso: legacy flavor', () => {
	const build = (sc, extra = {}) =>
		bash(sc, `source "${RUN_LIB}"; highascg_eggs_build_iso highascg-nvidia-615 /theme/dir`, {
			HIGHASCG_FINDMNT: path.join(sc.d, 'findmnt-none'),
			...configStubs(sc),
			...extra,
		})

	it('the produce line is exactly today\'s, and the managed config is NOT applied', () => {
		const sc = scenario({ eggs: eggsStub('legacy') })
		fs.writeFileSync(path.join(sc.d, 'findmnt-none'), '#!/bin/bash\nexit 0\n', { mode: 0o755 })
		assert.equal(bash(sc, 'command -v eggs').stdout.trim(), path.join(sc.stubDir, 'eggs'))
		const r = build(sc)
		assert.equal(r.status, 0, r.stdout + r.stderr)
		assert.equal(
			argvOf(sc).join(' '),
			'produce --nointeractive --clone --max --excludes static --basename highascg-nvidia-615 --theme /theme/dir',
		)
		assert.deepEqual(orderOf(sc), ['eggs'])
	})

	it('EGGS_BIN=eggs-legacy runs the legacy binary', () => {
		const sc = scenario({ eggs: eggsStub('new'), 'eggs-legacy': eggsStub('legacy') })
		fs.writeFileSync(path.join(sc.d, 'findmnt-none'), '#!/bin/bash\nexit 0\n', { mode: 0o755 })
		const r = build(sc, { EGGS_BIN: 'eggs-legacy' })
		assert.equal(r.status, 0, r.stdout + r.stderr)
		assert.equal(argvOf(sc)[0], 'produce')
	})

	it('HIGHASCG_EGGS_STOP_AFTER is refused (legacy has no --stop-after) and nothing runs', () => {
		const sc = scenario({ eggs: eggsStub('legacy') })
		const r = build(sc, { HIGHASCG_EGGS_STOP_AFTER: 'mount-logic' })
		assert.equal(r.status, 2)
		assert.deepEqual(orderOf(sc), [])
	})

	it('the legacy line in eggs-run-lib.sh is the original text, once', () => {
		const lib = read('tools/eggs/live-usb/eggs-run-lib.sh')
		const line = '"$bin" produce --nointeractive --clone --max --excludes static --basename "${basename}" --theme "${theme}"'
		assert.equal(lib.split(line).length - 1, 1)
	})
})

describe('WO-870 call sites use the lib, not a literal eggs command', () => {
	for (const rel of ['tools/eggs/live-usb/build-highascg-egg.sh', 'work/run-eggs-produce-clone-only.sh']) {
		it(`${rel}: calls highascg_eggs_build_iso and no direct produce/remaster line`, () => {
			const c = code(rel)
			assert.match(c, /highascg_eggs_build_iso "\$\{BASENAME\}" "\$\{THEME_ABS\}"/)
			assert.match(c, /source "\$\{(HERE|LIVE_USB)\}\/eggs-run-lib\.sh"/)
			assert.ok(!/^\s*eggs (produce|remaster)\b/m.test(c))
			assert.ok(!/--(nointeractive|max|excludes|basename|theme)\b/.test(c), 'removed eggs flags belong only in the lib legacy branch')
		})
	}
})

describe('WO-870 kernel: pin is an assertion under the new flavor', () => {
	/** Mocked host (mirrors smoke-wo832): uname -r, installed images, pin file. Nothing touches /etc or apt. */
	function host({ running, installed, pin }) {
		const sc = scenario({
			id: '#!/bin/bash\necho 0\n',
			uname: `#!/bin/bash\necho ${running}\n`,
			'apt-get': '#!/bin/bash\necho "$@" >>"$EGGS_STUB_DIR/apt.log"\n',
			'update-initramfs': '#!/bin/bash\n',
			'update-grub': '#!/bin/bash\n',
			dpkg: `#!/bin/bash\n[ "$1" = -l ] && printf '${installed.map((k) => `ii  linux-image-${k}  1  amd64  x`).join('\\n')}\\n'; exit 0\n`,
			'dpkg-query': `#!/bin/bash\nfor a; do case "$a" in ${installed.map((k) => `linux-image-${k}`).join('|')}) printf 'install ok installed'; exit 0;; esac; done; exit 1\n`,
		})
		fs.rmSync(path.join(sc.d, 'tools', 'uname'), { force: true })
		const boot = path.join(sc.d, 'boot')
		fs.mkdirSync(boot)
		for (const k of installed) for (const f of ['vmlinuz', 'initrd.img']) fs.writeFileSync(path.join(boot, `${f}-${k}`), '')
		const pinFile = path.join(sc.d, 'pinned-kernel')
		if (pin !== null) fs.writeFileSync(pinFile, `${pin}\n`)
		const yaml = path.join(sc.d, 'eggs.yaml') // deliberately NOT created
		const env = { HIGHASCG_PIN_FILE: pinFile, HIGHASCG_BOOT_DIR: boot, EGGS_YAML: yaml, HIGHASCG_SKIP_HOST_INITRAMFS: '1', HIGHASCG_EGGS_FLAVOR: 'new' }
		return { sc, env, yaml }
	}
	const aptLog = (h) => (fs.existsSync(path.join(h.sc.d, 'apt.log')) ? fs.readFileSync(path.join(h.sc.d, 'apt.log'), 'utf8') : '')

	it('highascg_assert_running_is_pin: equal passes, different fails with the owner fix, no pin file passes', () => {
		const ok = host({ running: '7.0.0-38-generic', installed: ['7.0.0-38-generic'], pin: '7.0.0-38-generic' })
		const run = (h) => bash(h.sc, `source "${KERNEL_LIB}"; highascg_assert_running_is_pin`, h.env)
		assert.equal(run(ok).status, 0)
		const bad = host({ running: '7.0.0-38-generic', installed: ['6.8.0-117-generic', '7.0.0-38-generic'], pin: '6.8.0-117-generic' })
		const r = run(bad)
		assert.equal(r.status, 1)
		assert.match(r.stderr, /RUNNING kernel/)
		assert.match(r.stderr, /sudo tee/)
		const none = host({ running: '7.0.0-38-generic', installed: ['7.0.0-38-generic'], pin: null })
		assert.equal(run(none).status, 0)
	})

	it('sync under new: no eggs.yaml needed or written, running==pin, old image purged', () => {
		const h = host({ running: '7.0.0-38-generic', installed: ['6.8.0-117-generic', '7.0.0-38-generic'], pin: '7.0.0-38-generic' })
		const r = bash(h.sc, `bash "${SYNC}"`, h.env)
		assert.equal(r.status, 0, r.stdout + r.stderr)
		assert.match(r.stdout, /no eggs\.yaml edit/)
		assert.ok(!fs.existsSync(h.yaml), 'eggs.yaml must not be created')
		assert.match(aptLog(h), /purge linux-image-6\.8\.0-117-generic/)
		assert.ok(!/purge linux-image-7\.0\.0-38-generic/.test(aptLog(h)))
	})

	it('sync under new: pin != running is a hard FAIL that changes and purges nothing', () => {
		const h = host({ running: '7.0.0-38-generic', installed: ['6.8.0-117-generic', '7.0.0-38-generic'], pin: '6.8.0-117-generic' })
		const r = bash(h.sc, `bash "${SYNC}"`, h.env)
		assert.equal(r.status, 1)
		assert.match(r.stderr, /pins 6\.8\.0-117-generic but the box runs 7\.0\.0-38-generic/)
		assert.equal(aptLog(h), '')
	})

	it('sync under legacy still demands eggs.yaml (unchanged behavior)', () => {
		const h = host({ running: '7.0.0-38-generic', installed: ['7.0.0-38-generic'], pin: '7.0.0-38-generic' })
		const r = bash(h.sc, `bash "${SYNC}"`, { ...h.env, HIGHASCG_EGGS_FLAVOR: 'legacy' })
		assert.equal(r.status, 1)
		assert.match(r.stderr, /Missing .*eggs\.yaml/)
	})
})
