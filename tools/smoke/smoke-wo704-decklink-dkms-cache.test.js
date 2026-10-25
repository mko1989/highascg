'use strict'

/**
 * WO-704 — DeckLink DKMS build cache on the operator's stick: the live ISO compiled blackmagic + blackmagic-io on
 * every boot (~1m53s on .64). The built DKMS trees are saved per kernel after a successful load and put back
 * before `dpkg -i`, so the vendor postinst's `dkms build` skips. The shell is exercised against a temp DKMS tree,
 * a temp cache dir and fake dpkg / dkms / modprobe / uname on PATH.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.join(__dirname, '../..')
const LIB = path.join(ROOT, 'scripts/lib/decklink-install-lib.sh')
const CACHE_LIB = path.join(ROOT, 'scripts/lib/decklink-dkms-cache-lib.sh')
const K = '6.8.0-117-generic'
const V = '16.2a1'
const MODS = ['blackmagic', 'blackmagic-io']

const sandboxDirs = []
test.after(() => sandboxDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })))

function sandbox() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo704-'))
	sandboxDirs.push(dir)
	const box = {
		dir,
		tree: path.join(dir, 'dkms'),
		cache: path.join(dir, 'stick/decklink/dkms-cache'),
		sys: path.join(dir, 'sys'),
		bin: path.join(dir, 'bin'),
		log: path.join(dir, 'calls.log'),
	}
	for (const d of [box.tree, box.sys, box.bin]) fs.mkdirSync(d, { recursive: true })
	fs.writeFileSync(box.log, '')
	const fake = (name, body) =>
		fs.writeFileSync(path.join(box.bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 })
	fake('uname', `[[ "$1" == -m ]] && echo x86_64 || echo ${K}`)
	fake('dpkg-query', 'exit 1')
	fake('apt-get', `echo "apt-get $*" >>"${box.log}"`)
	// desktopvideo postinst: dkms add → build (skips when module/ exists) → install --force (activates the build)
	fake(
		'dpkg',
		`echo "dpkg $*" >>"${box.log}"
for m in ${MODS.join(' ')}; do
	d="${box.tree}/$m/${V}/${K}/x86_64"
	if [[ -d "$d/module" ]]; then echo "skip-build $m" >>"${box.log}"
	else mkdir -p "$d/module" && echo "fresh $m" >"$d/module/$m.ko.zst" && echo "COMPILE $m" >>"${box.log}"; fi
	ln -sfn "$d" "${box.tree}/$m/kernel-${K}-x86_64"
done`
	)
	fake(
		'dkms',
		`echo "dkms $*" >>"${box.log}"
[[ "$1 $2" == "build --force" ]] && touch "${box.dir}/rebuilt" && echo "COMPILE $4" >>"${box.log}"
exit 0`
	)
	// a cached module "fails to load" until it was rebuilt when the test drops a reject marker
	fake(
		'modprobe',
		`[[ -f "${box.dir}/reject" && ! -f "${box.dir}/rebuilt" ]] && exit 1
mkdir -p "${box.sys}/$1"`
	)
	return box
}

function sh(box, script, extraEnv = {}) {
	return execFileSync('bash', ['-c', `set -u\nsource "${LIB}"\n${script}`], {
		cwd: ROOT,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		env: {
			...process.env,
			PATH: `${box.bin}:${process.env.PATH}`,
			DECKLINK_DKMS_TREE: box.tree,
			DECKLINK_DKMS_CACHE_ROOT: box.cache,
			DECKLINK_SYS_MODULE: box.sys,
			TMPDIR: box.dir,
			...extraEnv,
		},
	})
}

/** A DKMS tree as the postinst leaves it: <mod>/<ver>/<krel>/x86_64/module/*.ko + the kernel-<krel>-<arch> link. */
function builtTree(box, krel = K, ver = V) {
	for (const m of MODS) {
		const d = path.join(box.tree, m, ver, krel, 'x86_64')
		fs.mkdirSync(path.join(d, 'module'), { recursive: true })
		fs.mkdirSync(path.join(d, 'log'), { recursive: true })
		fs.writeFileSync(path.join(d, 'module', `${m}.ko.zst`), `ko ${m} ${krel}`)
		fs.writeFileSync(path.join(d, 'log', 'make.log'), 'make')
		fs.symlinkSync(d, path.join(box.tree, m, `kernel-${krel}-x86_64`))
	}
}

