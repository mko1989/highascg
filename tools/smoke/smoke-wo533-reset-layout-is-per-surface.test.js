'use strict'

/**
 * WO-533 — "Reset layout" in one editor blanked the other editor's compose preview.
 *
 * Owner 14.08 (`todos14.08.26`): *"when i hit reset in looks editor to get a standard compose
 * preview it blanks the compose preview in timeline editor and vice verse."*
 *
 * The grab/reset button dispatched a bare `operator-tiles-reset-request` on `window`. Workspace tabs
 * only toggle an `active` class (WO-529), so BOTH tile canvases are mounted at all times and both
 * listeners fired.
 *
 * The second half is why it *blanks* rather than merely resets. The hidden canvas is
 * `display: none`, so `canvasSize()` returns its 1x1 floor, and `computeDefaultTileLayout(defs,1,1)`
 * packs the tiles as full-height slivers — then `resetLayout` calls `persist()`, writing that into
 * the hidden editor's own localStorage key. Permanent, and invisible until the operator switches
 * tabs. Same family as WO-529's degenerate-resize fault, reached through a different door.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { computeDefaultTileLayout } = require('../../client/components/operator-compose-tiles-geometry.js')

const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')
const DEFS = [
	{ id: 'pgm0', role: 'pgm', mainIndex: 0 },
	{ id: 'prv0', role: 'prv', mainIndex: 0 },
	{ id: 'pgm1', role: 'pgm', mainIndex: 1 },
	{ id: 'prv1', role: 'prv', mainIndex: 1 },
]

describe('WO-533: the mechanism — packing into a hidden pane', () => {
	it('a real canvas gives a 2x2 grid', () => {
		const l = computeDefaultTileLayout(DEFS, 1600, 700)
		for (const id of Object.keys(l)) assert.equal(l[id].h, 0.5, `${id} should be half-height`)
	})

	it('a 1x1 canvas (a display:none pane) gives full-height slivers — what got persisted', () => {
		const l = computeDefaultTileLayout(DEFS, 1, 1)
		for (const id of Object.keys(l)) {
			assert.equal(l[id].h, 1, `${id} spans the full height`)
			assert.equal(l[id].w, 0.25, `${id} is a quarter-width sliver`)
		}
	})

	it('the argument-free default is the safe fallback', () => {
		assert.deepEqual(computeDefaultTileLayout(DEFS), computeDefaultTileLayout(DEFS, 1920, 1080))
	})
})

describe('WO-533: the reset is addressed to one surface', () => {
	it('the panel names its surface on the event', () => {
		assert.match(
			read('client/components/preview-canvas-panel.js'),
			/new CustomEvent\('operator-tiles-reset-request', \{ detail: \{ surface \} \}\)/,
			'a bare event is what hit both editors',
		)
	})

	it('a tile canvas ignores a reset addressed elsewhere', () => {
		const src = read('client/components/operator-compose-tiles.js')
		assert.match(
			src,
			/const want = ev\?\.detail\?\.surface\s*\n\s*if \(want != null && String\(want\) !== String\(surface\)\) return/,
			'and only an unaddressed event still resets everything',
		)
	})

	it('resetLayout refuses to pack against a degenerate canvas', () => {
		assert.match(
			read('client/components/operator-compose-tiles.js'),
			/const real = cw > 1 && ch > 1\s*\n\s*const fresh = real \? computeDefaultTileLayout\(defs, cw, ch\) : computeDefaultTileLayout\(defs\)/,
			'no path may persist a 1x1 packing',
		)
	})
})
