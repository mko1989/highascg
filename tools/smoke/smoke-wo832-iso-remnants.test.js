'use strict'

/**
 * WO-832 — pre-26.04 remnants in the ISO-build / setup / stick-QA scripts.
 *
 * Behavioural where the script can run unprivileged against mocked commands (PATH stubs in a temp dir;
 * nothing touches /etc, apt or the live kernel), source-text pins where it cannot (needs root).
 */
const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
// Code only: the WO-832 comments quote the very idioms they replaced.
const code = (rel) => read(rel).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
const EGGS = path.join(ROOT, 'tools/eggs/live-usb')

function bash(script, env = {}, opts = {}) {
	return spawnSync('bash', ['-c', script], {
		encoding: 'utf8',
		env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
		...opts,
	})
}

let tmp
before(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo832-'))
})
after(() => {
	fs.rmSync(tmp, { recursive: true, force: true })
})

function stub(dir, name, body) {
	fs.mkdirSync(dir, { recursive: true })
	const p = path.join(dir, name)
	fs.writeFileSync(p, `#!/bin/bash\n${body}\n`, { mode: 0o755 })
	return p
}

describe('WO-832 4b: liveroot bind-mount guard fails closed', () => {
	const lib = path.join(EGGS, 'eggs-liveroot-safety.sh')
	const probe = (findmntBody) => {
		const d = fs.mkdtempSync(path.join(tmp, 'fm-'))
		const fm = stub(d, 'findmnt', findmntBody)
		return bash(
			`source "${lib}"; FINDMNT="${fm}"
			if eggs_liveroot_has_host_bind_mounts /home/eggs/liveroot 2>/dev/null; then echo DETECTED; else echo CLEAR; fi`,
		).stdout.trim()
	}

	it('detects bind mounts when there are thousands (the old `| grep -q .` SIGPIPE case)', () => {
		const many = 'for i in $(seq 1 6000); do echo "/home/eggs/liveroot/m$i /usr/m$i[/x] ext4"; done'
		assert.equal(probe(many), 'DETECTED')
	})

	it('the old pipeline really did fail open on that input (proves the test discriminates)', () => {
		const d = fs.mkdtempSync(path.join(tmp, 'old-'))
		const fm = stub(d, 'findmnt', 'for i in $(seq 1 6000); do echo "/home/eggs/liveroot/m$i /usr/m$i[/x] ext4"; done')
		const r = bash(
			`source "${lib}"; FINDMNT="${fm}"
			if eggs_liveroot_list_host_bind_mounts /home/eggs/liveroot 2>/dev/null | "$GREP" -q .; then echo DETECTED; else echo CLEAR; fi`,
		)
		assert.equal(r.stdout.trim(), 'CLEAR', 'old idiom under pipefail reports no mounts for 6000 mounts')
	})

	it('says CLEAR only when no mount sits under the root', () => {
		assert.equal(probe('echo "/ /dev/nvme0n1p2 ext4"; echo "/boot/efi /dev/nvme0n1p1 vfat"'), 'CLEAR')
	})

	it('ignores mounts whose source is inside the root (eggs own staging)', () => {
		assert.equal(probe('echo "/home/eggs/liveroot/x /home/eggs/liveroot/y[/z] ext4"'), 'CLEAR')
	})

	it('treats an unenumerable mount table as UNSAFE', () => {
		assert.equal(probe('exit 3'), 'DETECTED')
	})
})