const tgz = (box, m, krel = K) => path.join(box.cache, krel, `${m}-${V}-x86_64.tar.gz`)
const calls = (box) => fs.readFileSync(box.log, 'utf8')
const freshInstall = (box) =>
	fs.rmSync(box.tree, { recursive: true, force: true }) || fs.rmSync(box.sys, { recursive: true, force: true })

test('save writes tarball + sha256 + manifest per kernel; restore puts the trees back', () => {
	const box = sandbox()
	builtTree(box)
	sh(box, `decklink_dkms_cache_save ${V} ${K}`)
	for (const m of MODS) {
		assert.ok(fs.existsSync(tgz(box, m)), `${m} archived`)
		const sum = fs.readFileSync(`${tgz(box, m)}.sha256`, 'utf8')
		assert.match(sum, new RegExp(`^[0-9a-f]{64}  ${m}-${V}-x86_64\\.tar\\.gz\\n$`))
	}
	assert.match(
		fs.readFileSync(path.join(box.cache, K, 'manifest.txt'), 'utf8'),
		new RegExp(`desktopvideo=${V}\\nkernel=${K}`)
	)
	assert.deepEqual(
		fs.readdirSync(path.join(box.cache, K)).filter((f) => f.includes('.tmp')),
		[],
		'no temp files left'
	)
	freshInstall(box)
	const out = sh(box, `decklink_dkms_cache_restore ${V} ${K}; echo "rc=$? n=$DECKLINK_DKMS_CACHE_RESTORED"`)
	assert.match(out, /rc=0 n=2/)
	for (const m of MODS) {
		const ko = path.join(box.tree, m, V, K, 'x86_64/module', `${m}.ko.zst`)
		assert.equal(fs.readFileSync(ko, 'utf8'), `ko ${m} ${K}`)
		assert.ok(
			!fs.existsSync(path.join(box.tree, m, V, 'source')),
			'no source link — the postinst `dkms add` must still succeed'
		)
	}
	assert.deepEqual(
		fs.readdirSync(box.dir).filter((f) => f.startsWith('decklink-dkms-cache')),
		[],
		'extract dir removed'
	)
})

test('corrupt, truncated, empty and other-version caches fall back to the compile', () => {
	const box = sandbox()
	builtTree(box)
	sh(box, `decklink_dkms_cache_save ${V} ${K}`)
	freshInstall(box)
	fs.mkdirSync(box.tree)
	// other version: nothing matches → miss
	assert.match(
		sh(box, `decklink_dkms_cache_restore 16.3 ${K} || echo "rc=$? n=$DECKLINK_DKMS_CACHE_RESTORED"`),
		/rc=1 n=0/
	)
	// a readable archive whose sha256 no longer matches → refused for that module only
	const bad = tgz(box, 'blackmagic')
	fs.writeFileSync(`${bad}.sha256`, `${'0'.repeat(64)}  blackmagic-${V}-x86_64.tar.gz\n`)
	const mismatch = sh(box, `decklink_dkms_cache_restore ${V} ${K} 2>&1 || echo "rc=$? n=$DECKLINK_DKMS_CACHE_RESTORED"`)
	assert.match(mismatch, /blackmagic-16\.2a1-x86_64\.tar\.gz checksum mismatch/)
	assert.match(mismatch, /rc=1 n=1/)
	assert.ok(!fs.existsSync(path.join(box.tree, 'blackmagic')), 'no half tree for the corrupt module')
	// a valid archive with no .ko in it is refused
	const empty = path.join(box.dir, 'empty')
	fs.mkdirSync(path.join(empty, V, K, 'x86_64/log'), { recursive: true })
	execFileSync('tar', ['-czf', bad, '-C', empty, V])
	execFileSync('bash', ['-c', `sha256sum "${bad}" | awk '{print $1}' >"${bad}.sha256"`])
	assert.match(
		sh(box, `decklink_dkms_cache_restore ${V} ${K} 2>&1 || true`),
		/blackmagic-16\.2a1-x86_64\.tar\.gz unusable/
	)
	assert.ok(!fs.existsSync(path.join(box.tree, 'blackmagic')))
	// missing sidecar → miss
	fs.rmSync(`${tgz(box, 'blackmagic-io')}.sha256`)
	fs.rmSync(path.join(box.tree, 'blackmagic-io'), { recursive: true })
	assert.match(sh(box, `decklink_dkms_cache_restore ${V} ${K} || echo "n=$DECKLINK_DKMS_CACHE_RESTORED"`), /n=0/)
	// no stick mounted at all → miss, no output dir
	// (the mount list points nowhere: a stick plugged into the box running the suite must not count — WO-721)
	assert.match(
		sh(box, `decklink_dkms_cache_restore ${V} ${K} || echo miss`, {
			DECKLINK_DKMS_CACHE_ROOT: '',
			DECKLINK_DKMS_CACHE_MOUNTS: path.join(box.dir, 'no-stick-here'),
		}),
		/miss/
	)
})

