'use strict'
/**
 * WO-908: A/B banks for the Visuals — both mixer decks stay on stage in DJ mode (the idle deck is not cleared), looks go
 * to the PRV bank first, the autopilot / a running playlist take it, and the APC40 crossfader drives the banks. The
 * behaviour is proven by godot/client/tests/test_visuals_dj.gd; these pin the hook lines a refactor could drop.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const vis = path.join(__dirname, '..', '..', 'godot', 'client', 'features', 'visuals')
const read = (f) => fs.readFileSync(path.join(vis, f), 'utf8')

describe('WO-908 Visuals A/B banks', () => {
	it('the mixer keeps both decks on stage in DJ mode', () => {
		const m = read('visuals_mixer.gd')
		assert.match(m, /var shows := running and \(dj or i == live or fading\(\)\)/)
		assert.match(m, /if not dj and i != live and not fading\(\):/)
	})
	it('the tab loads the banks before its stack and evaluates the other bank every frame', () => {
		const t = read('visuals_tab.gd')
		assert.match(t, /dj\.from_slice\(\)\n\t_go\(false\)/)
		assert.match(t, /dj\.step\(buses, delta\)/)
	})
	it('a look goes to PRV; the autopilot and a running playlist take it', () => {
		const s = read('visuals_show_ctl.gd')
		assert.match(s, /tab\.dj\.to_prv\(\)/)
		assert.match(s, /recall\(next, true\)/)
		const p = read('visuals_playlist_ctl.gd')
		assert.match(p, /tab\.dj\.to_prv\(\)/)
		assert.match(p, /_show\(P\.current\(running\(\)\), true\)/)
	})
	it('the APC40 crossfader (CC 15) drives the banks', () => {
		const mm = fs.readFileSync(path.join(vis, '..', 'midi', 'midi_map.gd'), 'utf8')
		assert.match(mm, /"num": 15, "target": "xfade"/)
	})
})
