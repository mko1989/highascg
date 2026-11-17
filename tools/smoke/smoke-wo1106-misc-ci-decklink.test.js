'use strict'

/**
 * WO-1106 D4 / D5 — offline, nothing is installed:
 *   D4  the per-box DeckLink install runs `dpkg --force-confmiss -i …` (both tries), so the dracut conffile the ISO
 *       excludes comes back although the shipped dpkg status calls desktopvideo installed; the install gate is still
 *       the payload file (WO-431), not the dpkg record. dpkg / apt-get / modprobe are stubs on PATH.
 *   D5  CI's verify job also judges the dev dependencies' licences (they ship in the release tarball), after `npm ci`.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.join(__dirname, '../..')
const LIB = path.join(ROOT, 'scripts/lib/decklink-install-lib.sh')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1106-misc-dk-'))
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }))

const stub = (dir, name, body) => {
	fs.mkdirSync(dir, { recursive: true })
	fs.writeFileSync(path.join(dir, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 })
}

test('D4: both dpkg tries install with --force-confmiss (main + gui deb)', () => {
	const bin = path.join(TMP, 'bin')
	const log = path.join(TMP, 'dpkg.log')
	const flag = path.join(TMP, 'first-done')
	// the first dpkg fails (missing deps), apt-get -f fixes them, the second succeeds
	stub(bin, 'dpkg', `echo "$*" >>"${log}"; if [[ -e "${flag}" ]]; then exit 0; fi; touch "${flag}"; exit 1`)
	stub(bin, 'apt-get', 'exit 0')
	stub(bin, 'modprobe', 'exit 0')
	const main = path.join(TMP, 'desktopvideo_16.0.1a2_amd64.deb')
	const gui = path.join(TMP, 'desktopvideo-gui_16.0.1a2_amd64.deb')
	fs.writeFileSync(main, 'x')
	fs.writeFileSync(gui, 'x')
	const script = `set -euo pipefail; source "${LIB}"
decklink_dkms_cache_restore() { return 0; }; decklink_ensure_dkms_prereqs() { return 0; }
decklink_rebuild_blackmagic_dkms() { :; }; decklink_modules_loaded() { return 1; }
DECKLINK_DKMS_CACHE_RESTORED=0
if decklink_install_vendor_pair "${main}" "${gui}" ""; then echo RESULT=ok; else echo RESULT=failed; fi`
	const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}`, HOME: TMP }, timeout: 30000 })
	assert.match(r.stdout, /RESULT=ok/, r.stdout + r.stderr)
	const calls = fs.readFileSync(log, 'utf8').trim().split('\n')
	assert.deepEqual(calls, [`--force-confmiss -i ${main} ${gui}`, `--force-confmiss -i ${main} ${gui}`])
})

test('D4: the lib parses; the install gate is the payload file, never the dpkg record (WO-431)', () => {
	for (const f of ['scripts/lib/decklink-install-lib.sh', 'scripts/runtime/decklink-install-from-exfat.sh', 'scripts/exfat/install-exfat-systemd-units.sh']) {
		const r = spawnSync('bash', ['-n', path.join(ROOT, f)], { encoding: 'utf8' })
		assert.equal(r.status, 0, `${f}: ${r.stderr}`)
	}
	const lib = read('scripts/lib/decklink-install-lib.sh')
	assert.match(lib, /DECKLINK_DPKG_INSTALL_OPTS=\(--force-confmiss\)/)
	assert.doesNotMatch(lib, /dpkg -i "\$\{debs\[@\]\}"/, 'no dpkg -i of the debs without the options')
	assert.match(lib, /decklink_payload_present\(\) \{\n\t\[\[ -e \/usr\/lib\/blackmagic\/DesktopVideo\/DesktopVideoHelper \]\]\n\}/)
	const gate = lib.match(/decklink_both_packages_installed_at_least\(\) \{[\s\S]*?\n\}/)[0]
	assert.match(gate, /decklink_payload_present \|\| return 1/)
	// a phantom record (dpkg says installed, no payload) still installs
	const r = spawnSync('bash', ['-c', `source "${LIB}"
decklink_pkg_installed_version() { echo 16.0.1a2; }; decklink_payload_present() { return 1; }
decklink_both_packages_installed_at_least 16.0.1a2 && echo GATE=installed || echo GATE=install`], { encoding: 'utf8' })
	assert.match(r.stdout, /GATE=install$/m)
})

test('D5: CI verify judges dev dependency licences after npm ci, right after the production licence step', () => {
	const pkg = JSON.parse(read('package.json'))
	assert.equal(pkg.scripts['verify:npm-licenses:dev'], 'node tools/ci/check-npm-licenses.js --include-dev')
	assert.equal(pkg.scripts['verify:npm-licenses'], 'node tools/ci/check-npm-licenses.js')
	const ci = read('.github/workflows/ci.yml')
	const verify = ci.slice(ci.indexOf('\n  verify:'), ci.indexOf('\n  godot:'))
	const ciStep = verify.indexOf('run: npm ci\n')
	const prod = verify.indexOf('run: npm run verify:npm-licenses\n')
	const dev = verify.indexOf('run: npm run verify:npm-licenses:dev\n')
	assert.ok(ciStep > 0 && prod > ciStep && dev > prod, 'npm ci (dev deps installed) → production licences → dev licences')
	assert.doesNotMatch(verify, /--omit=dev|NODE_ENV: production/, 'the verify job installs dev dependencies')
	const between = verify.slice(prod, dev)
	assert.equal((between.match(/- name:/g) || []).length, 1, 'the dev step follows the production step directly')
})
