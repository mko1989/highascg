'use strict'

/**
 * WO-939 — Caspar crash-looped on a fresh Calamares install (192.168.0.35): /etc/locale.conf said en_US.UTF-8, the
 * image has no `locales` package, and casparcg's std::locale("") threw "_S_create_c_locale name not valid".
 *
 * Proven here: run.sh's caspar_sanitize_locale falls back to C.UTF-8 only when a LANG / LC_* value cannot be loaded,
 * the boot guard rewrites a bad /etc/locale.conf (keeping a backup) and leaves a good one alone, and the wiring
 * (run.sh call order, unit ordering, preflight install, ISO verifier) is in place. A fake `locale` on PATH stands in
 * for libc so the result is the same on this box (C locales only) and on CI (en_US installed).
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..', '..')
const LIB = path.join(ROOT, 'tools', 'runtime', 'casparcg-supervisor-lib.sh')
const GUARD = path.join(ROOT, 'tools', 'runtime', 'highascg-locale-guard.sh')
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')

/** A temp dir with a fake `locale`: silent for the names in FAKE_INSTALLED, "Cannot set …" on stderr otherwise. */
function fakeLocaleDir() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo939-'))
	const bin = path.join(dir, 'locale')
	fs.writeFileSync(
		bin,
		'#!/bin/sh\nfor l in $FAKE_INSTALLED; do [ "$l" = "$LC_ALL" ] && exit 0; done\n' +
			'echo "locale: Cannot set LC_CTYPE to default locale: No such file or directory" >&2\nexit 0\n',
	)
	fs.chmodSync(bin, 0o755)
	return dir
}

function sanitize(env, installed = '') {
	const dir = fakeLocaleDir()
	const log = path.join(dir, 'caspar.log')
	const script = `. "${LIB}"; caspar_sanitize_locale; printf 'LANG=%s\\nLC_ALL=%s\\n' "\${LANG:-}" "\${LC_ALL:-}"`
	const r = spawnSync('sh', ['-c', script], {
		env: { PATH: `${dir}:/usr/bin:/bin`, FAKE_INSTALLED: installed, CASPAR_SUPERVISOR_LOG: log, ...env },
		encoding: 'utf8',
	})
	assert.equal(r.status, 0, r.stderr)
	const out = Object.fromEntries(r.stdout.trim().split('\n').map((l) => l.split('=')))
	return { ...out, log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '' }
}

test('WO-939 run.sh guard: a locale that is not installed → Caspar starts with C.UTF-8, and says why', () => {
	const r = sanitize({ LANG: 'en_US.UTF-8', LC_TIME: 'en_US.UTF-8' })
	assert.equal(r.LANG, 'C.UTF-8')
	assert.equal(r.LC_ALL, 'C.UTF-8')
	assert.match(r.log, /locale not installed: LANG=en_US\.UTF-8 LC_TIME=en_US\.UTF-8 — starting Caspar with C\.UTF-8/)
})

test('WO-939 run.sh guard: C.UTF-8 (the box) and installed user locales are left alone', () => {
	const box = sanitize({ LANG: 'C.UTF-8' })
	assert.deepEqual([box.LANG, box.LC_ALL, box.log], ['C.UTF-8', '', ''])
	const pl = sanitize({ LANG: 'pl_PL.UTF-8' }, 'pl_PL.UTF-8')
	assert.deepEqual([pl.LANG, pl.LC_ALL, pl.log], ['pl_PL.UTF-8', '', ''])
	const none = sanitize({})
	assert.deepEqual([none.LANG, none.LC_ALL, none.log], ['', '', ''])
})

test('WO-939 run.sh guard: one bad category is enough (std::locale("") reads them all)', () => {
	const r = sanitize({ LANG: 'pl_PL.UTF-8', LC_MONETARY: 'en_US.UTF-8' }, 'pl_PL.UTF-8')
	assert.equal(r.LC_ALL, 'C.UTF-8')
	assert.match(r.log, /LC_MONETARY=en_US\.UTF-8/)
	assert.doesNotMatch(r.log, /LANG=pl_PL/)
})

