'use strict'

/**
 * WO-665 — person cut-out cards (research step 1). Sidecar: seg.py's self-test (mask sampling inside the track box,
 * letterbox mapping, wire format, live-only attach) runs when the box's tracking venv exists — CI has none, skipped
 * there. Server: personsFrom passes a well-formed mask through and drops junk; maskSizeFrom; the WS snapshot
 * carries the camera's mask_size only while fresh. Godot: the card layer is wired into the previs 3D stage.
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')

const { personsFrom, maskSizeFrom } = require('../../src/tracking/detect-model')
const { createDetectService } = require('../../src/tracking/detect-service')

const ROOT = path.join(__dirname, '..', '..')
const VENV_PY = path.join(os.homedir(), '.local/share/highascg/tracking-venv/bin/python')
const CAM = { pos_x: 0, pos_y: -10, pos_z: 5, pitch: -20, yaw: 0, roll: 0, fov: 60, lens_k1: 0, lens_k2: 0 }
const CE = { id: 'cam_1', role: 'ch1', raster: [1920, 1080], cam: CAM }
const BOX = [0.45, 0.3, 0.55, 0.8]
const MASK = Buffer.alloc(576, 0xf0).toString('base64')
const tick = () => new Promise((r) => setImmediate(r))
const services = []
after(() => services.forEach((s) => s.stop()))

describe('WO-665 person cut-out cards', () => {
	it('seg.py self-test (sidecar venv only)', (t) => {
		if (!fs.existsSync(VENV_PY)) return t.skip('no tracking venv on this machine')
		const r = spawnSync(VENV_PY, [path.join(ROOT, 'tools/tracking-detect/test_seg.py')], { encoding: 'utf8' })
		assert.equal(r.status, 0, r.stdout + r.stderr)
		assert.match(r.stdout, /^PASS$/m)
	})

	it('personsFrom: a well-formed mask passes through, junk is dropped', () => {
		const msg = { tracks: [
			{ tid: 1, box: BOX, score: 0.9, age_s: 0, mask: MASK },
			{ tid: 2, box: BOX, score: 0.9, age_s: 0, mask: 'not base64!' },
			{ tid: 3, box: BOX, score: 0.9, age_s: 0.2 },
		] }
		const ps = personsFrom(msg, CE)
		assert.equal(ps.length, 3)
		assert.equal(ps[0].mask, MASK)
		assert.equal('mask' in ps[1], false)
		assert.equal('mask' in ps[2], false)
		assert.equal('mask' in personsFrom({ tracks: [{ tid: 4, box: BOX, age_s: 0, mask: 'A'.repeat(5000) }] }, CE)[0], false)
	})

	it('maskSizeFrom: positive ints ≤ 256 or null', () => {
		assert.deepEqual(maskSizeFrom({ mask_size: [48, 96] }), [48, 96])
		assert.equal(maskSizeFrom({}), null)
		assert.equal(maskSizeFrom({ mask_size: [48] }), null)
		assert.equal(maskSizeFrom({ mask_size: [48, 0] }), null)
		assert.equal(maskSizeFrom({ mask_size: [48, 1000] }), null)
		assert.equal(maskSizeFrom({ mask_size: [48.5, 96] }), null)
	})

	it('snapshot: mask_size while fresh, gone once stale', async () => {
		const procs = []
		const spawn = () => {
			const proc = new EventEmitter()
			proc.pid = 4243
			proc.stdin = { writable: true, write() {}, end() {}, on() {} }
			proc.stdout = new PassThrough()
			proc.stderr = new PassThrough()
			proc.kill = () => {}
			procs.push(proc)
			return proc
		}
		let clock = 1000
		const svc = createDetectService({ log: () => {} }, {
			spawn, exists: () => true, python: '/fake/python', modelsDir: '/fake/models', lease: () => Promise.resolve([]),
			autostart: false, now: () => clock,
			project: { previs: { tracking: { grid: { z_offset: 0 }, cameras: [CE], detection: { enabled: true } } } },
		})
		services.push(svc)
		const proc = procs[0]
		proc.stdout.write('{"type":"ready","providers":["CPUExecutionProvider"]}\n')
		proc.stdout.write(JSON.stringify({ type: 'tracks', camera: 'cam_1', mask_size: [48, 96],
			tracks: [{ tid: 3, box: BOX, score: 0.8, age_s: 0, mask: MASK }] }) + '\n')
		await tick()
		const cam = svc.snapshot().cameras[0]
		assert.deepEqual(cam.mask_size, [48, 96])
		assert.equal(cam.persons[0].mask, MASK)
		clock += 1500
		assert.equal('mask_size' in svc.snapshot().cameras[0], false)
	})

	it('Godot: the card layer sits on the 3D stage, fed by detections, toggled from the toolbar', () => {
		const tab = fs.readFileSync(path.join(ROOT, 'godot/client/features/previs/previs_tab.gd'), 'utf8')
		assert.match(tab, /var cards := preload\("res:\/\/features\/previs\/tracking\/person_cards\.gd"\)\.new\(\)/)
		assert.match(tab, /stage\.add_child\(cards\)/)
		assert.match(tab, /cards\.set_detections\(markers\.detections\)/)
		assert.match(tab, /cards\.set_shown\(is3d and shown\)/)
		assert.match(tab, /bar\.add_child\(cards\.toggle\)/)
		const cards = fs.readFileSync(path.join(ROOT, 'godot/client/features/previs/tracking/person_cards.gd'), 'utf8')
		assert.match(cards, /VideoSurfaces\.release_all\(self\)/, 'video is released when the cards go off')
	})
})
