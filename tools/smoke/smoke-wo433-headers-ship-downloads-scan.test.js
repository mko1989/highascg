'use strict'

/**
 * WO-433 — DeckLink GUI install died on fresh clones with
 * "linux-headers-… installed but /lib/modules/…/build still missing":
 * the exclude fragments stripped ALL of usr/src (the headers DKMS needs) while the
 * shipped dpkg status still claimed the packages, so apt "already the newest version"
 * could not heal it. Headers must ship; the installer must self-heal phantoms with
 * --reinstall; the verifier must check real files, not just dpkg status.
 * Also: the vendor scan must include ~/Downloads (package is downloaded ON the box).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const FRAGMENTS = [
	'tools/eggs/live-usb/penguins-eggs-exclude-highascg-embed-server.list',
	'tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list',
]

test('WO-433: no fragment excludes usr/src wholesale (headers must ship for DKMS)', () => {
	for (const frag of FRAGMENTS) {
		const lines = read(frag)
			.split('\n')
			.map((l) => l.trim())
		assert.ok(!lines.includes('usr/src'), `${frag} must not exclude usr/src`)
		assert.ok(!lines.includes('usr/src/*'), `${frag} must not exclude usr/src/*`)
		assert.ok(lines.includes('usr/src/nvidia-*'), `${frag} keeps nvidia source tree masked`)
		assert.ok(lines.includes('usr/src/blackmagic-*'), `${frag} keeps blackmagic source tree masked`)
	}
})

test('WO-433: ISO verifier checks the real header FILES, not just dpkg status', () => {
	const v = read('tools/eggs/live-usb/verify-iso-squashfs-excludes.sh')
	assert.ok(
		v.includes('usr/src/linux-headers-${kver}/Makefile'),
		'verifier asserts the header tree files exist in the squashfs'
	)
})

test('WO-433: installer self-heals phantom header packages with apt --reinstall', () => {
	const lib = read('scripts/lib/decklink-install-lib.sh')
	assert.match(lib, /apt-get install --reinstall -y --no-install-recommends "\$\{hdr_base\}" "\$\{hdr_pkg\}"/)
	assert.match(lib, /hdr_base="\$\{hdr_pkg%-generic\}"/, 'base (non-generic) package reinstalls too')
})

test('WO-433: vendor scan includes ~/Downloads in both halves (script + API)', () => {
	const lib = read('scripts/lib/decklink-install-lib.sh')
	assert.ok(lib.includes('/home/casparcg/Downloads'), 'decklink_vendor_search_dirs scans Downloads')
	const api = read('src/api/system-hardware-decklink.js')
	assert.ok(api.includes("'/home/casparcg/Downloads'"), 'checkDecklinkVendorAvailable scans Downloads')
})