describe('WO-832 4c: kernel pin vs running kernel', () => {
	/** Build a mocked host: uname -r, installed images, /boot files, pin file. */
	function host({ running, installed, pin }) {
		const d = fs.mkdtempSync(path.join(tmp, 'host-'))
		const bin = path.join(d, 'bin')
		const boot = path.join(d, 'boot')
		fs.mkdirSync(boot)
		for (const k of installed) {
			fs.writeFileSync(path.join(boot, `vmlinuz-${k}`), '')
			fs.writeFileSync(path.join(boot, `initrd.img-${k}`), '')
		}
		const pinFile = path.join(d, 'pinned-kernel')
		if (pin !== null) fs.writeFileSync(pinFile, `${pin}\n`)
		const yaml = path.join(d, 'eggs.yaml')
		fs.writeFileSync(yaml, 'vmlinuz: /boot/vmlinuz-old\ninitrd_img: /boot/initrd.img-old\n')
		const log = path.join(d, 'apt.log')
		fs.writeFileSync(log, '')
		stub(bin, 'id', 'echo 0')
		stub(bin, 'uname', `echo ${running}`)
		stub(bin, 'apt-get', `echo "$@" >>"${log}"`)
		stub(bin, 'update-initramfs', 'true')
		stub(bin, 'update-grub', 'true')
		const rows = installed.map((k) => `ii  linux-image-${k}  1  amd64  x`).join('\\n')
		stub(
			bin,
			'dpkg',
			`[ "$1" = -l ] && printf '${rows}\\n'; exit 0`,
		)
		const insttab = installed.map((k) => `linux-image-${k}`).join(' ')
		stub(
			bin,
			'dpkg-query',
			`for a; do case "$a" in linux-image-*) for p in ${insttab}; do [ "$p" = "$a" ] && { printf 'install ok installed'; exit 0; }; done; exit 1;; esac; done; exit 1`,
		)
		const env = {
			PATH: `${bin}:${process.env.PATH}`,
			HIGHASCG_PIN_FILE: pinFile,
			HIGHASCG_BOOT_DIR: boot,
			EGGS_YAML: yaml,
			HIGHASCG_SKIP_HOST_INITRAMFS: '1',
		}
		return { d, env, log, yaml, pinFile }
	}
	const SYNC = path.join(EGGS, 'sync-eggs-kernel-and-purge-stale.sh')

	it('stale pin (6.8.0-117 installed, box runs 7.0.0-38): sync refuses, changes nothing, purges nothing', () => {
		const h = host({ running: '7.0.0-38-generic', installed: ['6.8.0-117-generic', '7.0.0-38-generic'], pin: '6.8.0-117-generic' })
		const r = spawnSync('bash', [SYNC], { encoding: 'utf8', env: h.env })
		assert.equal(r.status, 1, r.stdout + r.stderr)
		assert.match(r.stderr, /refusing to purge linux-image-7\.0\.0-38-generic/)
		assert.equal(fs.readFileSync(h.log, 'utf8'), '', 'no apt-get purge call')
		assert.match(fs.readFileSync(h.yaml, 'utf8'), /vmlinuz-old/, 'eggs.yaml untouched')
	})

	it('pin names a kernel that is not installed: sync fails loudly with the owner fix', () => {
		const h = host({ running: '7.0.0-38-generic', installed: ['7.0.0-38-generic'], pin: '6.8.0-117-generic' })
		const r = spawnSync('bash', [SYNC], { encoding: 'utf8', env: h.env })
		assert.equal(r.status, 1)
		assert.match(r.stderr, /not an installed kernel/)
		assert.match(r.stderr, /sudo tee/)
		assert.equal(fs.readFileSync(h.log, 'utf8'), '')
	})

	it('fixed pin (= running): purges the OLD image only, never the running one', () => {
		const h = host({ running: '7.0.0-38-generic', installed: ['6.8.0-117-generic', '7.0.0-38-generic'], pin: '7.0.0-38-generic' })
		const r = spawnSync('bash', [SYNC], { encoding: 'utf8', env: h.env })
		assert.equal(r.status, 0, r.stdout + r.stderr)
		const log = fs.readFileSync(h.log, 'utf8')
		assert.match(log, /purge linux-image-6\.8\.0-117-generic/)
		assert.ok(!/purge linux-image-7\.0\.0-38-generic/.test(log), 'running kernel must not be purged')
		assert.match(fs.readFileSync(h.yaml, 'utf8'), /vmlinuz: .*vmlinuz-7\.0\.0-38-generic/)
	})

	it('highascg_assert_pin_valid rejects garbage in the pin file', () => {
		const h = host({ running: '7.0.0-38-generic', installed: ['7.0.0-38-generic'], pin: 'not a kernel' })
		const r = bash(`source "${path.join(EGGS, 'eggs-kernel-lib.sh')}"; highascg_assert_pin_valid`, h.env)
		assert.equal(r.status, 1)
		assert.match(r.stderr, /not a kernel release/)
	})

	it('verify-eggs-prepare-host.sh no longer demands root-owned literals from the 6.8 era', () => {
		const v = read('tools/eggs/live-usb/verify-eggs-prepare-host.sh')
		assert.match(v, /highascg_assert_pin_valid/)
		assert.ok(!/01-kernel-117\.sh/.test(code('tools/eggs/live-usb/verify-eggs-prepare-host.sh')), 'stale hint to the 24.04 kernel installer removed')
	})

	it('squashfs verifier no longer falls back to the 6.8 literal', () => {
		assert.ok(!/6\.8\.0-117/.test(code('tools/eggs/live-usb/verify-iso-squashfs-excludes.sh')))
	})
})

