'use strict'

/**
 * WO-1086 — tracked people as avatars in the previs (owner 15.11: "create a character based on the person that is
 * 'caught' by cameras … the camera live view looks horrible"). The look is derived in the sidecar
 * (tools/tracking-detect/traits.py: palette colours + hair length per tracked id, voted, locked, hysteresis); its
 * self-test runs when the box's tracking venv exists (CI has none: skipped there). Here, always:
 *  - personsFrom passes a well-formed `traits` through and drops junk (the only server change);
 *  - the imitated camera (WO-979) gives its persons fixed looks, end to end through the service;
 *  - the sidecar attaches traits after seg + pose from the raw frame; the Godot people layer has the Avatars style,
 *    which binds no camera video.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync, spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
const VENV_PY = path.join(os.homedir(), '.local/share/highascg/tracking-venv/bin/python')
const { personsFrom } = require(path.join(ROOT, 'src', 'tracking', 'detect-model'))

const BOX = [0.4, 0.2, 0.5, 0.9]
const LOOK = { top: [200, 40, 44], bottom: [30, 40, 80], skin: [234, 196, 166], hair: [25, 22, 22], hair_len: 'short', locked: true }

describe('WO-1086 previs avatars', () => {
	it('traits.py self-test (sidecar venv only)', (t) => {
		if (!fs.existsSync(VENV_PY)) return t.skip('no tracking venv on this machine')
		const r = spawnSync(VENV_PY, [path.join(ROOT, 'tools/tracking-detect/test_traits.py')], { encoding: 'utf8' })
		assert.equal(r.status, 0, r.stdout + r.stderr)
		assert.match(r.stdout, /\nPASS\n?$/)
	})

	it('personsFrom: well-formed traits pass, junk is dropped key by key', () => {
		const ps = personsFrom({
			tracks: [
				{ tid: 1, box: BOX, age_s: 0, traits: LOOK },
				{ tid: 2, box: BOX, age_s: 0, traits: { top: [300, 0, 0], skin: [1.5, 2, 3], hair: [1, 2], locked: 'yes' } },
				{ tid: 3, box: BOX, age_s: 0, traits: { top: [10, 20, 30], hair_len: 'mohawk', extra: 'x', locked: 1 } },
				{ tid: 4, box: BOX, age_s: 0, traits: [1, 2, 3] },
				{ tid: 5, box: BOX, age_s: 0 },
			],
		})
		assert.deepEqual(ps[0].traits, LOOK)
		assert.notEqual(ps[0].traits, LOOK, 'a copy, not the sidecar object')
		assert.equal('traits' in ps[1], false, 'nothing valid left → no traits')
		assert.deepEqual(ps[2].traits, { top: [10, 20, 30], locked: false })
		assert.equal('traits' in ps[3], false)
		assert.equal('traits' in ps[4], false)
	})

	it('the imitated camera gives every person a look (end to end through the real child)', async () => {
		const child = spawn(process.execPath, [path.join(ROOT, 'src/tracking/detect-sim.js')], { stdio: ['pipe', 'pipe', 'inherit'] })
		const got = await new Promise((resolve, reject) => {
			let buf = ''
			const timer = setTimeout(() => reject(new Error('no tracks from detect-sim')), 5000)
			child.stdout.on('data', (d) => {
				buf += d
				for (const line of buf.split('\n').slice(0, -1)) {
					const m = JSON.parse(line)
					if (m.type === 'tracks' && m.tracks.length === 3) {
						clearTimeout(timer)
						resolve(m)
					}
				}
				buf = buf.slice(buf.lastIndexOf('\n') + 1)
			})
			child.stdin.write(JSON.stringify({ type: 'config', interval_ms: 40, sim_persons: 3, cameras: [{ id: 'cam_1' }] }) + '\n')
		})
		child.stdin.end()
		const ps = personsFrom(got)
		assert.equal(ps.length, 3)
		assert.ok(ps.every((p) => p.traits && p.traits.locked === true && Array.isArray(p.traits.top)), JSON.stringify(ps))
		assert.equal(new Set(ps.map((p) => p.traits.top.join(','))).size, 3, 'three different looks')
	})

	it('wired: sidecar after seg + pose from raw pixels; Godot Avatars style binds no video', () => {
		const sc = read('tools/tracking-detect/sidecar.py')
		const at = (s) => sc.indexOf(s)
		assert.ok(at('pose.attach(tracks, poser.predict(rgb, cfg["confidence"]))') > 0)
		assert.ok(at('cam.traits.attach(tracks, face.bgr_from_bgra(pixels, r.width, r.height, r.stride), now,') > at('pose.attach(tracks, poser.predict('))
		assert.ok(at('cam.traits.attach(') < at('emit({"type": "captured"'))
		assert.match(read('src/tracking/detect-model.js'), /\.\.\.\(traitsFrom\(t\) \? \{ traits: traitsFrom\(t\) \} : \{\}\)/)
		const cards = read('godot/client/features/previs/tracking/person_cards.gd')
		assert.match(cards, /const STYLES := \["off", "cards", "dummies", "avatars"\]/)
		assert.match(cards, /if style == "avatars":\n\t\tavatars\.show_cards\(/)
		const av = read('godot/client/features/previs/tracking/person_avatars.gd')
		assert.doesNotMatch(av, /VideoSurfaces|ShaderMaterial|Texture/, 'avatars never touch camera video')
	})
})
