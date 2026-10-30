'use strict'

/**
 * WO-870 Phase 5 — ISO finders, the liveroot busy guard and the ISO verifiers know the eggs 26.10 (coa) layout.
 *
 * 1. find_newest_iso_since: both flavors' names (`<base>-<date>.iso` in the nest, `<base>_amd64_<date>.iso` in
 *    nest or mnt/), exact prefix, and a coa target_dir symlink dated by its TARGET (stat -L).
 * 2. eggs_liveroot_produce_in_progress: `eggs remaster`, `coa remaster`, `oa …oa-plan.json` count as busy.
 * 3. iso-read-lib: PVD volume id and bzImage kernel release without mounting (no xorriso needed).
 * 4. With xorriso (+ squashfs-tools): synthetic new-layout ISOs through verify-iso-boot-branding.sh (FAST) and
 *    verify-iso-squashfs-excludes.sh — OA_LIVE, trampoline label, {{{ placeholders, pin, overlay needles.
 */
const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const EGGS = path.join(ROOT, 'tools/eggs/live-usb')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const code = (rel) =>
	read(rel)
		.split('\n')
		.filter((l) => !/^\s*#/.test(l))
		.join('\n')
const has = (tool) => spawnSync('bash', ['-c', `command -v ${tool}`]).status === 0
const bash = (script, env = {}) =>
	spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, ...env } })

const KREL = '7.0.0-99-generic'
let tmp

before(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo870-p5-'))
})
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

/** Minimal x86 bzImage header: u16 at 0x20E + 0x200 = offset of the version string. */
function fakeBzImage(file, release) {
	const b = Buffer.alloc(0x400)
	b.writeUInt16LE(0x100, 0x20e)
	b.write(`${release} (ci@smoke) #1 SMP\0`, 0x300, 'latin1')
	fs.writeFileSync(file, b)
}

describe('WO-870 P5: find_newest_iso_since accepts both flavors', () => {
	const find = (nest, since, prefix) =>
		bash(`source "${EGGS}/flash-stick-common.sh"; find_newest_iso_since ${since} "${prefix}"`, { EGGS_NEST: nest })

	it('new name in the nest, legacy name in mnt/, exact prefix, symlink dated by its target', () => {
		const nest = path.join(tmp, 'nest')
		const target = path.join(tmp, 'target')
		fs.mkdirSync(path.join(nest, 'mnt'), { recursive: true })
		fs.mkdirSync(target)
		const real = path.join(target, 'highascg-nvidia-615-2026-10-30_1200.iso')
		fs.writeFileSync(real, 'x')
		const link = path.join(nest, 'highascg-nvidia-615-2026-10-30_1200.iso')
		fs.symlinkSync(real, link)
		const legacy = path.join(nest, 'mnt', 'highascg-nvidia-615_amd64_2026-10-01_0900.iso')
		fs.writeFileSync(legacy, 'x')
		const decoy = path.join(nest, 'highascg-nvidia-6150-2026-10-30_1300.iso')
		fs.writeFileSync(decoy, 'x')
		const t = (iso) => new Date(iso)
		fs.utimesSync(legacy, t('2026-10-01T09:00:00Z'), t('2026-10-01T09:00:00Z'))
		fs.utimesSync(decoy, t('2026-10-31T09:00:00Z'), t('2026-10-31T09:00:00Z'))
		fs.utimesSync(link, t('2026-10-30T12:00:00Z'), t('2026-10-30T12:00:00Z')) // follows → the target

		let r = find(nest, 0, 'highascg-nvidia-615')
		assert.equal(r.status, 0, r.stderr)
		assert.equal(r.stdout, link, 'newest matching = the coa link (the 6150 decoy is not this prefix)')

		// The link itself is brand new; only stat -L sees the target as older than the legacy ISO.
		fs.utimesSync(link, t('2026-09-01T00:00:00Z'), t('2026-09-01T00:00:00Z'))
		r = find(nest, 0, 'highascg-nvidia-615')
		assert.equal(r.stdout, legacy, 'legacy mnt/ ISO wins once the link TARGET is older')

		r = find(nest, Math.floor(t('2026-10-02T00:00:00Z') / 1000), 'highascg-nvidia-615')
		assert.notEqual(r.status, 0, 'nothing matching since the epoch')
		assert.match(r.stderr, /highascg-nvidia-615-\* or highascg-nvidia-615_\*/)

		r = find(nest, 0, 'highascg-nvidia-61')
		assert.notEqual(r.status, 0, 'prefix is exact: -61 does not match -615-/-6150-')
	})

	it('every ISO lookup site uses the shared finder or the eggs-cli-lib glob (no 595 literals)', () => {
		for (const f of [
			'build-produce-flash-stick.sh',
			'create-operator-stick-from-dd.sh',
			'legacy-persistence/build-flash-and-persist.sh',
		]) {
			assert.match(code(`tools/eggs/live-usb/${f}`), /find_(latest_iso|newest_iso_since)/, f)
		}
		const egg = code('tools/eggs/live-usb/build-highascg-egg.sh')
		assert.match(egg, /highascg_eggs_iso_glob "\$BASENAME"/, 'Done/next-step lines use the flavor glob')
		const rec = code('tools/eggs/live-usb/recover-host-usr-from-eggs-artifact.sh')
		assert.ok(rec.includes('/home/eggs/isodir/live/filesystem.squashfs'), 'recovery knows the coa staging squashfs')
		assert.ok(!/nvidia-595/.test(rec), 'recovery has no 595 literal')
		assert.ok(!/nvidia-595/.test(code('work/run-eggs-produce-clone-only.sh')), 'clone-only runner detects the branch')
	})

	it('ISO sizes follow the coa symlink (partitioning and the size floor)', () => {
		assert.ok(code('tools/eggs/live-usb/flash-stick-common.sh').includes('stat -L -c%s "$iso"'))
		const dd = code('tools/eggs/live-usb/create-operator-stick-from-dd.sh')
		assert.ok(dd.includes('du -mL "$ISO"') && dd.includes('stat -L -c%s "$ISO"'))
	})
})

