'use strict'

/**
 * WO-429 — no credentials or user-supplied driver packages in produced ISOs:
 * both eggs exclude fragments (embed-server + exFAT-only) must carry the gh-token,
 * shell-history, keyring and vendor/ lines, and the ISO verifier must fail a squashfs
 * that contains any of them. (The gh OAuth token — the one that pushes this repo —
 * shipped in every ISO produced before 04.08.)
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
const REQUIRED = [
	'home/casparcg/.config/gh',
	'home/casparcg/.gitconfig',
	'home/casparcg/.bash_history',
	'home/casparcg/.local/share/keyrings',
	'home/casparcg/highascg/vendor',
	// pre-existing identity lines that must never regress
	'var/lib/tailscale',
	'home/casparcg/.config/syncthing',
	'home/casparcg/.ssh',
	'usr/NX',
]

test('WO-429: both exclude fragments carry every credential/vendor line', () => {
	for (const frag of FRAGMENTS) {
		const s = read(frag)
		for (const line of REQUIRED) {
			assert.ok(s.includes(line), `${frag} excludes ${line}`)
		}
	}
})

test('WO-429: ISO verifier fails a squashfs containing token/history/vendor', () => {
	const v = read('tools/eggs/live-usb/verify-iso-squashfs-excludes.sh')
	assert.match(v, /\.config\/gh\/hosts\.yml/, 'verifier checks the gh token file')
	assert.match(v, /ROTATE the token/, 'leak message tells the owner to rotate')
	assert.match(v, /\.bash_history/, 'verifier checks shell history')
	assert.match(v, /highascg\/vendor/, 'verifier checks the vendor package dir')
})
