'use strict'

/**
 * WO-616 T9b — detection pinning (src/tracking/detect-pin.js): the replace pin (one hub marker driven from one
 * tracked person: sticky by track, re-acquired nearest the last centre, else the largest box; velocity-EMA
 * prediction and EMA smoothing; status graded from the score and faded while coasting) and the assist pin (an
 * operator anchor the marker glides toward the nearest person of, clipped by radius, eased by strength, released
 * when the anchor goes stale). Expectations are OpenFollow's (services_detection_pin.py, frame_timing.py,
 * detection.py tracked_detection). Boxes are built from the camera model's own projection, so the feet points
 * round-trip through pixelToFloor and the tolerances only cover the hub's 1e-4 rounding.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { DetectPin, detectionStatus, dtSteps, emaFactor, advanceSmoothing } = require('../../src/tracking/detect-pin')
const { MarkerHub } = require('../../src/tracking/marker-hub')
const { normalizeDetection } = require('../../src/tracking/detect-model')
const { project } = require('../../src/tracking/camera-model')

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps
const DT = 1 / 60
const CAM = { pos_x: 0, pos_y: -10, pos_z: 5, pitch: -20, yaw: 0, roll: 0, fov: 60, lens_k1: 0, lens_k2: 0 }
const ENTRY = { cam: CAM, raster: [1920, 1080] }

/** Normalised box whose bottom-centre pixel is the projection of the floor point [x, y, 0]. */
function boxAt(x, y) {
	const [[sx, sy]] = project(CAM, [[x, y, 0]], 1920, 1080)
	return [sx / 1920 - 0.02, sy / 1080 - 0.2, sx / 1920 + 0.02, sy / 1080]
}
const person = (key, x, y, extra) => ({
	key,
	camera: key.split(':')[0],
	tid: Number(key.split(':')[1]),
	box: boxAt(x, y),
	score: 0.8,
	age_s: 0,
	camEntry: ENTRY,
	...extra,
})
const area = (b) => (b[2] - b[0]) * (b[3] - b[1])
const cfgOf = (over) => normalizeDetection({ enabled: true, pin_point: 'bottom', ...over })

/** A hub on a manually advanced clock, and a fresh pin engine. */
function rig() {
	const t = { ms: 1000 }
	return { t, hub: new MarkerHub({ now: () => t.ms }), pin: new DetectPin() }
}

/** One animate tick at a nominal frame. */
function step(r, cfg, persons, available = true) {
	r.pin.step({ cfg, available, persons, hub: r.hub, planeZ: 0, now: r.t.ms, dt: DT })
}

/** Assist rig: marker 1 at the origin of the test line (y 3), anchored there by the operator. */
function assistRig(over) {
	const r = rig()
	r.hub.set({ id: 1, x: 0, y: 3, z: 0 })
	r.pin.setAnchor({ id: 1, x: 0, y: 3, z: 0 }, r.t.ms)
	return {
		...r,
		cfg: cfgOf({ pin_mode: 'assist', smoothing: 1, prediction: 0, assist_strength: 1, assist_radius_m: 1, ...over }),
	}
}

