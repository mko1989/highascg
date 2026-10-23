'use strict'
/**
 * WO-700 — calibrate a head from Previs → Lighting → Calibrate heads on stage marks (real floor spots,
 * project.fixtures.marks): "Beam is on <mark>" sends the mark's position as the calibrate `at` point (WO-630 path,
 * smoke-wo630). The session's output_enabled is now the head's own universe — a DMX-master head moves while the
 * follow output is off, and the summary must not say it will not.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { FollowEngine } = require('../../src/fixtures/follow-engine')
const { MarkerHub } = require('../../src/tracking/marker-hub')
const { createCalibration } = require('../../src/fixtures/calibrate-session')

const GD = (rel) => fs.readFileSync(path.join(__dirname, '../../godot/client', rel), 'utf8')

describe('WO-700 calibrate heads from Lighting', () => {
	function rig(dmxOn) {
		const t = { ms: 1000 }
		const hub = new MarkerHub({ now: () => t.ms })
		const engine = new FollowEngine({ hub, now: () => t.ms, send: () => {} })
		engine.configure({
			output: { enabled: false, protocol: 'artnet' },
			dmx: { enabled: dmxOn, universes: ['artnet:3'] },
			patch: [{ id: 'fx1', name: 'Spot L', universe: 3, address: 1, dest: '10.0.0.50', pose: { x: 0, y: 0, z: 6, hang: 'truss' } }],
		})
		engine.tick()
		return { engine, cal: createCalibration({ engine, hub }) }
	}

	it('output_enabled follows the head universe (DMX master), not only the follow output', () => {
		const on = rig(true)
		assert.equal(on.engine.isLive(on.engine.fixtures[0]), true)
		assert.equal(on.cal.handle({ action: 'start', id: 'fx1' }).body.output_enabled, true)
		const off = rig(false)
		assert.equal(off.cal.handle({ action: 'start', id: 'fx1' }).body.output_enabled, false)
	})

	it('a stage mark is a calibrate point at its position', () => {
		const { cal } = rig(true)
		cal.handle({ action: 'start', id: 'fx1' })
		const r = cal.handle({ action: 'point', id: 'fx1', at: [1.5, 2.36, 0] })
		assert.equal(r.status, 200)
		assert.deepEqual([r.body.points[0].x, r.body.points[0].y, r.body.points[0].z], [1.5, 2.36, 0])
	})

	it('the Lighting fold wires marks, the floor pick and the session (source pins)', () => {
		const fold = GD('features/previs/fixtures/calibrate_fold.gd')
		assert.match(fold, /_calib\.camera_tools = false/)
		assert.match(fold, /_calib\.add_floor_point\(\[m\.x, m\.y, m\.z\]\)/)
		assert.match(fold, /sel\.floor_picked\.connect\(_add_mark\)/)
		assert.match(fold, /s\.patch\[i\] = F\.apply_solve\(s\.patch\[i\], solve\)/)
		assert.match(GD('features/previs/fixtures/fixtures_section.gd'), /Fold\.new\("Calibrate heads", \[CalibrateFold\.new\(\)\]\)/)
		assert.match(GD('features/previs/fixtures/fixtures_3d.gd'), /if sel\.mark_pick: {2}# WO-700/)
		assert.match(GD('features/previs/previs_tab.gd'), /stage\.add_child\(preload\("res:\/\/features\/previs\/fixtures\/calib_marks_3d\.gd"\)\.new\(\)\)/)
		assert.match(GD('features/previs/tracking/follow_model.gd'), /"marks": normalize_marks\(s\.get\("marks"\)\)/)
	})
})
