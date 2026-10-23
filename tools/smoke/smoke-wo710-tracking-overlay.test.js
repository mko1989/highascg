'use strict'
/**
 * WO-710 — the Auto tracking overlay is wired into the Live tab and the Previs main tab and talks to the WO-708/709
 * endpoints. Pinned by source text (Godot is not run here; the model has godot/client/tests/test_auto_overlay_model.gd).
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const client = path.join(__dirname, '../../godot/client')
const read = (rel) => fs.readFileSync(path.join(client, rel), 'utf8')
const OVERLAY = 'features/previs/tracking/auto_overlay.gd'

describe('WO-710 tracking overlay wiring', () => {
	it('both host views instance the overlay', () => {
		assert.match(read('features/live/live_tab.gd'), /AutoOverlay\.new\(\)/)
		assert.match(read('features/live/live_tab.gd'), /preload\("res:\/\/features\/previs\/tracking\/auto_overlay\.gd"\)/)
		assert.match(
			read('features/previs/previs_tab.gd'),
			/preload\("res:\/\/features\/previs\/tracking\/auto_overlay\.gd"\)\.new\(\)/
		)
	})

	it('the overlay uses the contract endpoints and the WS event', () => {
		const src = read(OVERLAY)
		for (const ep of [
			'/api/tracking/auto',
			'/api/tracking/auto/pin',
			'/api/tracking/auto/slot',
			'/api/tracking/auto/home',
		]) {
			assert.ok(src.includes(`"${ep}"`), ep)
		}
		assert.match(src, /"tracking:auto"/)
		assert.match(src, /"now": true/)
		assert.match(src, /"after_s"/)
		assert.match(src, /"slot": M\.pin_target/)
		assert.match(src, /"heads": n/)
		assert.match(src, /"ptz": next/)
	})

	it('buttons never take focus (arrow keys stay with the views)', () => {
		const src = read(OVERLAY)
		assert.equal((src.match(/Button\.new\(\)/g) || []).length, 1) // every button comes from _btn()
		assert.match(src, /b\.focus_mode = Control\.FOCUS_NONE/)
	})

	it('files stay under the 500-line limit', () => {
		for (const f of [
			OVERLAY,
			'features/previs/tracking/auto_overlay_model.gd',
			'features/previs/previs_tab.gd',
			'features/live/live_tab.gd',
		]) {
			assert.ok(read(f).split('\n').length <= 501, f)
		}
	})
})