test('restore never overwrites a version DKMS already holds', () => {
	const box = sandbox()
	builtTree(box)
	sh(box, `decklink_dkms_cache_save ${V} ${K}`)
	const ko = path.join(box.tree, 'blackmagic', V, K, 'x86_64/module/blackmagic.ko.zst')
	fs.writeFileSync(ko, 'local build')
	sh(box, `decklink_dkms_cache_restore ${V} ${K} || true`)
	assert.equal(fs.readFileSync(ko, 'utf8'), 'local build')
})

test('save keeps an existing entry unless forced; prune keeps the current + newest other kernel', () => {
	const box = sandbox()
	builtTree(box)
	sh(box, `decklink_dkms_cache_save ${V} ${K}`)
	const first = fs.readFileSync(`${tgz(box, 'blackmagic')}.sha256`, 'utf8')
	fs.writeFileSync(
		path.join(box.tree, 'blackmagic', V, K, 'x86_64/module/blackmagic.ko.zst'),
		'rebuilt with this box key'
	)
	sh(box, `decklink_dkms_cache_save ${V} ${K}`)
	assert.equal(fs.readFileSync(`${tgz(box, 'blackmagic')}.sha256`, 'utf8'), first, 'unforced save keeps the entry')
	sh(box, `decklink_dkms_cache_save ${V} ${K} 1`)
	assert.notEqual(fs.readFileSync(`${tgz(box, 'blackmagic')}.sha256`, 'utf8'), first, 'forced save replaces it')

	const old = ['6.8.0-100-generic', '6.8.0-110-generic', '6.8.0-115-generic']
	old.forEach((k, i) => {
		fs.mkdirSync(path.join(box.cache, k))
		const t = new Date(Date.now() - (10 - i) * 86400e3)
		fs.utimesSync(path.join(box.cache, k), t, t)
	})
	fs.mkdirSync(path.join(box.cache, 'notes'))
	fs.utimesSync(path.join(box.cache, K), new Date(0), new Date(0)) // current kernel kept even when oldest
	sh(box, `decklink_dkms_cache_prune "${box.cache}" ${K}`)
	assert.deepEqual(fs.readdirSync(box.cache).sort(), [K, '6.8.0-115-generic', 'notes'].sort())
})