describe('WO-616 T9b detection pinning', () => {
	it('detectionStatus: OpenFollow vectors at grace 0.5 (score, threshold)', () => {
		const vectors = [
			[0.2, 0.2, 0.5],
			[1.0, 0.2, 1.0],
			[0.6, 0.2, 0.75],
			[0.1, 0.2, 0.4375],
			[0.0, 0.5, 0.0],
			[0.5, 1.0, 1.0],
			[0.9, 1.5, 1.0],
		]
		for (const [score, threshold, want] of vectors) {
			assert.ok(near(detectionStatus(score, threshold, 0, 0.5), want), `(${score}, ${threshold}) → ${want}`)
		}
	})

	it('detectionStatus: coasting fades linearly over the grace window', () => {
		for (const [age, factor] of [
			[0, 1],
			[0.25, 0.5],
			[0.5, 0],
			[0.75, 0],
		]) {
			assert.ok(near(detectionStatus(0.6, 0.2, age, 0.5), 0.75 * factor), `age ${age}`)
		}
		assert.equal(detectionStatus(0.9, 0.2, 0.001, 0), 0)
	})

	it('emaFactor and dtSteps: frame-rate scaling with the 0.2 s clamp', () => {
		assert.equal(emaFactor(0.3, 1), 0.3)
		assert.ok(near(emaFactor(0.5, 2), 0.75))
		assert.equal(emaFactor(1, 3), 1)
		assert.ok(near(dtSteps(1 / 60), 1))
		assert.ok(near(dtSteps(10), 12))
		assert.ok(near(dtSteps(0), 0.06))
	})

	it('advanceSmoothing: nominal step matches the legacy formula', () => {
		const cfg = cfgOf({ prediction: 2, smoothing: 0.5 })
		const s = new DetectPin()._state(1)
		assert.deepEqual(advanceSmoothing(s, 1, 2, cfg, 1), [1, 2])
		const [x, y] = advanceSmoothing(s, 2, 2, cfg, 1)
		assert.ok(near(x, 1 + 0.5 * (2 + 0.3 * 1 * 2 - 1)), `x ${x}`)
		assert.equal(y, 2)
	})

	it('advanceSmoothing: pin velocity is frame-rate independent', () => {
		const cfg = cfgOf({ prediction: 8, smoothing: 0.5 })
		const velocityAfter300 = (steps, dx) => {
			const s = new DetectPin()._state(1)
			let x = 0
			for (let i = 0; i < 300; i++) {
				x += dx
				advanceSmoothing(s, x, 0, cfg, steps)
			}
			return s.vx
		}
		const v1 = velocityAfter300(1, 2 / 60)
		const v2 = velocityAfter300(2, (2 * 2) / 60)
		assert.ok(Math.abs(v1 - 2 / 60) / (2 / 60) < 1e-3, `steps 1: ${v1}`)
		assert.ok(Math.abs(v2 - 2 / 60) / (2 / 60) < 1e-3, `steps 2: ${v2}`)
	})

	it('replace: the first frame lands on the person with no lag', () => {
		const r = rig()
		r.hub.set({ id: 1, x: 0, y: 0, z: 1.5 })
		step(r, cfgOf({ pin_mode: 'replace', pin_marker_id: 1, smoothing: 0.15 }), [person('cam_1:0', 2, 3)])
		const m = r.hub.markers.get(1)
		assert.ok(Math.abs(m.x - 2) < 0.01 && Math.abs(m.y - 3) < 0.01, `at ${m.x}, ${m.y}`)
		assert.equal(m.z, 1.5)
		assert.equal(m.source, 'detect')
		// score 0.8 at threshold 0.2, matched this step: 0.5 + 0.5 * 0.6 / 0.8 = 0.875
		assert.ok(near(m.status, detectionStatus(0.8, 0.2, 0, 0.5), 1e-4), `status ${m.status}`)
	})

	it('replace: smoothing is an EMA on the floor point', () => {
		const r = rig()
		r.hub.set({ id: 1, x: 0, y: 0, z: 0 })
		const cfg = cfgOf({ pin_mode: 'replace', pin_marker_id: 1, smoothing: 0.5, prediction: 0 })
		step(r, cfg, [person('cam_1:0', 2, 3)])
		step(r, cfg, [person('cam_1:0', 4, 3)])
		assert.ok(Math.abs(r.hub.markers.get(1).x - 3) < 0.01, `x ${r.hub.markers.get(1).x}`)
	})

	it('replace: velocity prediction extrapolates the target', () => {
		const r = rig()
		r.hub.set({ id: 1, x: 0, y: 0, z: 0 })
		const cfg = cfgOf({ pin_mode: 'replace', pin_marker_id: 1, smoothing: 1, prediction: 1 })
		step(r, cfg, [person('cam_1:0', 0, 3)])
		step(r, cfg, [person('cam_1:0', 1, 3)])
		const s = r.pin.states.get(1)
		assert.ok(Math.abs(s.vx - 0.3) < 0.01, `vx after step 2: ${s.vx}`)
		step(r, cfg, [person('cam_1:0', 2, 3)])
		assert.ok(Math.abs(s.vx - 0.51) < 0.01, `vx after step 3: ${s.vx}`)
		assert.ok(Math.abs(r.hub.markers.get(1).x - 2.51) < 0.01, `x ${r.hub.markers.get(1).x}`)
	})

	it('replace: sticky track, re-acquire when the pinned key leaves, attached() follows', () => {
		const r = rig()
		r.hub.set({ id: 1, x: 0, y: 0, z: 0 })
		const cfg = cfgOf({ pin_mode: 'replace', pin_marker_id: 1 })
		const a = person('cam_1:0', 0, 3)
		const b = person('cam_1:1', 3, 6)
		step(r, cfg, [a, b])
		const big = [a, b].reduce((p, q) => (area(q.box) > area(p.box) ? q : p))
		const other = big === a ? b : a
		assert.equal(r.pin.pinnedKey, big.key, 'cold start picks the largest box')
		assert.deepEqual(r.pin.attached(), { [big.key]: 1 })
		step(r, cfg, [other])
		assert.equal(r.pin.pinnedKey, other.key, 'pinned key left the frame, so the pin switches')
		assert.deepEqual(r.pin.attached(), { [other.key]: 1 })
	})

	it('replace: nobody in frame holds status 0 and the position; mode off releases to 1', () => {
		const r = rig()
		r.hub.set({ id: 1, x: 0, y: 0, z: 0 })
		const cfg = cfgOf({ pin_mode: 'replace', pin_marker_id: 1 })
		step(r, cfg, [person('cam_1:0', 2, 3)])
		const { x, y } = r.hub.markers.get(1)
		step(r, cfg, [])
		const held = r.hub.markers.get(1)
		assert.equal(held.status, 0)
		assert.equal(held.x, x)
		assert.equal(held.y, y)
		step(r, cfgOf({ pin_mode: 'off', pin_marker_id: 1 }), [])
		assert.equal(r.hub.markers.get(1).status, 1)
	})

	it('replace: the pin owns the marker (drives) and keeps it fresh while nobody is tracked', () => {
		const r = rig()
		r.hub.set({ id: 1, x: 0, y: 0, z: 0 })
		const cfg = cfgOf({ pin_mode: 'replace', pin_marker_id: 1 })
		assert.equal(r.pin.drives(1), false)
		step(r, cfg, [person('cam_1:0', 2, 3)])
		assert.equal(r.pin.drives(1), true)
		r.t.ms += 5000 // far past MARKER_STALE_AFTER_MS with nobody in frame
		step(r, cfg, [])
		assert.equal(r.pin.drives(1), true)
		assert.equal(r.hub.list(r.t.ms)[0].stale, false)
		assert.equal(r.hub.markers.get(1).source, 'detect')
		step(r, cfg, [], false)
		assert.equal(r.pin.drives(1), false, 'sidecar down: operator writes go through again')
	})

	it('replace: sidecar unavailable releases to status 1 and holds the position', () => {
		const r = rig()
		r.hub.set({ id: 1, x: 0, y: 0, z: 0 })
		const cfg = cfgOf({ pin_mode: 'replace', pin_marker_id: 1 })
		step(r, cfg, [person('cam_1:0', 2, 3)])
		const { x, y } = r.hub.markers.get(1)
		step(r, cfg, [person('cam_1:0', 5, 5)], false)
		const m = r.hub.markers.get(1)
		assert.equal(m.status, 1)
		assert.equal(m.x, x)
		assert.equal(m.y, y)
	})

	it('replace: a missing marker is a no-op (no throw, no marker created)', () => {
		const r = rig()
		step(r, cfgOf({ pin_mode: 'replace', pin_marker_id: 7 }), [person('cam_1:0', 2, 3)])
		assert.equal(r.hub.markers.has(7), false)
		assert.equal(r.pin.states.size, 0)
	})

	it('assist: the marker clips onto a person inside the radius', () => {
		const r = assistRig()
		step(r, r.cfg, [person('cam_1:0', 0.5, 3)])
		const m = r.hub.markers.get(1)
		assert.ok(Math.abs(m.x - 0.5) < 0.02 && Math.abs(m.y - 3) < 0.02, `at ${m.x}, ${m.y}`)
		assert.deepEqual(r.pin.attached(), { 'cam_1:0': 1 })
	})

	it('assist: strength 0.5 eases the marker halfway toward the person', () => {
		const r = assistRig({ assist_strength: 0.5 })
		step(r, r.cfg, [person('cam_1:0', 0.5, 3)])
		const m = r.hub.markers.get(1)
		assert.ok(Math.abs(m.x - 0.25) < 0.02 && Math.abs(m.y - 3) < 0.02, `at ${m.x}, ${m.y}`)
	})

	it('assist: glides, never snaps, and settles on the person', () => {
		const r = assistRig({ smoothing: 0.15 })
		const p = [person('cam_1:0', 0.5, 3)]
		step(r, r.cfg, p)
		const first = r.hub.markers.get(1).x
		assert.ok(first > 0 && first < 0.5, `first frame ${first}`)
		for (let i = 0; i < 199; i++) step(r, r.cfg, p)
		assert.ok(Math.abs(r.hub.markers.get(1).x - 0.5) < 0.02, `after 200 frames ${r.hub.markers.get(1).x}`)
	})

	it('assist: a person outside the radius leaves the marker at the anchor', () => {
		const r = assistRig()
		step(r, r.cfg, [person('cam_1:0', 3, 3)])
		const m = r.hub.markers.get(1)
		assert.ok(Math.abs(m.x) < 0.02 && Math.abs(m.y - 3) < 0.02, `at ${m.x}, ${m.y}`)
		assert.deepEqual(r.pin.attached(), {})
	})

	it('assist: an anchor nobody refreshed for 1 s stops being driven', () => {
		const r = assistRig()
		const at0 = r.hub.markers.get(1).at
		r.t.ms += 1500
		step(r, r.cfg, [person('cam_1:0', 0.5, 3)])
		assert.equal(r.pin.anchors.size, 0)
		assert.equal(r.hub.markers.get(1).at, at0, 'marker is no longer written')
		assert.equal(r.hub.markers.get(1).x, 0)
	})

	it('assist: output z follows the anchor z', () => {
		const r = rig()
		r.hub.set({ id: 1, x: 0, y: 3, z: 0 })
		r.pin.setAnchor({ id: 1, x: 0, y: 3, z: 1.2 }, r.t.ms)
		step(r, cfgOf({ pin_mode: 'assist', smoothing: 1, prediction: 0, assist_strength: 1, assist_radius_m: 1 }), [
			person('cam_1:0', 0.5, 3),
		])
		assert.equal(r.hub.markers.get(1).z, 1.2)
	})

	it('mode off clears the anchors', () => {
		const r = assistRig()
		assert.equal(r.pin.anchors.size, 1)
		step(r, cfgOf({ pin_mode: 'off' }), [])
		assert.equal(r.pin.anchors.size, 0)
	})
})