function guard(content, installed = '') {
	const dir = fakeLocaleDir()
	const conf = path.join(dir, 'locale.conf')
	if (content != null) fs.writeFileSync(conf, content)
	const r = spawnSync('sh', [GUARD], {
		env: { PATH: `${dir}:/usr/bin:/bin`, FAKE_INSTALLED: installed, HIGHASCG_LOCALE_CONF: conf },
		encoding: 'utf8',
	})
	const at = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null)
	return { status: r.status, out: r.stdout + r.stderr, conf: at(conf), bak: at(`${conf}.bak-wo939`) }
}

test('WO-939 boot guard: the .35 locale.conf (Calamares en_US, no locales package) becomes LANG=C.UTF-8 with a backup', () => {
	const calamares = 'LANG=en_US.UTF-8\nLC_ADDRESS=en_US.UTF-8\nLC_TIME="en_US.UTF-8"\n'
	const r = guard(calamares)
	assert.equal(r.status, 0, r.out)
	assert.equal(r.conf, 'LANG=C.UTF-8\n')
	assert.equal(r.bak, calamares)
	assert.match(r.out, /locale not installed: LANG=en_US\.UTF-8 LC_ADDRESS=en_US\.UTF-8 LC_TIME="en_US\.UTF-8"/)
})

test('WO-939 boot guard: a good locale.conf and a missing one are left alone', () => {
	for (const [content, installed] of [['LANG=C.UTF-8\n', ''], ['LANG=pl_PL.UTF-8\nLC_TIME=pl_PL.UTF-8', 'pl_PL.UTF-8']]) {
		const r = guard(content, installed)
		assert.equal(r.status, 0, r.out)
		assert.equal(r.conf, content)
		assert.equal(r.bak, null)
	}
	const missing = guard(null)
	assert.equal(missing.status, 0)
	assert.equal(missing.conf, null)
})

test('WO-939 wiring: run.sh sanitizes before any launch; unit, preflight and ISO verifier carry the guard', () => {
	const run = read('run.sh')
	const lib = run.indexOf('. "${CASPAR_ROOT}/tools/runtime/casparcg-supervisor-lib.sh"\ncaspar_sanitize_locale\n')
	assert.ok(lib > 0, 'called right after the supervisor lib is sourced')
	assert.ok(lib < run.indexOf('\nrun_caspar() {'), 'before the launch function is even defined')
	const unit = read('scripts', 'systemd', 'highascg-locale-guard.service')
	assert.match(unit, /^Before=.*\bcasparcg-server\.service\b/m)
	assert.match(unit, /^WantedBy=sysinit\.target$/m)
	assert.match(unit, /^ExecStart=\/usr\/local\/lib\/highascg\/highascg-locale-guard\.sh$/m)
	const pf = read('tools', 'eggs', 'live-usb', 'pre-produce-preflight.sh')
	assert.match(pf, /install -m 0755 "\$LOCALE_GUARD_SRC" \/usr\/local\/lib\/highascg\/highascg-locale-guard\.sh/)
	assert.match(pf, /systemctl enable highascg-locale-guard\.service/)
	assert.ok(pf.indexOf('highascg-locale-guard') < pf.indexOf('verify-calamares-installed.sh'), 'before the clone checks')
	const v = read('tools', 'eggs', 'live-usb', 'verify-iso-squashfs-excludes.sh')
	assert.match(v, /sysinit\.target\.wants\/highascg-locale-guard\.service/)
	assert.match(v, /usr\/lib\/locale\/locale-archive/)
	assert.equal(spawnSync('sh', ['-n', GUARD]).status, 0)
	assert.equal(spawnSync('sh', ['-n', LIB]).status, 0)
})
