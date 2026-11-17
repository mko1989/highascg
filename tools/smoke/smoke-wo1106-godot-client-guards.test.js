'use strict'

/**
 * WO-1106 (godot-client slice) — the fixes whose GDScript cannot load in the headless Godot runner (they use the Api /
 * Ws autoloads), pinned on their source: B31 one request in flight per poller (LTC no longer polls HTTP at 4 Hz on top
 * of its WS push), B28 the tracking view's black check only while visible, C3 typed capture names survive a rebuild
 * and the Save await checks its row, C4 the presenter photo cache shrinks and keeps thumb-sized pictures, C6 "Take
 * pictures" is disabled while it runs. The behaviour of the other rows is tested in godot/client/tests/*wo1106*.gd and
 * the extended suites.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const GC = path.join(__dirname, '../../godot/client')
const read = (p) => fs.readFileSync(path.join(GC, p), 'utf8')
/** The body of `func <name>(` up to the next top-level func. */
const body = (src, name) => {
	const at = src.indexOf(`func ${name}(`)
	assert.ok(at >= 0, `func ${name} exists`)
	const next = src.indexOf('\nfunc ', at + 1)
	const nextStatic = src.indexOf('\nstatic func ', at + 1)
	const ends = [next, nextStatic].filter((n) => n > 0)
	return src.slice(at, ends.length ? Math.min(...ends) : undefined)
}

describe('WO-1106 godot-client guards', () => {
	it('B31: LTC — WS first, HTTP only while the push is silent, one GET at a time', () => {
		const s = read('features/audio/ltc_fold.gd')
		assert.match(s, /Ws\.on\("ltc\.status", _on_ws\)/)
		assert.ok(!/wait_time = 0\.25/.test(s), 'the 0.25 s HTTP poll is gone')
		assert.match(body(s, '_poll'), /Time\.get_ticks_msec\(\) - _ws_ms > WS_FRESH_MS/)
		const f = body(s, '_fetch_status')
		assert.match(f, /if _fetching:\n\t\treturn\n\t_fetching = true\n\tvar r: Dictionary = await Api\.get_json\("\/api\/ltc"\)\n\t_fetching = false/)
	})
	it('B31: controllers + detection runtime polls keep one request in flight', () => {
		const c = body(read('features/settings/controllers_pane.gd'), 'refresh')
		assert.match(c, /if _fetching:\n\t\t_again = true\n\t\treturn/)
		assert.match(c, /_fetching = false[\s\S]*if _again:\n\t\t_again = false\n\t\trefresh\(\)/)
		const r = body(read('features/previs/tracking/runtime_section.gd'), '_on_poll')
		assert.match(r, /if _polling:[^\n]*\n\t\treturn\n\t_polling = true\n\tvar r: Dictionary = await Api\.get_json\(_url\("", "only=job"\)\)\n\t_polling = false/)
	})
	it('B28: the full-frame black check runs only for a view on screen', () => {
		const s = body(read('features/previs/tracking/tracking_view.gd'), '_process')
		assert.match(s, /if _black_t <= 0\.0 and ghost_on and is_visible_in_tree\(\):/)
	})
	it('C3: typed capture name / mic survive a rebuild; the Save await checks its row', () => {
		const s = read('features/previs/tracking/presenters_section.gd')
		const row = body(s, '_capture_row')
		assert.match(row, /var typed: Dictionary = _typed\.get\(cid, \{\}\)/)
		assert.match(row, /name_e\.text = str\(typed\.get\("name", ""\)\)/)
		assert.match(row, /mic_e\.text = str\(typed\.get\("mic", ""\)\)/)
		assert.match(row, /name_e\.text_changed\.connect\(func\(v: String\) -> void: _keep_typed\(cid, "name", v\)\)/)
		assert.match(row, /await Api\.post_json[^\n]*\n[^\n]*\n\t\tif is_instance_valid\(name_e\):[^\n]*\n\t\t\tname_e\.release_focus\(\)/)
		assert.match(body(s, '_render'), /for k in _typed\.keys\(\):[^\n]*\n\t\tif not cids\.has\(k\):\n\t\t\t_typed\.erase\(k\)/)
	})
	it('C4: the photo cache keeps only what the last render shows, thumb-sized, one request per photo', () => {
		const s = read('features/previs/tracking/presenters_section.gd')
		const r = body(s, '_render')
		assert.match(r, /_photo_used = \{\}/)
		assert.match(r, /for k in _photos\.keys\(\):[^\n]*\n\t\tif not _photo_used\.has\(k\):\n\t\t\t_photos\.erase\(k\)/)
		const p = body(s, '_photo')
		assert.match(p, /_photo_used\[key\] = true/)
		assert.match(p, /if _photo_wait\.has\(key\):\n\t\t\(_photo_wait\[key\] as Array\)\.append\(into\)\n\t\treturn/)
		assert.match(p, /var fit := thumb_size\(img\.get_size\(\), THUMB \* 2\.0\)/)
		assert.match(p, /img\.resize\(fit\.x, fit\.y, Image\.INTERPOLATE_BILINEAR\)/)
		assert.match(s, /static func thumb_size\(px: Vector2i, box: Vector2\) -> Vector2i:/)
	})
	it('C6: "Take pictures" is disabled until its request returns', () => {
		const t = body(read('features/previs/tracking/presenters_section.gd'), '_take_pictures')
		assert.match(t, /if _take\.disabled:\n\t\treturn\n\t_take\.disabled = true/)
		assert.match(t, /await Api\.post_json\(BASE \+ "\/capture", \{\}\)\n\t_take\.disabled = false/)
	})
	it('the touched files stay within 500 lines', () => {
		for (const f of ['features/visuals/visuals_midi.gd', 'features/previs/tracking/presenters_section.gd', 'features/audio/ltc_fold.gd',
			'features/visuals/visuals_mixer.gd', 'features/visuals/visuals_dj.gd']) {
			assert.ok(read(f).split('\n').length <= 501, f)
		}
	})
})
