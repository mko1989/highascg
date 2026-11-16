'use strict'

/**
 * WO-1096 F — the generated licence tree (/usr/share/doc/highascg/licenses, which licenses/ symlinks to) tells the truth
 * and is complete: COMPLIANCE-ISO.md is tracked (tools/release/licenses/) and no longer claims Blackmagic is on the ISO,
 * the collector writes the stack licence texts + SOURCES.md (the written source offer for the deployed Caspar tag,
 * eggs patch, scanner, WayVR, cores, CEF, Ubuntu packages, this repo), the ISO verifier requires them, and both clients
 * keep NDI's trademark line + ndi.video.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '../..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
const VEND = 'tools/release/licenses'

describe('WO-1096 F: licence tree + source offer', () => {
	it('COMPLIANCE-ISO.md is tracked and says Blackmagic is NOT on the ISO', () => {
		const t = read(`${VEND}/COMPLIANCE-ISO.md`)
		assert.match(t, /Blackmagic Desktop Video \(DeckLink\) — not on the ISO/)
		assert.match(t, /blackmagic-desktopvideo-EULA/)
		assert.match(t, /NVIDIA/)
		assert.match(t, /NDI® is a registered trademark of Vizrt NDI AB/)
		assert.match(t, /§2\(b\)/)
		assert.match(t, /gdtf-share\.json/) // owner decision 16.11.26, recorded
		for (const f of [`${VEND}/COMPLIANCE-ISO.md`, 'tools/release/collect-third-party-licenses.sh']) {
			assert.doesNotMatch(read(f), /Embedded in HighAsCG ISO/i, f)
		}
		assert.match(read('tools/release/collect-third-party-licenses.sh'), /"isoShipStatus": "not-on-iso"/)
	})

	it('NDI version is read from Caspar\'s lib/ copy first (the system-path copy is excluded)', () => {
		const t = read('tools/release/collect-third-party-licenses.sh')
		assert.ok(t.indexOf('"${REPO_ROOT}/lib/libndi.so.6"') < t.indexOf('/usr/lib/x86_64-linux-gnu/libndi.so.6; do'))
	})

	it('vendored licence texts are the upstream ones', () => {
		assert.match(read(`${VEND}/third-party/godot-4.7.2-LICENSE.txt`), /Godot Engine contributors[\s\S]*Permission is hereby granted, free of charge/)
		assert.match(read(`${VEND}/third-party/godot-4.7.2-COPYRIGHT.txt`), /^Format: https:\/\/www\.debian\.org\/doc\/packaging-manuals\/copyright-format/m)
		assert.match(read(`${VEND}/third-party/companion-5.0.2-LICENSE.md`), /The MIT License[\s\S]*Bitfocus AS/)
		assert.match(read(`${VEND}/third-party/penguins-eggs-LICENSE.txt`), /either the MIT License or the GNU General Public License, Version 2/)
		assert.match(read(`${VEND}/third-party/casparcg-server-LICENSE.txt`), /GNU GENERAL PUBLIC LICENSE\s+Version 3/)
		assert.match(read(`${VEND}/third-party/cef-142.0.17-LICENSE.txt`), /Marshall A\. Greenblatt/)
		const xz = spawnSync('xz', ['-dc', path.join(ROOT, VEND, 'third-party/chromium-142.0.7444-LICENSES.html.xz')], { maxBuffer: 64 << 20 })
		assert.equal(xz.status, 0)
		assert.match(xz.stdout.toString('utf8', 0, 4096), /<html|<!DOCTYPE/i)
		assert.ok(xz.stdout.length > 10e6, 'full Chromium credits')
	})

	it('collect_stack_licenses writes the texts and a fully rendered SOURCES.md', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1096-lic-'))
		try {
			const lic = path.join(dir, 'licenses')
			fs.mkdirSync(path.join(lic, 'third-party'), { recursive: true })
			const r = spawnSync(
				'bash',
				[
					'-c',
					`set -euo pipefail; log(){ :; }; LIC="$1"; TP="$1/third-party"; REPO_ROOT="$2"; GENERATED_AT=2026-11-16T00:00:00Z
					 source "$2/tools/release/collect-licenses-stack.sh"; collect_stack_licenses "$1/extra.tsv"`,
					'x',
					lic,
					ROOT,
				],
				{ encoding: 'utf8', env: { ...process.env, HIGHASCG_LICENSES_HOME: path.join(dir, 'home'), HIGHASCG_LICENSES_NEXT_TO_BINARIES: '0' } },
			)
			assert.equal(r.status, 0, r.stderr)
			const tp = (f) => fs.existsSync(path.join(lic, 'third-party', f))
			for (const f of ['casparcg-server-GPL-3.0.txt', 'cef-LICENSE.txt', 'chromium-142.0.7444-LICENSES.html', 'godot-LICENSE.txt', 'godot-COPYRIGHT.txt']) {
				assert.ok(tp(f), f)
			}
			assert.ok(fs.existsSync(path.join(lic, 'COMPLIANCE-ISO.md')))
			const src = fs.readFileSync(path.join(lic, 'SOURCES.md'), 'utf8')
			assert.doesNotMatch(src, /@[A-Z_0-9]+@/, 'every placeholder filled')
			assert.match(src, /## Written offer/)
			assert.match(src, /three years/)
			assert.match(src, /mko1989\/casparcg-server\/tree\/highascg-/)
			assert.match(src, /scripts\/eggs\/patches/)
			assert.match(src, /wlx-team\/wayvr/)
			assert.match(src, /libretro/)
			assert.match(src, /ubuntu-packages\.tsv/)
			assert.match(src, /chromiumembedded\/cef/)
			const rows = fs.readFileSync(path.join(lic, 'extra.tsv'), 'utf8').trim().split('\n')
			for (const row of rows) assert.equal(row.split('\t').length, 8, row)
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})

	it('the ISO verifier requires the source offer and the licence texts', () => {
		const v = read('tools/eggs/live-usb/verify-iso-redistribution.sh')
		for (const needle of ['/SOURCES\\.md$', 'nvidia-driver\\.NOTICE$', 'libnvidia-gl-[0-9]+/copyright$', 'ndi-sdk-license-agreement', 'bin/LICENSE$', 'LICENSE-CEF', 'godot-COPYRIGHT', 'companion/LICENSE', 'libretro-', 'penguins-eggs-LICENSE']) {
			assert.ok(v.includes(needle), needle)
		}
		assert.match(v, /^\tlicence_tree_check "\$listing"$/m)
	})

	it('both clients keep the NDI trademark notice and ndi.video next to NDI', () => {
		const web = read('client/lib/ndi-attribution.js')
		assert.match(web, /NDI® is a registered trademark of Vizrt NDI AB/)
		assert.match(web, /https:\/\/ndi\.video\//)
		const gd = read('godot/client/features/devices/stream_record_model.gd')
		assert.match(gd, /NDI® is a registered trademark of Vizrt NDI AB/)
		assert.match(gd, /ndi\.video/)
		assert.match(read('godot/client/features/devices/live_input_dialog.gd'), /SR\.NDI_ATTRIBUTION/)
		assert.match(read('client/components/live-input-modal.js') + read('client/components/device-view-inspector-stream.js'), /createNdiAttributionElement|NDI_TRADEMARK_NOTICE/)
	})

	it('get-cores.sh keeps each core\'s copyright + version next to it', () => {
		const t = read('godot/retro/get-cores.sh')
		assert.match(t, /\$\{pkg\}\.copyright/)
		assert.match(t, /\$\{pkg\}\.version/)
	})
})