describe('WO-832 4a: eggs theme path', () => {
	it('eggs-theme-lib prefers the new branding.default and falls back to /usr/lib', () => {
		const lib = code('tools/eggs/live-usb/eggs-theme-lib.sh')
		assert.ok(lib.indexOf('/etc/penguins-eggs.d/branding.default') < lib.indexOf('/usr/lib/penguins-eggs/addons/eggs/theme'))
	})

	it('an explicit EGGS_THEME with livecd/ wins; one without livecd/ is skipped', () => {
		const good = path.join(tmp, 'theme-good')
		fs.mkdirSync(path.join(good, 'livecd'), { recursive: true })
		const bad = path.join(tmp, 'theme-bad')
		fs.mkdirSync(bad)
		const libp = path.join(EGGS, 'eggs-theme-lib.sh')
		assert.equal(bash(`source "${libp}"; highascg_eggs_theme_dir`, { EGGS_THEME: good }).stdout.trim(), good)
		const r = bash(`source "${libp}"; highascg_eggs_theme_dir`, { EGGS_THEME: bad })
		assert.notEqual(r.stdout.trim(), bad)
	})

	it('the grub-theme installer, verifier and branding checks use the lib, not the removed path', () => {
		for (const f of ['install-eggs-live-grub-theme.sh', 'verify-eggs-prepare-host.sh', 'finalize-boot-branding-for-eggs-produce.sh', 'verify-iso-boot-branding.sh']) {
			const t = code(`tools/eggs/live-usb/${f}`)
			assert.match(t, /eggs-theme-lib\.sh/, f)
			assert.ok(!/^[A-Z_]+="(\$\{[A-Z_]+:-)?\/usr\/lib\/penguins-eggs\/addons\/eggs\/theme/m.test(t), `${f} must not hard-code the removed path`)
		}
	})
})

describe('WO-832 4d: 08-caspar-cef-scanner.sh keeps casparcg-server enabled', () => {
	const t = code('scripts/setup/08-caspar-cef-scanner.sh')
	it('looks for 13-caspar-systemd-units.sh next to itself (SETUP_DIR), not in the repo root', () => {
		assert.match(t, /\$\{SETUP_DIR\}\/13-caspar-systemd-units\.sh/)
		assert.ok(!/\$\{SCRIPT_DIR\}\/13-caspar-systemd-units\.sh/.test(t))
	})
	it('never stops or disables casparcg-server', () => {
		assert.ok(!/systemctl (stop|disable) casparcg-server/.test(t))
	})
	it('SETUP_DIR resolves to the directory holding 13-caspar-systemd-units.sh', () => {
		const r = bash(`source "${ROOT}/scripts/setup/lib/common.sh"; ls "$SETUP_DIR/13-caspar-systemd-units.sh"`)
		assert.equal(r.status, 0, r.stderr)
	})
})

describe('WO-832: legacy 24.04 setup steps refuse on 26.04', () => {
	it('01/02/03 call require_legacy_2404', () => {
		for (const f of ['01-kernel-117.sh', '02-verify-kernel-117.sh', '03-nvidia-open-595.sh']) {
			assert.match(read(`scripts/setup/${f}`), /^require_legacy_2404$/m, f)
		}
	})
	it('require_legacy_2404 exits 1 with the owner fix unless VERSION_ID is 24.04 or overridden', () => {
		const run = (env) =>
			bash(`source "${ROOT}/scripts/setup/lib/common.sh"; require_legacy_2404; echo PASSED`, env)
		const osr = fs.readFileSync('/etc/os-release', 'utf8')
		if (/^VERSION_ID="?24\.04/m.test(osr)) return // on a real 24.04 host the guard (rightly) passes
		const r = run({})
		assert.equal(r.status, 1)
		assert.match(r.stderr, /pinned-kernel/)
		assert.match(run({ HIGHASCG_ALLOW_LEGACY_2404: '1' }).stdout, /PASSED/)
	})
})

describe('WO-832: NVIDIA driver branch is detected, not whitelisted', () => {
	it('build-highascg-egg.sh accepts any 3-digit branch and defaults to the installed one', () => {
		const t = read('tools/eggs/live-usb/build-highascg-egg.sh')
		assert.ok(!/535 \| 580 \| 595\) ;;/.test(t), 'hard-coded whitelist gone')
		assert.match(t, /highascg_installed_nvidia_branch/)
		assert.match(t, /\[0-9\]\{3\}/)
	})
	it('licence collector no longer lists only 595/580/535', () => {
		const t = read('tools/release/collect-third-party-licenses.sh')
		assert.ok(!/for p in nvidia-driver-595-open nvidia-driver-580-open/.test(t))
		assert.match(t, /highascg_installed_nvidia_branch/)
	})
	it('install-helpers-runtime persistenced selection accepts any branch', () => {
		const t = read('scripts/lib/install-helpers-runtime.sh')
		assert.ok(!/535 \| 580 \| 595\)/.test(t))
	})
	it('nvidia-branch.sh parses version -> branch', () => {
		// Mock nvidia-smi on PATH; /sys and /proc may or may not carry a real module, so assert the shape only.
		const d = fs.mkdtempSync(path.join(tmp, 'nv-'))
		stub(d, 'nvidia-smi', 'echo 615.71.09')
		const r = bash(`source "${ROOT}/scripts/lib/nvidia-branch.sh"; highascg_installed_nvidia_branch`, { PATH: `${d}:${process.env.PATH}` })
		assert.match(r.stdout.trim(), /^\d{3}$/)
	})
})

