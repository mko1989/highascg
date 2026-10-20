'use strict'

/**
 * WO-624 E2 — the operator picks the tracked person (owner 20.10: "in the camera previs i can't see an option to pick
 * as a tracking object"). Before, the replace pin always chose by itself (sticky track, else nearest the last centre,
 * else the LARGEST box), so a smaller person could never be followed. A pick (DetectPin.request, POST
 * /api/tracking/detect/pick) wins over that rule, waits across the client's switch into replace, and expires.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { DetectPin, PICK_TTL_MS } = require('../../src/tracking/detect-pin')
const { MarkerHub } = require('../../src/tracking/marker-hub')
const { normalizeDetection } = require('../../src/tracking/detect-model')

const ROOT = path.join(__dirname, '../..')
const ENTRY = { cam: { pos_x: 0, pos_y: -10, pos_z: 5, pitch: -20, yaw: 0, roll: 0, fov: 60, lens_k1: 0, lens_k2: 0 }, raster: [1920, 1080] }
/** World persons (fused shape): no box maths, the floor point is the target. */
const wp = (id, x, y, area) => ({ key: `w:${id}`, camera: 'world', tid: id, world: [x, y], score: 0.8, age_s: 0, area })
const cam = (tid, box) => ({ key: `cam_1:${tid}`, camera: 'cam_1', tid, box, score: 0.8, age_s: 0, camEntry: ENTRY })
const cfgOf = (over) => normalizeDetection({ enabled: true, pin_point: 'bottom', pin_marker_id: 1, ...over })

function rig() {
	const t = { ms: 1000 }
	const hub = new MarkerHub({ now: () => t.ms })
	hub.set({ id: 1, x: 0, y: 0, z: 0 })
	return { t, hub, pin: new DetectPin() }
}
const step = (r, cfg, persons) => r.pin.step({ cfg, available: true, persons, hub: r.hub, planeZ: 0, now: r.t.ms, dt: 1 / 60 })

describe('WO-624 E2 DetectPin.request — the operator picks who is followed', () => {
	it('without a pick the largest box wins; a pick takes the small one and stays on it', () => {
		const r = rig()
		const big = cam(1, [0.1, 0.1, 0.5, 0.9])
		const small = cam(2, [0.6, 0.5, 0.65, 0.6])
		step(r, cfgOf({ pin_mode: 'replace' }), [big, small])
		assert.equal(r.pin.pinnedKey, 'cam_1:1', 'baseline: the largest box')
		r.pin.request('cam_1:2', r.t.ms)
		r.t.ms += 17
		step(r, cfgOf({ pin_mode: 'replace' }), [big, small])
		assert.equal(r.pin.pinnedKey, 'cam_1:2')
		assert.deepEqual(r.pin.attached(), { 'cam_1:2': 1 })
		r.t.ms += 17
		step(r, cfgOf({ pin_mode: 'replace' }), [big, small])
		assert.equal(r.pin.pinnedKey, 'cam_1:2', 'sticky afterwards (the pick is consumed, the track holds it)')
		assert.equal(r.pin.requested, null)
	})

	it('a pick made in assist waits for the switch into replace (the client flips pin_mode a debounce later)', () => {
		const r = rig()
		const persons = [wp(5, 4, 4, 3), wp(9, -2, 6, 1)]
		step(r, cfgOf({ pin_mode: 'assist' }), persons)
		r.pin.request('w:9', r.t.ms)
		r.t.ms += 3000
		step(r, cfgOf({ pin_mode: 'assist' }), persons)
		r.t.ms += 17
		step(r, cfgOf({ pin_mode: 'replace' }), persons)
		assert.equal(r.pin.pinnedKey, 'w:9', 'not the larger w:5')
		const m = r.hub.markers.get(1)
		assert.deepEqual([m.x, m.y], [-2, 6], 'the marker lands on the picked person')
	})

	it('an unseen pick expires; a person who left is not waited for forever', () => {
		const r = rig()
		const persons = [wp(5, 4, 4, 3), wp(9, -2, 6, 1)]
		r.pin.request('w:7', r.t.ms)
		r.t.ms += PICK_TTL_MS + 1
		step(r, cfgOf({ pin_mode: 'replace' }), persons)
		assert.equal(r.pin.pinnedKey, 'w:5', 'back to the plain rule')
		assert.equal(r.pin.requested, null)
	})

	it('a coasting (unmatched) person is still pickable within the coast window', () => {
		const r = rig()
		const persons = [wp(5, 4, 4, 3), { ...wp(9, -2, 6, 1), age_s: 0.2 }]
		r.pin.request('w:9', r.t.ms)
		step(r, cfgOf({ pin_mode: 'replace', grace_ms: 500 }), persons)
		assert.equal(r.pin.pinnedKey, 'w:9')
	})
})

describe('WO-624 E2 route', () => {
	it('POST /api/tracking/detect/pick validates the key against the live persons and requests the pin', () => {
		const src = fs.readFileSync(path.join(ROOT, 'src/tracking/register.js'), 'utf8')
		assert.match(src, /method === 'POST' && path === '\/api\/tracking\/detect\/pick'\) return pick\(body\)/)
		assert.match(src, /if \(!persons\.some\(\(p\) => p\.key === key\)\) return reply\(404/)
		assert.match(src, /pin\.request\(key, now\)/)
	})
})
