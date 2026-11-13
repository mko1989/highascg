'use strict'

/**
 * WO-1070 — APC40 pad banks and the whole visuals library on the pads by dominant colour. The behaviour is tested in
 * Godot (godot/client/tests/test_visuals_pad_banks.gd); this pins the wiring: ▲ / ▼ in the APC map, a stored map
 * gaining them, the menu action, and the old [midi] clips key left alone.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')

describe('WO-1070 APC40 pad banks + library by colour', () => {
	it('▲ / ▼ page the pads, also in a stored map', () => {
		const map = read('godot/client/features/midi/midi_map.gd')
		assert.match(map, /"num": 94, "target": "padbank:prev"/)
		assert.match(map, /"num": 95, "target": "padbank:next"/)
		assert.match(map, /const BUTTONS := \[[^\]]*"padbank"\]/)
		assert.match(read('godot/client/features/visuals/visuals_midi.gd'), /with_new_defaults\([^\n]*"padbank"\]\)/)
	})
	it('the pads are banks; the pre-bank pads are read as bank 1 and never overwritten', () => {
		const clips = read('godot/client/features/visuals/visuals_midi_clips.gd')
		assert.match(clips, /var banks := \[\{"name": "", "auto": false, "clips": \{\}\}\]/)
		assert.match(clips, /banks\.append\(\{"name": "", "auto": false, "clips": _clips_of\(c\.get_value\(midi\.SECTION, KEY, \{\}\)\)\}\)/)
		assert.ok(!/save_value\(midi\.SECTION, KEY,/.test(clips), 'the old clips key is not written')
		assert.match(clips, /banks = banks\.filter\(func\(b: Dictionary\) -> bool: return not b\.get\("auto", false\)/)
	})
	it('the fill: every library row, missing thumbnails rendered first, 40 to a bank in hue order', () => {
		const lib = read('godot/client/features/visuals/visuals_midi_library.gd')
		assert.match(lib, /const PER_BANK := 40/)
		assert.match(lib, /await panel\.library_rows\(\)/)
		assert.match(lib, /thumbs\.request\(r\.thumb, r\.payload\)/)
		assert.match(lib, /var all := coloured \+ grey \+ plain/)
		assert.match(read('godot/client/features/visuals/visuals_midi.gd'), /MidiPanel\.MENU_PADS:[^\n]*\n[^\n]*visuals_midi_library\.gd"\)\.fill\(self\)/)
		assert.match(read('godot/client/features/midi/midi_panel.gd'), /pm\.add_item\("Pads: the whole library, by colour/)
	})
	it('the colour is the dominant hue, not the mean', () => {
		assert.match(read('godot/client/features/midi/apc40_palette.gd'), /var near := ws\[i\] \+ ws\[\(i \+ 1\) % BINS\] \+ ws\[\(i \+ BINS - 1\) % BINS\]/)
	})
})