describe('WO-832: 26.04 package names', () => {
	it('13-usb-ingest installs polkitd/pkexec, not policykit-1', () => {
		const t = read('scripts/setup/13-usb-ingest.sh')
		assert.ok(!/apt-get install[^\n]*policykit-1/.test(t))
		assert.match(t, /apt-get install -y udisks2 polkitd pkexec/)
	})
	it('05-caspar-deps does not hard-code libsfml-*2.6 / boost 1.83 in the apt install', () => {
		const t = read('scripts/setup/05-caspar-deps.sh')
		const install = t.slice(t.indexOf('apt-get install -y \\\n\tcurl'))
		assert.ok(!/libsfml-graphics2\.6/.test(install))
		assert.ok(!/libboost-log1\.83\.0/.test(install))
		assert.match(t, /libsfml-\$\{part\}3\.0/)
	})
})

describe('WO-832 §7e: findmnt and stick QA', () => {
	it('no script uses the non-existent `findmnt -L`', () => {
		for (const f of ['tools/startup/stick-boot-test/stick-test-lib.sh', 'tools/startup/stick-boot-test/tests/test-03-exfat-operator.sh', 'tools/eggs/live-usb/flash-stick-common.sh']) {
			const t = read(f)
			assert.ok(!/findmnt[^\n]* -L /.test(t), f)
			assert.match(t, /findmnt[^\n]*-S "?LABEL=/, f)
		}
	})
	it('findmnt -S LABEL= is a valid invocation here (exit 1 = no match, not a usage error 2)', () => {
		const r = spawnSync('findmnt', ['-rn', '-o', 'TARGET', '-S', 'LABEL=WO832_NO_SUCH_LABEL'], { encoding: 'utf8' })
		assert.equal(r.status, 1)
	})
	it('test-05/test-09 do not use `grep -c … || echo 0`', () => {
		for (const f of ['test-05-systemd-wo47.sh', 'test-09-openbox-wiring.sh']) {
			const t = code(`tools/startup/stick-boot-test/tests/${f}`)
			assert.ok(!/grep -c[^\n]*\|\| echo 0/.test(t), f)
		}
	})
	it('`grep -c || true` yields a single number when nothing matches (the old idiom yielded "0\\n0")', () => {
		assert.equal(bash(`printf 'a\\n' | grep -cv a || true`).stdout, '0\n')
		assert.equal(bash(`printf 'a\\n' | grep -cv a || echo 0`).stdout, '0\n0\n')
	})
	it('test-12 skips without ending the runner (sourced file must not exit)', () => {
		const t = path.join(ROOT, 'tools/startup/stick-boot-test')
		const r = bash(`source "${t}/stick-test-lib.sh"; st_exfat_label_mounted() { return 1; }; source "${t}/tests/test-12-exfat-network-conf.sh"; echo AFTER_TEST_12`)
		assert.match(r.stdout, /AFTER_TEST_12/)
		assert.ok(!/^\s*exit\b/m.test(read('tools/startup/stick-boot-test/tests/test-12-exfat-network-conf.sh')))
	})
	describe('run.sh supervisor counting', () => {
		const lib = path.join(ROOT, 'tools/startup/run-sh-supervisors-lib.sh')
		const count = (ps) => {
			const f = path.join(tmp, `ps-${Math.random().toString(36).slice(2)}.sh`)
			fs.writeFileSync(f, `#!/bin/bash\ncat <<'EOF'\n${ps}\nEOF\n`, { mode: 0o755 })
			return bash(`source "${lib}"; st_count_run_sh_supervisors`, { ST_PS_CMD: f }).stdout.trim()
		}
		it('one supervisor plus its forked sub-shell counts as 1 (test-06 false FAIL)', () => {
			assert.equal(
				count(
					[
						'1190203       1 /bin/sh /home/casparcg/highascg/run.sh',
						'1326610 1190203 /home/casparcg/highascg/bin/casparcg /home/casparcg/highascg/config/casparcg.config',
						'1326612 1190203 /bin/sh /home/casparcg/highascg/run.sh',
						' 3074927       1 /bin/bash -c pgrep -af run.sh',
					].join('\n'),
				),
				'1',
			)
		})
		it('two independent supervisors (Openbox + systemd duplicate) still count as 2', () => {
			assert.equal(
				count(['100 1 /bin/sh /home/casparcg/highascg/run.sh', '200 1 /bin/sh /home/casparcg/highascg/run.sh'].join('\n')),
				'2',
			)
		})
		it('no supervisor counts as 0', () => {
			assert.equal(count('1 0 /sbin/init'), '0')
		})
		it('test-06 and verify-highascg-stick-boot.sh use it instead of pgrep -f run.sh', () => {
			assert.match(read('tools/startup/stick-boot-test/tests/test-06-caspar-supervisor.sh'), /st_count_run_sh_supervisors/)
			const v = code('tools/eggs/live-usb/verify-highascg-stick-boot.sh')
			assert.match(v, /st_count_run_sh_supervisors/)
			assert.ok(!/pgrep -cf/.test(v))
		})
	})
	it('diagnose-screen-consumers.sh queries the API port (4200), not the Vite dev port file (4350)', () => {
		const t = code('tools/startup/diagnose-screen-consumers.sh')
		assert.ok(!/webui-port\.json/.test(t))
		assert.match(t, /HIGHASCG_HTTP_PORT:-4200/)
	})
})
