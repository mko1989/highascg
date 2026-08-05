'use strict'

/**
 * WO-430 — merged-usr broke the "driver-free ISO" guarantee: /lib is a symlink to
 * usr/lib, so the anchored `lib/modules/*` excludes in the decklink fragment never
 * matched the real DKMS module files under usr/lib/modules/. The kernel driver
 * shipped in every ISO and autoloaded on install (seen live: 16.2a1 + /dev/blackmagic
 * on a fresh driverless box). The fragment must carry the usr/lib/... lines and the
 * verifier must fail a squashfs containing the modules.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

test('WO-430: decklink fragment excludes merged-usr DKMS module + udev rule paths', () => {
	const s = read('tools/eggs/live-usb/penguins-eggs-exclude-decklink.list')
	for (const line of [
		'usr/lib/modules/*/updates/dkms/blackmagic.ko*',
		'usr/lib/modules/*/updates/dkms/blackmagic-io.ko*',
		'usr/lib/modules/*/updates/dkms/snd_blackmagic-io.ko*',
		'usr/lib/udev/rules.d/55-blackmagic.rules',
	]) {
		assert.ok(s.includes(line), `fragment excludes ${line}`)
	}
})

test('WO-430: ISO verifier fails a squashfs containing the DeckLink kernel modules', () => {
	const v = read('tools/eggs/live-usb/verify-iso-squashfs-excludes.sh')
	assert.match(
		v,
		/usr\/lib\/modules\/\[\^\/\]\+\/updates\/dkms\/\(snd_\)\?blackmagic/,
		'verifier greps the merged-usr DKMS module path'
	)
	assert.ok(
		v.includes("'usr/lib/udev/rules.d/55-blackmagic.rules'"),
		'verifier checks the merged-usr udev rule path'
	)
})
