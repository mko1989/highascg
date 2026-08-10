'use strict'

/* WO-471 — two boot-time defects, both measured on highascg7579.
 *
 * `systemd-analyze critical-chain casparcg-server.service` on a stickless boot:
 *     casparcg-server.service            @31.489s
 *     └─highascg-exfat-sync.service      @30.852s  +628ms
 *       └─highascg-decklink-install.service @30.779s  +54ms
 *         └─highascg-exfat-boot.service  @649ms   +30.111s
 *
 * 1. The 30s was the exfat boot script polling once a second for a stick that was never coming.
 *    Caspar is ordered behind that chain, so playout waited on absent optional hardware.
 * 2. The decklink gate's final branch queued a DKMS build whenever `dpkg-query` did not report
 *    desktopvideo installed. WO-431 established that a clone ships /var/lib/dpkg/status whole, so
 *    dpkg is not evidence either way; a working box could rebuild every boot.
 *
 * THE TRAP: this script exists twice. patch-wo47-exfat-boot-scripts.sh's pick_src prefers
 * scripts/exfat/ and only falls back to tools/runtime/wo47-*, and install-exfat-systemd-units.sh
 * installs from scripts/exfat/ exclusively. Editing only the tools/runtime copy is a no-op on a real
 * host. Both copies are asserted here so they cannot drift apart again. */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const COPIES = ['scripts/exfat/highascg-exfat-boot.sh', 'tools/runtime/wo47-highascg-exfat-boot.sh']

test('WO-471: a stickless boot does not pay the full label wait', () => {
	for (const rel of COPIES) {
		const src = read(rel)
		assert.match(src, /STICKLESS_GRACE_SEC=/, `${rel} defines the stickless grace`)
		assert.match(src, /udevadm settle/, `${rel} settles udev before deciding no stick is present`)
		assert.match(src, /\$2 == "usb"/, `${rel} checks for any USB-transport disk`)
		/* The loop must honour the reduced bound, not the raw WAIT_SEC. */
		assert.match(src, /for \(\(i = 0; i < wait_for; i\+\+\)\)/, `${rel} loops on the resolved wait`)
		assert.ok(
			!/for \(\(i = 0; i < WAIT_SEC; i\+\+\)\)/.test(src),
			`${rel} still loops on the unreduced WAIT_SEC`,
		)
	}
})

test('WO-471: the decklink gate reads driver state, not dpkg', () => {
	for (const rel of COPIES) {
		const src = read(rel)
		assert.match(src, /elif lsmod 2>\/dev\/null \| grep -q blackmagic; then/, `${rel} skips when loaded`)
		assert.match(src, /elif ! lspci 2>\/dev\/null \| grep -qi blackmagic; then/, `${rel} skips with no card`)
		/* The dpkg-only branch is what rebuilt on every boot — it must be gone from the CODE. The
		 * comments above the gate cite it deliberately, so only executable lines are checked. */
		const code = src
			.split('\n')
			.filter((l) => !l.trimStart().startsWith('#'))
			.join('\n')
		assert.ok(
			!/dpkg-query[^\n]*desktopvideo/.test(code),
			`${rel} still decides the decklink install from dpkg-query`,
		)
	}
})

test('WO-471: scripts/exfat is the copy that ships, so it must never lag', () => {
	const patcher = read('tools/runtime/patch-wo47-exfat-boot-scripts.sh')
	const scriptsAt = patcher.indexOf('${REPO_ROOT}/scripts/exfat/${name}')
	const fallbackAt = patcher.indexOf('${HERE}/wo47-${name}')
	assert.ok(scriptsAt >= 0 && fallbackAt >= 0, 'pick_src still offers both candidates')
	assert.ok(scriptsAt < fallbackAt, 'scripts/exfat must remain the preferred source')
	assert.match(
		read('scripts/exfat/install-exfat-systemd-units.sh'),
		/BOOT_SH_SRC="\$\{REPO_ROOT\}\/scripts\/exfat\/highascg-exfat-boot\.sh"/,
		'the installer still ships the scripts/exfat copy',
	)
})
