'use strict'

/**
 * WO-798 — the Godot client's idle CPU on the Live tab. With Times on, every OSC tick (~25 Hz) redrew the whole
 * compose windows (compose_tiles.gd _draw), which shaped a fresh "✕" TextLine per window. The glyph is not in the UI
 * font, so each shape walked the system-font fallback (~1.3 ms): 4 windows × ~20 redraws/s ≈ 11 % of a core.
 * The OSC tick now repaints only the Times overlay, and the ✕ is shaped once. Pinned by source text.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const read = (rel) => fs.readFileSync(path.join(__dirname, '../../godot/client', rel), 'utf8')

test('an OSC tick repaints only the Times overlay, not the windows', () => {
	const p = read('features/live/live_preview.gd')
	assert.match(p, /osc\.updated\.connect\(func\(\) -> void:\n\t\tif tiles\.times and tiles\.is_visible_in_tree\(\):\n\t\t\ttiles\.redraw_times\(\)\)/)
	assert.match(read('features/live/compose_tiles.gd'), /^func redraw_times\(\) -> void:\n\tif _over != null:\n\t\t_over\.queue_redraw\(\)/m)
})

test('the label strip ✕ is shaped once, not per draw', () => {
	const t = read('features/live/compose_tiles.gd')
	assert.match(t, /var x := _close_glyph\(font\)/)
	assert.strictEqual((t.match(/add_string\("✕"/g) || []).length, 1, 'one shaping site')
	assert.match(t, /if _x_line == null or _x_font != font:/)
})