test('install: miss compiles + saves; the next boot restores and the postinst skips the build', () => {
	const box = sandbox()
	const deb = path.join(box.dir, `desktopvideo_${V}_amd64.deb`)
	fs.writeFileSync(deb, '')
	const run = () =>
		sh(
			box,
			`decklink_ensure_dkms_prereqs() { echo prereqs >>"${box.log}"; }\ndecklink_install_vendor_pair "${deb}" "" ""; echo rc=$?`
		)
	assert.match(run(), /rc=0/)
	assert.match(calls(box), /prereqs[\s\S]*COMPILE blackmagic\b/)
	MODS.forEach((m) => assert.ok(fs.existsSync(tgz(box, m)), `${m} cached after the first boot`))

	freshInstall(box) // next live boot: empty /var/lib/dkms, nothing loaded
	fs.writeFileSync(box.log, '')
	assert.match(run(), /rc=0/)
	const second = calls(box)
	assert.doesNotMatch(second, /COMPILE/)
	assert.doesNotMatch(second, /prereqs/, 'a full hit needs no kernel headers / apt')
	assert.match(second, /skip-build blackmagic\n/)
	assert.match(second, /skip-build blackmagic-io\n/)
})

test('install: a cached module that will not load is rebuilt and re-saved; cache failures never fail the install', () => {
	const box = sandbox()
	const deb = path.join(box.dir, `desktopvideo_${V}_amd64.deb`)
	fs.writeFileSync(deb, '')
	builtTree(box)
	sh(box, `decklink_dkms_cache_save ${V} ${K}`)
	const before = fs.readFileSync(`${tgz(box, 'blackmagic-io')}.sha256`, 'utf8')
	freshInstall(box)
	fs.writeFileSync(path.join(box.dir, 'reject'), '') // e.g. Secure Boot: another box's MOK
	const script = `decklink_ensure_dkms_prereqs() { echo prereqs >>"${box.log}"; }
dkms() { command dkms "$@"; [[ "$1" == install ]] && fs_touch; return 0; }
fs_touch() { echo "rebuilt with this box" >"${box.tree}/blackmagic-io/${V}/${K}/x86_64/module/blackmagic-io.ko.zst"; }
decklink_install_vendor_pair "${deb}" "" ""; echo rc=$?`
	assert.match(sh(box, script), /rc=0/)
	assert.match(calls(box), new RegExp(`dkms build --force -m blackmagic-io -v ${V} -k ${K}`))
	assert.match(calls(box), /prereqs/)
	assert.notEqual(
		fs.readFileSync(`${tgz(box, 'blackmagic-io')}.sha256`, 'utf8'),
		before,
		'the working build replaces the cached one'
	)

	// a read-only / missing stick: the install still succeeds
	const ro = sandbox()
	const roDeb = path.join(ro.dir, `desktopvideo_${V}_amd64.deb`)
	fs.writeFileSync(roDeb, '')
	fs.writeFileSync(path.join(ro.dir, 'stick'), 'not a dir')
	assert.match(
		sh(ro, `decklink_ensure_dkms_prereqs() { :; }\ndecklink_install_vendor_pair "${roDeb}" "" ""; echo rc=$?`),
		/rc=0/
	)
})

test('wiring: the lib sources the cache lib and the exFAT unit installer ships it beside the lib', () => {
	const lib = fs.readFileSync(LIB, 'utf8')
	assert.ok(lib.includes('source "$(dirname "${BASH_SOURCE[0]}")/decklink-dkms-cache-lib.sh"'))
	assert.ok(fs.readFileSync(CACHE_LIB, 'utf8').includes('dkms ldtarball'), 'the ldtarball dead end stays documented')
	const units = fs.readFileSync(path.join(ROOT, 'scripts/exfat/install-exfat-systemd-units.sh'), 'utf8')
	assert.ok(units.includes('DECKLINK_CACHE_LIB_DST=/usr/local/lib/highascg/decklink-dkms-cache-lib.sh'))
	assert.match(units, /install -m 0644 -o root -g root "\$DECKLINK_CACHE_LIB_SRC" "\$DECKLINK_CACHE_LIB_DST"/)
	// WO-92: the cache lives on the operator's stick only — the ISO keeps excluding every DKMS blackmagic tree
	const excl = fs.readFileSync(path.join(ROOT, 'tools/eggs/live-usb/penguins-eggs-exclude-decklink.list'), 'utf8')
	assert.match(excl, /var\/lib\/dkms\/blackmagic/)
})
