'use strict'
/**
 * WO-909: the APC40 profile — the Visuals' "Controller" mode draws the unit with what every control does now, the device
 * knobs follow the selected layer (dev:1–8) and the track select buttons pick it. Behaviour is proven by
 * godot/client/tests/test_visuals_apc.gd; these pin the hook lines a refactor could drop.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const feat = path.join(__dirname, '..', '..', 'godot', 'client', 'features')
const read = (f) => fs.readFileSync(path.join(feat, f), 'utf8')

describe('WO-909 APC40 profile', () => {
	it('the Visuals MIDI controller adds the Controller mode and feeds it every message', () => {
		const v = read('visuals/visuals_midi.gd')
		assert.match(v, /tab\.work\.add_mode\("controller", "Controller", apc_view\.surface, Apc\.HINT\)/)
		assert.match(v, /apc_view\.surface\.touch\(msg\)/)
	})
	it('the APC40 map drives the device knobs and track select through the auto page', () => {
		const mm = read('midi/midi_map.gd')
		assert.match(mm, /"num": 16 \+ i, "target": "dev:%d" % \(i \+ 1\)/)
		assert.match(mm, /"num": 51, "target": "select:%d" % \(t \+ 1\)/)
	})
	it('the device page takes a shader layer\'s key controls', () => {
		assert.match(read('visuals/visuals_midi_apc.gd'), /for k in sm\.key_controls\(\):/)
		assert.match(read('visuals/visuals_shader_mode.gd'), /func key_controls\(\) -> Array:/)
	})
	it('a waiting control becomes live when the app value comes to it', () => {
		assert.match(read('midi/midi_pickup.gd'), /elif not st\.live and float\(st\.hw\) >= 0\.0 and absf\(float\(st\.hw\) - app\) <= tol:/)
	})
})
