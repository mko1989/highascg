'use strict'

/**
 * WO-1065 — the game window gives each connected gamepad its own libretro port (players 1–4); it used to read only
 * the first pad into port 0. The assignment itself is tested in Godot (godot/retro/tests/test_keys.gd); this pins the
 * wiring and that the host carries four ports.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')

describe('WO-1065 four gamepads in the game window', () => {
	const win = read('godot/retro/retro_window.gd')
	it('every port polls its own gamepad', () => {
		assert.match(win, /Keys\.assign_ports\(_pad_ports, Input\.get_connected_joypads\(\)\)/)
		assert.match(win, /for port in Keys\.PORTS:\n\t\tvar now: Dictionary = Keys\.pad_state\(_pad_ports\[port\]\)/)
		assert.match(win, /host\.set_button\(port, id, now\.has\(id\) or \(port == 0 and _keys_down\.has\(id\)\)\)/)
		assert.ok(!/pads\[0\]/.test(win), 'no "first pad only"')
	})
	it('the keyboard stays player 1', () => {
		assert.match(win, /host\.set_button\(0, id, k\.pressed or _pad_down\[0\]\.has\(id\)\)/)
	})
	it('the host and the helper agree on four ports', () => {
		assert.match(read('godot/retro/retro_keys.gd'), /const PORTS := 4/)
		assert.match(read('godot/extensions/hshm/src/retro/retro_host.h'), /buttons_\[4\]/)
		assert.match(read('godot/extensions/hshm/src/retro/retro_host.cpp'), /port < 0 \|\| port > 3/)
	})
})