describe('WO-870 P5: liveroot busy guard sees the new build processes', () => {
	const busy = (argv) => {
		const list = path.join(tmp, 'ps.txt')
		fs.writeFileSync(list, `${argv}\n`)
		const stub = path.join(tmp, 'pgrep')
		fs.writeFileSync(stub, `#!/bin/bash\n[ "$1" = -f ] || exit 2\ngrep -qE -- "$2" "${list}"\n`, { mode: 0o755 })
		return (
			bash(`source "${EGGS}/eggs-liveroot-safety.sh"; PGREP="${stub}"; eggs_liveroot_produce_in_progress`).status === 0
		)
	}

	for (const argv of [
		'eggs remaster --clone',
		'/usr/bin/eggs remaster --clone --nointeractive',
		'coa remaster --clone',
		'/usr/bin/oa /tmp/coa/oa-plan.json',
		'oa',
		'mksquashfs /home/eggs/liveroot /home/eggs/isodir/live/filesystem.squashfs',
		'eggs produce --clone',
	]) {
		it(`busy: ${argv}`, () => assert.equal(busy(argv), true))
	}
	for (const argv of [
		'goa-daemon',
		'/usr/lib/koa-server',
		'bash run-eggs-remaster-x.sh',
		'oax --help',
		'eggs sysinstall calamares',
	]) {
		it(`not busy: ${argv}`, () => assert.equal(busy(argv), false))
	}

	it('the WO-464 bind-mount guard is still the first check', () => {
		assert.match(code('tools/eggs/live-usb/eggs-liveroot-safety.sh'), /eggs_liveroot_list_host_bind_mounts/)
	})
})

describe('WO-870 P5: iso-read-lib without a mount', () => {
	it('reads the PVD volume id and a bzImage release', () => {
		const iso = path.join(tmp, 'pvd.bin')
		const b = Buffer.alloc(32808 + 64, 0)
		b.write('OA_LIVE'.padEnd(32, ' '), 32808, 'latin1')
		fs.writeFileSync(iso, b)
		const kern = path.join(tmp, 'vmlinuz')
		fakeBzImage(kern, KREL)
		const r = bash(
			`source "${EGGS}/iso-read-lib.sh"; printf '%s|%s' "$(iso_volume_id "${iso}")" "$(bzimage_release "${kern}")"`
		)
		assert.equal(r.stdout, `OA_LIVE|${KREL}`, r.stderr)
	})
})

describe('WO-870 P5: verifier source needles', () => {
	it('boot-branding verifier: built ISO only, new layout assertions, legacy needles kept', () => {
		const v = code('tools/eggs/live-usb/verify-iso-boot-branding.sh')
		assert.ok(!/mount\s+-o\s+loop/.test(v), 'no loop mount — reads the image with iso-read-lib')
		assert.ok(!v.includes('/home/eggs/isodir'), 'never judges the staging tree')
		for (const n of [
			'OA_LIVE',
			'EFI/BOOT/BOOTX64.EFI',
			'{{{',
			'live/vmlinuz',
			'live/initrd.img',
			'bzimage_release',
			'HIGHASCG NVIDIA',
			'etc/penguins-eggs.d/branding/calamares/branding/show.qml',
		]) {
			assert.ok(v.includes(n), n)
		}
	})

	it('squashfs verifier reads the ISO in place and checks the coa overlay; DeckLink/secret needles stay', () => {
		const v = code('tools/eggs/live-usb/verify-iso-squashfs-excludes.sh')
		assert.match(v, /UNSQ=\(unsquashfs -o "\$SQ_OFF"\)/)
		assert.ok(v.includes('verify-iso-squashfs-calamares.sh'))
		for (const n of [
			'home/casparcg/.config/gh/hosts.yml',
			'usr/lib/blackmagic',
			'usr/src/(nvidia|blackmagic)',
			'custom.exclude.list',
		]) {
			assert.ok(v.includes(n), n)
		}
		const c = code('tools/eggs/live-usb/verify-iso-squashfs-calamares.sh')
		assert.ok(c.includes('etc/penguins-eggs.d/branding/calamares'))
		assert.match(c, /modules\/\[\^\/\]\+\\\\\.\(yaml\|conf\)/, 'flags modules/ overrides (WO-870 Phase 4 ships none)')
		assert.ok(c.includes('highascg-eggs-theme-logo.png') && c.includes('branding.desc.tmpl'))
	})
})

