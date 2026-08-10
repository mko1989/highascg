'use strict'

/**
 * WO-462 round 2 — why two different sticks both failed with "invalid magic number".
 *
 * The ISO file appears when `eggs produce` finishes, but the build keeps REWRITING it:
 * patch-iso-squashfs-calamares.sh re-packs filesystem.squashfs and inject-iso-boot-branding.sh
 * re-packs the whole image. On the 1221 build the name says 12:21 while the final bytes landed
 * at 12:26:00.662. A stick copy started inside that window reads part of the old image and part
 * of the new one — full correct size, clean prefix, then divergence (2.37 GiB on that build,
 * 256 MiB on the previous one), and GRUB dies loading a kernel that is no longer a kernel.
 *
 * The ISO's filename timestamp is the PRODUCE time, not the finish time, so it cannot be used as
 * a ready signal. The build therefore writes <iso>.sha256 as its very last action, and that
 * sidecar is the marker. These tests pin the ordering — a sidecar written before the re-pack
 * would certify a torn image.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD = 'tools/eggs/live-usb/build-highascg-egg.sh'
const VERIFY = 'tools/eggs/live-usb/verify-stick-iso.sh'
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

describe('WO-462 ISO copy race guard', () => {
	const build = read(BUILD)

	it('the build writes a .sha256 completion sidecar', () => {
		assert.match(build, /sha256sum "\$\(basename "\$BUILT_ISO"\)" >"\$\(basename "\$BUILT_ISO"\)\.sha256"/)
	})

	it('the sidecar is written AFTER every step that re-packs the ISO', () => {
		const sidecar = build.indexOf('.sha256"')
		for (const step of ['patch-iso-squashfs-calamares.sh', 'inject-iso-boot-branding.sh', 'verify-iso-boot-branding.sh']) {
			const at = build.indexOf(step)
			assert.ok(at > 0, `${step} should still run in the build`)
			assert.ok(at < sidecar, `${step} must run BEFORE the sidecar, or the sidecar certifies a torn image`)
		}
	})

	it('the build tells the operator not to copy early, and how to verify', () => {
		assert.match(build, /DO NOT copy the ISO to a stick before this point/)
		assert.match(build, /&& sync/, 'the copy instruction must flush')
		assert.match(build, /verify-stick-iso\.sh/, 'must point at the verifier')
	})

	it('verify-stick-iso.sh prefers the sidecar and warns when it is absent', () => {
		const v = read(VERIFY)
		assert.match(v, /if \[\[ ! -f "\$\{src_iso\}\.sha256" \]\]; then/, 'must notice a missing sidecar')
		assert.match(v, /cannot confirm the build had finished/)
		assert.match(v, /s_hash="\$\(cut -d' ' -f1 <"\$\{src_iso\}\.sha256"\)"/, 'use the recorded hash when present')
	})

	it('size equality alone is never treated as success', () => {
		const v = read(VERIFY)
		const sizeOk = v.indexOf('size differs')
		const hashCheck = v.indexOf('CONTENT DIFFERS at identical size')
		assert.ok(sizeOk > 0 && hashCheck > sizeOk, 'a size match must still fall through to the hash comparison')
	})
})
