'use strict'
/**
 * WO-706 — MVR wall layers (owner 23.10: "walls in the imported mvr are listed as layers but they cant be turned on.
 * id like them to be turned off by default on import but with the ability to turn them on"). The owner's Capture
 * export lists its wall layers with no objects in them, so their eyes could not show anything: layers the file left
 * empty are labelled and get no eye / colour; wall-named layers that hold something start hidden in a scene new to
 * the project (Import of another scene, or picking one) and keep their eye. Behaviour: godot/client/tests/
 * test_mvr_wall_layers.gd; these pin the wiring.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const GD = (rel) => fs.readFileSync(path.join(__dirname, '../../godot/client', rel), 'utf8')

describe('WO-706 MVR wall layers', () => {
	it('the scene counts the objects per layer', () => {
		const scene = GD('features/previs/mvr_scene.gd')
		assert.match(
			scene,
			/layer_sizes\[node\.get_meta\("layer"\)\] = int\(layer_sizes\.get\(node\.get_meta\("layer"\), 0\)\) \+ 1/
		)
		assert.match(scene, /\tlayers = \[\]\n\tlayer_sizes = \{\}/, 'reset with the layers')
	})

	it('empty layers are labelled and get no eye; walls of a fresh scene start hidden', () => {
		const sec = GD('features/previs/mvr_section.gd')
		assert.match(
			sec,
			/M\.layer_labels\(scene\.layers, sizes\), _hidden_layers\(\),\n\t\tM\.empty_layers\(scene\.layers, sizes\)\)/
		)
		assert.match(sec, /var walls := M\.wall_layers\(scene\.layers, scene\.layer_sizes\)/)
		assert.match(
			sec,
			/_walls_for = str\(c\.id\) if fresh else ""/,
			'a new version of the shown scene keeps its hidden layers'
		)
		assert.match(sec, /MvrImport\.run\(self, _cfg\(\), _status, _imported\)/)
		const rows = GD('features/previs/color_rows.gd')
		assert.match(rows, /b\.disabled = off\.has\(n\)/)
	})

	it('Import tells the section whether the scene is new to the project', () => {
		const imp = GD('features/previs/mvr_import.gd')
		assert.match(imp, /PaneKit\.confirm\(host, check\[1\], func\(\) -> void: _upload\(path, cur, status, done, false\)\)/)
		assert.match(imp, /\t\t_upload\(path, cur, status, done, true\)/)
	})
})