const XORRISO = has('xorriso')
const SQUASH = XORRISO && has('mksquashfs') && has('unsquashfs')

/** Build a small eggs 26.10-shaped ISO; opts tweak one thing per negative case. */
function mkIso(name, opts = {}) {
	const t = path.join(tmp, `${name}-tree`)
	const volid = opts.volid || 'OA_LIVE'
	const w = (rel, s) => {
		fs.mkdirSync(path.dirname(path.join(t, rel)), { recursive: true })
		fs.writeFileSync(path.join(t, rel), s)
	}
	w('EFI/BOOT/BOOTX64.EFI', 'efi')
	w('EFI/BOOT/efi.img', 'img')
	w('EFI/BOOT/grub.cfg', `search --set=root --label ${opts.efiLabel || volid}\nconfigfile ($root)/boot/grub/grub.cfg\n`)
	w(
		'boot/grub/grub.cfg',
		'menuentry "HIGHASCG NVIDIA 615 Live" {\n  linux /live/vmlinuz boot=live quiet splash\n  initrd /live/initrd.img\n}\n'
	)
	w('boot/grub/theme.cfg', 'desktop-color: "#000000"\n')
	w(
		'isolinux/isolinux.cfg',
		`label live\n  menu label ${opts.isolinuxTitle || 'HIGHASCG NVIDIA 615 Live'}\n  kernel /live/vmlinuz\n  append initrd=/live/initrd.img boot=live\n`
	)
	w('isolinux/isolinux.theme.cfg', 'menu color sel 0 #ffffffff #00000000\n')
	w('isolinux/vesamenu.c32', 'c32')
	fs.mkdirSync(path.join(t, 'live'), { recursive: true })
	fakeBzImage(path.join(t, 'live/vmlinuz'), KREL)
	if (!opts.noInitrd) w('live/initrd.img', 'initrd')
	if (opts.squashRoot) {
		const r = spawnSync('mksquashfs', [opts.squashRoot, path.join(t, 'live/filesystem.squashfs'), '-quiet', '-noappend'])
		assert.equal(r.status, 0, String(r.stderr))
	} else {
		w('live/filesystem.squashfs', 'sq')
	}
	const iso = path.join(tmp, `highascg-nvidia-615-${name}.iso`)
	const r = spawnSync('xorriso', ['-as', 'mkisofs', '-r', '-J', '-V', volid, '-o', iso, t], { encoding: 'utf8' })
	assert.equal(r.status, 0, r.stderr)
	return iso
}

const BOOT_ENV = {
	HIGHASCG_ISO_BOOT_BRANDING_VERIFY_FAST: '1',
	HIGHASCG_NVIDIA_DRIVER: '615',
	HIGHASCG_PINNED_KERNEL: KREL,
}
const branding = (iso, env = {}) => {
	const r = spawnSync('bash', [path.join(EGGS, 'verify-iso-boot-branding.sh'), iso], {
		encoding: 'utf8',
		env: { ...process.env, ...BOOT_ENV, ...env },
	})
	return { rc: r.status, out: `${r.stdout}\n${r.stderr}` }
}

