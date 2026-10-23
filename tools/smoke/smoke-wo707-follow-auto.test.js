'use strict'
/**
 * WO-707 — Follow → Auto (owner 23.10: "there is follow none in the follow inspector, with no other options,
 * especialy for dev we need an auto"). auto-follow.js keeps its own marker (AUTO_MARKER_ID) on the detected person
 * while detection is on and a head follows it; it leaves the hub otherwise. The operator's pin is untouched.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { MarkerHub } = require('../../src/tracking/marker-hub')
const { DetectPin } = require('../../src/tracking/detect-pin')
const { normalizeDetection } = require('../../src/tracking/detect-model')
const { createAutoFollow, AUTO_MARKER_ID } = require('../../src/tracking/auto-follow')

const person = (x, y, id = 1) => ({
	key: `w:${id}`,
	camera: 'world',
	tid: id,
	world: [x, y],
	score: 0.9,
	age_s: 0,
	area: 5000,
})

function rig(cfgOver = {}) {
	let t = 1000
	const hub = new MarkerHub({ now: () => t })
	const auto = createAutoFollow()
	const cfg = normalizeDetection({ enabled: true, pin_mode: 'assist', smoothing: 1, prediction: 0, ...cfgOver })
	const step = (persons, wanted = true, c = cfg) => {
		t += 50
		auto.step({ cfg: c, wanted, available: true, persons, hub, planeZ: 0, now: t, dt: 0.05 })
		return hub.list(t).find((m) => m.id === AUTO_MARKER_ID)
	}
	return { hub, auto, cfg, step }
}

describe('WO-707 Follow → Auto', () => {
	it('no setup: the Auto marker appears on the detected person and follows them', () => {
		const { step } = rig()
		let m = step([person(2, 3)])
		for (let i = 0; i < 20; i++) m = step([person(2, 3)])
		assert.ok(m, 'Auto marker in the hub')
		assert.equal(m.name, 'Auto — tracked person')
		assert.ok(Math.hypot(m.x - 2, m.y - 3) < 0.05, `on the person (${m.x}, ${m.y})`)
		assert.ok(m.status > 0 && !m.stale)
		for (let i = 0; i < 40; i++) m = step([person(-1.5, 4)])
		assert.ok(Math.hypot(m.x + 1.5, m.y - 4) < 0.05, `walked with them (${m.x}, ${m.y})`)
	})

	it('before anyone is seen there is no Auto marker (heads hold, no swing to the seed point)', () => {
		const { step } = rig()
		assert.equal(step([]), undefined)
		assert.equal(step([]), undefined)
		assert.ok(step([person(1, 1)]), 'appears with the first person')
	})

	it('nobody in view: holds where they were, flagged invalid', () => {
		const { step } = rig()
		for (let i = 0; i < 20; i++) step([person(1, 2)])
		const m = step([])
		assert.ok(Math.hypot(m.x - 1, m.y - 2) < 0.05)
		assert.equal(m.status, 0)
	})

	it('no head on Auto, or detection off: the marker leaves the hub', () => {
		const { step, cfg } = rig()
		assert.ok(step([person(1, 1)]))
		assert.equal(step([person(1, 1)], false), undefined, 'nobody follows Auto')
		assert.ok(step([person(1, 1)]))
		assert.equal(step([person(1, 1)], true, { ...cfg, enabled: false }), undefined, 'detection off')
	})

	it("the operator's own pin and markers are untouched (Assist mode, marker 1)", () => {
		const { hub, step } = rig()
		hub.set({ id: 1, name: 'Marker 1', x: 0, y: 0, z: 0, source: 'operator' })
		const opPin = new DetectPin()
		for (let i = 0; i < 10; i++) step([person(3, 3)])
		assert.equal(opPin.attached()['w:1'], undefined)
		const m1 = hub.markers.get(1)
		assert.deepEqual([m1.x, m1.y, m1.source], [0, 0, 'operator'])
	})

	it('wiring: register runs it for heads following Auto; the Follow list offers it', () => {
		const reg = fs.readFileSync(path.join(__dirname, '../../src/tracking/register.js'), 'utf8')
		// WO-708: the multi-person director (auto-director.js) now owns the step and works out the Auto pool itself.
		assert.match(reg, /const fixtures = duties\.has\('auto'\) \? _follow\?\.engine\?\.fixtures \|\| \[\] : \[\]/)
		assert.match(
			reg,
			/auto\.step\(\{ cfg, available: _detect\.available, persons, hub, planeZ: _detect\.planeZ, now, dt, fixtures \}\)/
		)
		const dir = fs.readFileSync(path.join(__dirname, '../../src/tracking/auto-director.js'), 'utf8')
		assert.match(dir, /pool = \(fixtures \|\| \[\]\)\.filter\(\(f\) => f\.follow === AUTO_MARKER_ID\)/)
		const gd = (rel) => fs.readFileSync(path.join(__dirname, '../../godot/client/features/previs/tracking', rel), 'utf8')
		assert.match(gd('follow_model.gd'), new RegExp(`const AUTO_MARKER := ${AUTO_MARKER_ID}\\n`))
		assert.match(gd('follow_section.gd'), /_follow\.add_item\("Auto — the tracked person", F\.AUTO_MARKER\)/)
	})
})
