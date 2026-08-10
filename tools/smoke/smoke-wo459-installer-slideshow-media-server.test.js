'use strict'

/**
 * WO-459 — Calamares installer slideshow still said "Broadcast graphics playout".
 *
 * Owner ruled twice (todos03.08 §30, todos10.08 §1): the product is a MEDIA SERVER, and no
 * operator-facing surface may say "broadcast" or "playout". The installer slideshow was missed
 * by the first sweep because it only renders mid-install — it is invisible on a running box and
 * on the ISO until someone actually installs to disk.
 *
 * Guards the repo source of truth (install-eggs-calamares.sh syncs it to
 * /etc/calamares/branding/highascg-eggs-theme/ before produce) and the ISO-side verifier gate.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const QML = 'tools/eggs/live-usb/highascg-eggs-theme/theme/calamares/branding/show.qml'
const VERIFIER = 'tools/eggs/live-usb/verify-iso-boot-branding.sh'
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

describe('WO-459 installer slideshow wording', () => {
	it('show.qml has no broadcast/playout wording in any displayed string', () => {
		const src = read(QML)
		const offenders = src
			.split('\n')
			.map((line, i) => [i + 1, line])
			.filter(([, line]) => /qsTr\(|text:/.test(line) && /broadcast|playout/i.test(line))
		assert.deepEqual(offenders, [], 'operator-facing slideshow text must say "media server"')
	})

	it('show.qml still identifies the product as a media server', () => {
		const src = read(QML)
		assert.match(src, /qsTr\("Media server — installing to this machine"\)/)
		assert.match(src, /qsTr\("One-box media server"\)/)
		assert.match(src, /text: "HighAsCG"/, 'wordmark slide must survive (WO-148)')
	})

	it('the ISO verifier fails a slideshow that reintroduces the wording', () => {
		const src = read(VERIFIER)
		assert.match(src, /grep -qiE 'broadcast\|playout' <<<"\$show_qml"/, 'squashfs gate must reject it')
		assert.match(src, /bad "Calamares slideshow says 'broadcast'\/'playout'/)
	})
})