describe(
	'WO-870 P5: verify-iso-boot-branding.sh on synthetic ISOs',
	{ skip: !XORRISO && 'xorriso not installed' },
	() => {
		it('a good OA_LIVE ISO passes every Phase 5 assertion', () => {
			const { out } = branding(mkIso('good'))
			assert.match(out, /\(layout new, read with xorriso\)/)
			for (const re of [
				/OK: volume id OA_LIVE/,
				/OK: EFI trampoline --label OA_LIVE = volume id/,
				/OK: EFI\/BOOT\/BOOTX64\.EFI present/,
				/OK: live\/vmlinuz present/,
				/OK: live\/initrd\.img present/,
				/OK: boot\/grub\/grub\.cfg: no \{\{\{ placeholders/,
				/OK: isolinux\/isolinux\.cfg has a 'HIGHASCG NVIDIA 615 Live' entry/,
				new RegExp(`OK: live/vmlinuz is ${KREL} = pinned kernel`),
			]) {
				assert.match(out, re)
			}
			assert.doesNotMatch(out, /FAIL: .*(volume id|trampoline|placeholders|BOOTX64|live\/vmlinuz|initrd|boots \/live)/)
		})

		it('volume id other than OA_LIVE/HIGHASCG* fails', () => {
			assert.match(branding(mkIso('volid', { volid: 'Ubuntu' })).out, /FAIL: volume id 'Ubuntu'/)
		})

		it('trampoline label ≠ volume id fails (UEFI would stop at grub>)', () => {
			const r = branding(mkIso('label', { efiLabel: 'HIGHASCG' }))
			assert.equal(r.rc, 1)
			assert.match(r.out, /FAIL: EFI trampoline searches --label HIGHASCG but the volume id is 'OA_LIVE'/)
		})

		it('unrendered {{{ placeholders in a menu fail', () => {
			const r = branding(mkIso('tmpl', { isolinuxTitle: '{{{fullname}}} Live' }))
			assert.match(r.out, /FAIL: isolinux\/isolinux\.cfg has unrendered placeholders: \{\{\{fullname\}\}\}/)
			assert.match(r.out, /FAIL: isolinux\/isolinux\.cfg has no 'HIGHASCG NVIDIA 615 Live' entry/)
		})

		it('kernel release ≠ pin and a missing initrd fail', () => {
			const r = branding(mkIso('pin', { noInitrd: true }), { HIGHASCG_PINNED_KERNEL: '6.99.0-1-generic' })
			assert.match(r.out, new RegExp(`FAIL: live/vmlinuz is ${KREL} but the pin is 6\\.99\\.0-1-generic`))
			assert.match(r.out, /FAIL: missing live\/initrd\.img/)
			assert.match(r.out, /FAIL: boot\/grub\/grub\.cfg boots \/live\/initrd\.img, which is not on the ISO/)
		})
	}
)

describe(
	'WO-870 P5: verify-iso-squashfs-excludes.sh reads the squashfs inside the ISO',
	{ skip: !SQUASH && 'xorriso/squashfs-tools not installed' },
	() => {
		const OV = 'etc/penguins-eggs.d/branding/calamares'
		const THEME = path.join(EGGS, 'highascg-eggs-theme/theme/calamares')
		const sqRoot = (name, withModules) => {
			const r = path.join(tmp, `${name}-sq`)
			fs.mkdirSync(path.join(r, OV, 'branding'), { recursive: true })
			for (const f of ['show.qml', 'branding.desc.tmpl', 'highascg-eggs-theme-logo.png']) {
				fs.copyFileSync(path.join(THEME, 'branding', f), path.join(r, OV, 'branding', f))
			}
			if (withModules) {
				fs.mkdirSync(path.join(r, OV, 'modules'))
				fs.writeFileSync(path.join(r, OV, 'modules/partition.yaml'), 'efiSystemPartition: "/boot/efi"\n')
			}
			return r
		}
		const run = (iso, env = {}) => {
			const r = spawnSync('bash', [path.join(EGGS, 'verify-iso-squashfs-excludes.sh'), iso], {
				encoding: 'utf8',
				env: { ...process.env, ...env },
			})
			return `${r.stdout}\n${r.stderr}`
		}

		it('new layout: overlay needles found via unsquashfs -o; the tiny image still fails the size floor', () => {
			const out = run(mkIso('sq', { squashRoot: sqRoot('sq', false) }))
			assert.match(out, /squashfs at byte \d+\) \(layout new\)/)
			for (const n of [
				'branding/show.qml',
				'branding/branding.desc[.tmpl]',
				'branding/highascg-eggs-theme-logo.png',
			]) {
				assert.ok(out.includes(`OK: present: /${OV}/${n}`), n)
			}
			assert.ok(out.includes("OK: no Calamares module overrides (coa's generated partition/users confs stay intact)"))
			assert.match(out, /FAIL: squashfs is only \d+ MiB/)
			assert.match(out, /check WO-47 lines in \/etc\/penguins-eggs\.d\/custom\.exclude\.list/)
		})

		it('new layout with a modules/*.yaml override fails; forcing legacy demands /etc/calamares', () => {
			const iso = mkIso('sqmod', { squashRoot: sqRoot('sqmod', true) })
			assert.match(
				run(iso),
				/FAIL: Calamares module overrides in \/etc\/penguins-eggs\.d\/branding\/calamares\/modules — they replace coa's generated confs whole/
			)
			assert.match(
				run(iso, { HIGHASCG_ISO_LAYOUT: 'legacy' }),
				/FAIL: missing Calamares branding — run install-eggs-calamares\.sh/
			)
		})
	}
)
