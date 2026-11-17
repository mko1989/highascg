'use strict'

/**
 * WO-1106 (godot-previs slice) — review fixes checked from Node:
 * A42: a drape colour has one canonical form "#rrggbb" in both twins — src/stage/drape-geometry.js colorOf reads
 *      "#rgb" / "#rgba" / "#rrggbbaa" (API / hand edits, accepted by Godot) as that colour, not as black, and
 *      stage_objects.gd drape_color stores the same form.
 * A22: what tools/people/dna_to_glb.py writes beside a DNA (Fab-derived: <name>.converted.glb, convert.json and their
 *      .tmp) is ignored by git and Syncthing and fails the ISO verifier.
 * The Godot halves run in godot/client/tests/test_previs_wo1106.gd and test_human_own_wo1106.gd.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const Drape = require('../../src/stage/drape-geometry')

describe('WO-1106 godot-previs slice', () => {
	it('A42: every colour form Godot accepts reads as that colour, in "#rrggbb"', () => {
		assert.equal(Drape.colorOf('#fff'), '#ffffff')
		assert.equal(Drape.colorOf('#abcd'), '#aabbcc', '#rgba: alpha dropped')
		assert.equal(Drape.colorOf('#1b244280'), '#1b2442', '#rrggbbaa: alpha dropped')
		assert.equal(Drape.colorOf('#1B2442'), '#1B2442', '#rrggbb as given')
		for (const bad of ['red', '#12345', '', null, undefined, 42]) assert.equal(Drape.colorOf(bad), '#151515', String(bad))
		assert.deepEqual(Drape.linearColor('#fff').slice(0, 3), [1, 1, 1], 'white in the MVR export / the games, not black')
		const gd = read('godot/client/features/previs/stage_objects.gd')
		assert.match(gd, /o\["color"\] = drape_color\(o\.color\)/, 'Godot normalize stores the canonical form')
		assert.match(gd, /return s if s\.length\(\) == 7 else "#" \+ Color\.html\(s\)\.to_html\(false\)/)
	})

	it('A22: DNA conversion output is ignored by git and Syncthing', () => {
		const want = ['*.converted.glb', '*.converted.glb.tmp', 'convert.json', 'convert.json.tmp']
		const gi = read('.gitignore').split('\n')
		const st = read('.stignore').split('\n')
		for (const w of want) {
			assert.ok(gi.includes(w), `.gitignore: ${w}`)
			assert.ok(st.includes(w), `.stignore: ${w}`)
		}
	})

	it('A22: the ISO verifier fails on a converted GLB or a convert.json under home/, not on a system convert.json', () => {
		const VERIFY = path.join(ROOT, 'tools', 'eggs', 'live-usb', 'verify-iso-detection-runtime.sh')
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1106-verify-'))
		try {
			const verify = (lines) => {
				const f = path.join(dir, 'listing.txt')
				fs.writeFileSync(f, lines.join('\n') + '\n')
				return spawnSync('bash', [VERIFY, f], { encoding: 'utf8' })
			}
			const clean = ['squashfs-root/usr/share/mc/hints/mc.hint.pt', 'squashfs-root/usr/share/x/convert.json', 'squashfs-root/home/casparcg/highascg/tools/people/dna_to_glb.py']
			assert.equal(verify(clean).status, 0)
			for (const bad of ['squashfs-root/home/casparcg/highascg/tools/people/ada/ada.converted.glb', 'squashfs-root/opt/x/ada.converted.glb.tmp',
				'squashfs-root/home/casparcg/highascg/tools/people/ada/convert.json', 'squashfs-root/root/ada/convert.json.tmp']) {
				const r = verify([...clean, bad])
				assert.equal(r.status, 1, bad)
				assert.ok(r.stderr.includes(bad), bad)
			}
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})
})
