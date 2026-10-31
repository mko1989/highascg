'use strict'

/**
 * WO-789 — owner 27.10: "the preview in timeline should be the same as in live with the option to change to 3d etc."
 * One Live preview (live_preview.gd: operator picture + compose windows, 2D / 3D, Fit, Lights, Times, Auto, the
 * tracking overlay) made by the Live tab and borrowed by the Timeline tab while shown. A second copy would build the
 * 3D stage twice and its Auto would re-tile the one server layout against the first. Pinned by source text.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const read = (rel) => fs.readFileSync(path.join(__dirname, '../../godot/client', rel), 'utf8')

test('one preview: only the Live tab makes it, the Timeline tab hosts LivePreview.current', () => {
	const hits = ['features/live/live_tab.gd', 'features/timeline/timeline_tab.gd'].filter((f) =>
		/LivePreview\.new\(\)/.test(read(f))
	)
	assert.deepStrictEqual(hits, ['features/live/live_tab.gd'])
	const tl = read('features/timeline/timeline_tab.gd')
	assert.match(
		tl,
		/if is_visible_in_tree\(\) and is_instance_valid\(LivePreview\.current\) and not LivePreview\.current\.home_shown\(\):\n\t\tLivePreview\.current\.host\(preview_slot\)/ // WO-891: Live tab shown on the other monitor keeps it
	)
	assert.match(tl, /visibility_changed\.connect\(_borrow_preview\)/)
	assert.doesNotMatch(tl, /timeline_monitor/)
	assert.match(read('features/live/live_tab.gd'), /if is_visible_in_tree\(\):\n\t\t\tpreview\.host\(_video_panel\)\)/)
})

test('the preview carries the Live controls and re-syncs after a move', () => {
	const p = read('features/live/live_preview.gd')
	for (const k of ['3d', 'fit', 'lights', 'times', 'auto']) assert.match(p, new RegExp(`_view_btns\\["${k}"\\] = `), k)
	assert.match(p, /static var current: Node/)
	assert.match(p, /reparent\(slot, false\)/)
	assert.match(p, /_hold_surface\(\)\n\tstage3d\.sync_shown\(\)/)
	assert.match(read('features/live/live_stage_3d.gd'), /^func sync_shown\(\) -> void:/m)
	assert.ok(!fs.existsSync(path.join(__dirname, '../../godot/client/features/timeline/timeline_monitor.gd')))
})
