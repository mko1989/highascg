'use strict'
/**
 * WO-905: each screen's looks scroll on their own (owner: "scrolling needs to be per screen dest") — the deck scrolls
 * only sideways, every column keeps its header and timer and scrolls its card grid; blank space stays drop space.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const view = fs.readFileSync(
	path.join(__dirname, '..', '..', 'godot', 'client', 'features', 'live', 'deck_view.gd'),
	'utf8'
)
const column = view.slice(view.indexOf('func _column('), view.indexOf('\nfunc ', view.indexOf('func _column(') + 1))

describe('WO-905 Live deck per-screen scrolling', () => {
	it('the deck itself never scrolls vertically', () => {
		assert.match(view, /\tvertical_scroll_mode = ScrollContainer\.SCROLL_MODE_DISABLED/)
	})
	it('each column scrolls its grid, header and timer stay above it', () => {
		assert.match(column, /var scroll := ScrollContainer\.new\(\)/)
		assert.match(column, /scroll\.horizontal_scroll_mode = ScrollContainer\.SCROLL_MODE_DISABLED/)
		assert.match(column, /scroll\.size_flags_vertical = Control\.SIZE_EXPAND_FILL/)
		assert.match(column, /scroll\.add_child\(grid\)\n\tcol\.add_child\(scroll\)/)
		assert.ok(column.indexOf('col.add_child(head_row)') < column.indexOf('col.add_child(timer)'))
		assert.ok(column.indexOf('col.add_child(timer)') < column.indexOf('col.add_child(scroll)'))
	})
	it('blank space below the cards still clears PRV and takes drops', () => {
		assert.match(column, /scroll\.mouse_filter = Control\.MOUSE_FILTER_PASS/)
		assert.match(
			column,
			/scroll\.set_drag_forwarding\(Callable\(\), _can_drop_new\.bind\(main\), _drop_new\.bind\(main\)\)/
		)
	})
})
