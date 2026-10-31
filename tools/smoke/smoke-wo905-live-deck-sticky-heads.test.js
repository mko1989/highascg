'use strict'
/**
 * WO-905: each screen's header bar on the Live deck stays visible while the deck scrolls — headers live in an overlay
 * above the columns, the column keeps a slot, and header gaps still act as the column (PRV clear, new-look drop).
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const dir = path.join(__dirname, '..', '..', 'godot', 'client', 'features', 'live')
const view = fs.readFileSync(path.join(dir, 'deck_view.gd'), 'utf8')
const sticky = fs.readFileSync(path.join(dir, 'deck_sticky_heads.gd'), 'utf8')

describe('WO-905 Live deck sticky screen headers', () => {
	it('the deck mounts the overlay, slots each header and follows the scroll', () => {
		assert.match(view, /_heads = StickyHeads\.mount\(self, _columns\)/)
		assert.match(
			view,
			/col\.add_child\(_heads\.slot\(head_row, col, _can_drop_new\.bind\(main\), _drop_new\.bind\(main\)\)\)/
		)
		assert.match(view, /\t_heads\.follow\(scroll_vertical\)/)
		assert.match(view, /\t_heads\.clear\(\)/)
	})
	it('a header is pinned at the scroll offset and its gaps act as the column', () => {
		assert.match(sticky, /panel\.position = Vector2\(at\.x, maxf\(at\.y, scroll_y\)\)/)
		assert.match(sticky, /panel\.gui_input\.connect\(func\(ev: InputEvent\) -> void: col\.gui_input\.emit\(ev\)\)/)
		assert.match(sticky, /panel\.set_drag_forwarding\(Callable\(\), can_drop, drop\)/)
		assert.match(sticky, /heads\.mouse_filter = Control\.MOUSE_FILTER_IGNORE/)
	})
})
