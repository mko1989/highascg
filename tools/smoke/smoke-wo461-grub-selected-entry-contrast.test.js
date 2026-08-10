'use strict'

/**
 * WO-461 — the highlighted GRUB entry was invisible.
 *
 * GRUB's gfxmenu `boot_menu` component has NO background-colour properties. `menu_bg_color`
 * and `selected_item_bg_color` are not part of its property set (gui_list.c accepts only
 * *_pixmap_style for backgrounds) and are parsed as unknown → silently ignored. The theme was
 * written as if they worked: dark text (`selected_item_color = "#0c1220"`) on an assumed blue
 * bar. With no bar, that is desktop-color on desktop-color — the selected entry vanished.
 *
 * Selection is therefore carried by TEXT COLOUR ALONE, and that is what these tests pin.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const THEME = 'tools/eggs/live-usb/highascg-eggs-theme/theme/livecd/grub.theme.cfg'
const VERIFIER = 'tools/eggs/live-usb/verify-iso-boot-branding.sh'
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const val = (src, re) => (src.match(re) || [])[1]?.trim().toLowerCase()
const desktop = (src) => val(src, /^desktop-color:\s*"([^"]+)"/m)
const selected = (src) => val(src, /^\s*selected_item_color\s*=\s*"([^"]+)"/m)
const item = (src) => val(src, /^\s*item_color\s*=\s*"([^"]+)"/m)

/** Relative luminance of #rrggbb, 0..1 (WCAG-ish, no gamma — enough to catch "same dark"). */
function luminance(hex) {
	const m = /^#([0-9a-f]{6})$/.exec(hex)
	assert.ok(m, `expected #rrggbb, got ${hex}`)
	const n = parseInt(m[1], 16)
	return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
}

describe('WO-461 GRUB selected entry contrast', () => {
	const src = read(THEME)

	it('selected entry is not painted in the desktop colour', () => {
		assert.notEqual(selected(src), desktop(src), 'this is the exact bug that shipped — invisible highlight')
	})

	it('selected and unselected entries are different colours', () => {
		assert.notEqual(selected(src), item(src), 'selection must be visible as a change')
	})

	it('the selected entry is clearly brighter than both the desktop and the idle items', () => {
		const [d, s, i] = [desktop(src), selected(src), item(src)].map(luminance)
		assert.ok(s - d > 0.4, `selected vs desktop luminance gap too small (${(s - d).toFixed(2)})`)
		assert.ok(s - i > 0.2, `selected vs idle-item luminance gap too small (${(s - i).toFixed(2)})`)
	})

	it('the phantom background properties are not assigned, only documented as ignored', () => {
		// Mentions in comments are wanted — assignments are the bug.
		const assigned = /^\s*(menu_bg_color|selected_item_bg_color)\s*=/m
		assert.ok(!assigned.test(src), 'GRUB ignores these — assigning them implies a highlight that never renders')
		assert.match(src, /NO colour property for backgrounds/, 'keep the note so nobody re-adds them')
	})

	it('the ISO verifier fails an invisible highlight instead of rewarding menu_bg_color', () => {
		const v = read(VERIFIER)
		assert.match(v, /equals desktop-color — highlighted entry is INVISIBLE/)
		// Must match assignments only, or the theme's own warning comment fails a good ISO.
		assert.match(v, /\^\[\[:space:\]\]\*\(menu_bg_color\|selected_item_bg_color\)\[\[:space:\]\]\*=/)
		assert.ok(
			!/ok "theme\.cfg sets boot_menu menu_bg_color/.test(v),
			'the old check passed the broken ISO — it must be gone'
		)
	})
})