describe('WO-616 T10b pin on world persons', () => {
	/** A fused world person: no box, no camEntry; `world` is the floor point, `area` the largest member box. */
	const wperson = (tid, x, y, a, extra) => ({
		key: `w:${tid}`,
		camera: 'world',
		tid,
		world: [x, y],
		score: 0.8,
		age_s: 0,
		area: a,
		...extra,
	})

	it('replace: a fresh pick takes the largest world person and drives the marker onto its x/y', () => {
		const r = rig()
		r.hub.set({ id: 1, x: 0, y: 0, z: 0 })
		const cfg = cfgOf({ pin_mode: 'replace', pin_marker_id: 1, smoothing: 1, prediction: 0 })
		const small = wperson(1, 2, 3, 0.02)
		const large = wperson(2, 5, 6, 0.05)
		for (let i = 0; i < 5; i++) step(r, cfg, [small, large])
		assert.deepEqual(r.pin.attached(), { 'w:2': 1 })
		const m = r.hub.markers.get(1)
		assert.ok(Math.abs(m.x - 5) < 0.01 && Math.abs(m.y - 6) < 0.01, `at ${m.x}, ${m.y}`)
	})

	it('replace: sticky, a larger world person appearing later does not steal the pin', () => {
		const r = rig()
		r.hub.set({ id: 1, x: 0, y: 0, z: 0 })
		const cfg = cfgOf({ pin_mode: 'replace', pin_marker_id: 1 })
		const a = wperson(1, 0, 3, 0.02)
		const b = wperson(2, 3, 6, 0.05)
		step(r, cfg, [a])
		step(r, cfg, [a, b])
		assert.equal(r.pin.pinnedKey, 'w:1')
		assert.deepEqual(r.pin.attached(), { 'w:1': 1 })
	})

	it('replace: re-acquire takes a new key 0.5 m from the last point over a larger one 3 m away', () => {
		const r = rig()
		r.hub.set({ id: 1, x: 0, y: 0, z: 0 })
		const cfg = cfgOf({ pin_mode: 'replace', pin_marker_id: 1 })
		step(r, cfg, [wperson(1, 0, 3, 0.02)])
		step(r, cfg, [wperson(3, 0.5, 3, 0.01), wperson(4, 0, 6, 0.05)])
		assert.equal(r.pin.pinnedKey, 'w:3')
		assert.deepEqual(r.pin.attached(), { 'w:3': 1 })
	})

	it('replace: re-acquire rejects a new key 1.0 m away, so the larger one 3 m away wins', () => {
		const r = rig()
		r.hub.set({ id: 1, x: 0, y: 0, z: 0 })
		const cfg = cfgOf({ pin_mode: 'replace', pin_marker_id: 1 })
		step(r, cfg, [wperson(1, 0, 3, 0.02)])
		step(r, cfg, [wperson(3, 1, 3, 0.01), wperson(4, 0, 6, 0.05)])
		assert.equal(r.pin.pinnedKey, 'w:4')
		assert.deepEqual(r.pin.attached(), { 'w:4': 1 })
	})

	it('replace: pin_point top keeps the marker z and takes the world x/y', () => {
		const r = rig()
		r.hub.set({ id: 1, x: 0, y: 0, z: 1.5 })
		const cfg = cfgOf({ pin_mode: 'replace', pin_marker_id: 1, pin_point: 'top', smoothing: 1, prediction: 0 })
		step(r, cfg, [wperson(1, 2, 3, 0.02)])
		const m = r.hub.markers.get(1)
		assert.ok(Math.abs(m.x - 2) < 0.01 && Math.abs(m.y - 3) < 0.01, `at ${m.x}, ${m.y}`)
		assert.equal(m.z, 1.5)
	})

	it('assist: an anchor near a world person is pulled toward its x/y by assist_strength', () => {
		const r = assistRig({ assist_strength: 0.5 })
		step(r, r.cfg, [wperson(1, 0.5, 3, 0.02)])
		const m = r.hub.markers.get(1)
		assert.ok(Math.abs(m.x - 0.25) < 0.02 && Math.abs(m.y - 3) < 0.02, `at ${m.x}, ${m.y}`)
		assert.deepEqual(r.pin.attached(), { 'w:1': 1 })
	})

	it('replace: a coasting world person (age_s > 0) is not freshly picked when nothing is pinned', () => {
		const r = rig()
		r.hub.set({ id: 1, x: 0, y: 0, z: 0 })
		const cfg = cfgOf({ pin_mode: 'replace', pin_marker_id: 1 })
		step(r, cfg, [wperson(1, 2, 3, 0.05, { age_s: 0.1 })])
		assert.equal(r.pin.pinnedKey, null)
		assert.deepEqual(r.pin.attached(), {})
		assert.equal(r.hub.markers.get(1).status, 0)
	})
})
