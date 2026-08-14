'use strict'

/**
 * WO-256 smoke — Operator-GUI compose preview becomes a free-tile canvas (multiviewer-style
 * movable/resizable windows). Split out of smoke-wo256-operator-compose-tiles.test.js (line-count
 * refactor) — this file owns the todos19.07.26 resize fix: canvas resize must preserve tile PIXEL
 * sizes (not proportionally rescale fractions), tracking both `px` (current) and `pxDesired`
 * (user-set target, restored where it fits) on each tile. Default-layout math, chrome/body
 * geometry, persistence, T256.2/T256.4/T256.5 wiring, and boot-state reporting live in
 * smoke-wo256-operator-compose-tiles.test.js and its other siblings.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { clampTileRect, minOuterSize } = require('../../client/components/operator-compose-tiles.js')
const { readOperatorComposeTiles } = require('./lib/operator-compose-tiles-read.js')

describe('todos19.07.26 (resize fix): canvas resize preserves tile pixel sizes (not fractions)', () => {
	/**
	 * Harness to simulate tile resize behavior: tracks px/pxDesired, simulates canvas size changes,
	 * and applies the resize logic from operator-compose-tiles.js.
	 */
	function createTileResizeSimulator() {
		const tiles = new Map()
		let lastCanvasSize = { w: 0, h: 0 }

		return {
			addTile(id, frac, canvasW, canvasH) {
				if (!tiles.has(id)) {
					const t = { frac, px: null, pxDesired: null }
					// First layout: derive px from frac
					t.px = { x: frac.x * canvasW, y: frac.y * canvasH, w: frac.w * canvasW, h: frac.h * canvasH }
					t.pxDesired = { ...t.px }
					tiles.set(id, t)
				}
				lastCanvasSize = { w: canvasW, h: canvasH }
			},

			getTile(id) {
				return tiles.get(id)
			},

			getTilePx(id) {
				const t = tiles.get(id)
				return t ? { ...t.px } : null
			},

			getTileFrac(id) {
				const t = tiles.get(id)
				return t ? { ...t.frac } : null
			},

			// Simulate what onDragMove does: update px and pxDesired
			dragTile(id, newPx, canvasW, canvasH) {
				const t = tiles.get(id)
				if (!t) throw new Error(`Tile ${id} not found`)
				const clamped = clampTileRect(newPx, canvasW, canvasH, minOuterSize().width, minOuterSize().height)
				t.px = clamped
				t.pxDesired = { ...clamped }
				t.frac = { x: clamped.x / canvasW, y: clamped.y / canvasH, w: clamped.w / canvasW, h: clamped.h / canvasH }
			},

			// Simulate canvas resize: preserve px (clamped), update frac
			resizeCanvas(newCanvasW, newCanvasH) {
				if ((newCanvasW !== lastCanvasSize.w || newCanvasH !== lastCanvasSize.h) && lastCanvasSize.w > 0) {
					const minOuter = minOuterSize()
					for (const t of tiles.values()) {
						if (!t.px) continue
						// Try to restore pxDesired, clamp if needed
						t.px = clampTileRect(t.pxDesired, newCanvasW, newCanvasH, minOuter.width, minOuter.height)
						// Update fractions to match new px in new canvas size
						t.frac = { x: t.px.x / newCanvasW, y: t.px.y / newCanvasH, w: t.px.w / newCanvasW, h: t.px.h / newCanvasH }
					}
				}
				lastCanvasSize = { w: newCanvasW, h: newCanvasH }
			},
		}
	}

	it('canvas resize from 1000x600 to 800x600 keeps tile pixel position and size unchanged', () => {
		const sim = createTileResizeSimulator()
		const initialPx = { x: 100, y: 50, w: 300, h: 400 }
		sim.addTile('test_tile', { x: 0.1, y: initialPx.y / 600, w: 0.3, h: initialPx.h / 600 }, 1000, 600)
		// Manually set the px to our target
		const t = sim.getTile('test_tile')
		t.px = { ...initialPx }
		t.pxDesired = { ...initialPx }

		const before = sim.getTilePx('test_tile')
		sim.resizeCanvas(800, 600)
		const after = sim.getTilePx('test_tile')

		assert.deepEqual(after, before, 'pixel position and size preserved during canvas resize')
		assert.equal(after.x, 100)
		assert.equal(after.y, 50)
		assert.equal(after.w, 300)
		assert.equal(after.h, 400)
	})

	it('canvas resize from 1000x600 to 1200x600 keeps tile pixel position and size unchanged', () => {
		const sim = createTileResizeSimulator()
		const initialPx = { x: 100, y: 50, w: 300, h: 400 }
		sim.addTile('test_tile', { x: 0.1, y: 50 / 600, w: 0.3, h: 400 / 600 }, 1000, 600)
		const t = sim.getTile('test_tile')
		t.px = { ...initialPx }
		t.pxDesired = { ...initialPx }

		const before = sim.getTilePx('test_tile')
		sim.resizeCanvas(1200, 600)
		const after = sim.getTilePx('test_tile')

		assert.deepEqual(after, before, 'no proportional scaling: pixels stay the same when canvas grows')
		assert.equal(after.x, 100)
		assert.equal(after.w, 300, 'tile width did not scale with canvas width')
	})

	it("canvas shrink below a tile's minimum width clamps the tile to the minimum", () => {
		const sim = createTileResizeSimulator()
		const initialPx = { x: 50, y: 50, w: 300, h: 400 }
		sim.addTile('test_tile', { x: 0.05, y: 50 / 600, w: 0.3, h: 400 / 600 }, 1000, 600)
		const t = sim.getTile('test_tile')
		t.px = { ...initialPx }
		t.pxDesired = { ...initialPx }

		// Shrink canvas so the tile's right edge would overflow: 1000 -> 200 pixels wide
		sim.resizeCanvas(200, 600)
		const after = sim.getTilePx('test_tile')

		const minOuter = minOuterSize()
		assert.ok(after.x + after.w <= 200, 'tile clamped to fit inside the canvas')
		assert.ok(after.w >= minOuter.width, 'tile never shrinks below minimum outer width')
		assert.ok(after.h >= minOuter.height, 'tile never shrinks below minimum outer height')
	})

	it('canvas grows back after shrink: pxDesired is restored where it fits', () => {
		const sim = createTileResizeSimulator()
		const initialPx = { x: 100, y: 50, w: 300, h: 400 }
		sim.addTile('test_tile', { x: 0.1, y: 50 / 600, w: 0.3, h: 400 / 600 }, 1000, 600)
		const t = sim.getTile('test_tile')
		t.px = { ...initialPx }
		t.pxDesired = { ...initialPx }

		// Shrink canvas
		sim.resizeCanvas(200, 600)
		const clamped = sim.getTilePx('test_tile')
		assert.notDeepEqual(clamped, initialPx, 'tile was clamped during shrink')

		// Grow canvas back to original size
		sim.resizeCanvas(1000, 600)
		const restored = sim.getTilePx('test_tile')
		assert.deepEqual(restored, initialPx, 'pxDesired restored when canvas grows back')
	})

	it('tile resized mid-way updates pxDesired for future restore operations', () => {
		const sim = createTileResizeSimulator()
		sim.addTile('test_tile', { x: 0.1, y: 0.08, w: 0.3, h: 0.67 }, 1000, 600)
		const t = sim.getTile('test_tile')
		t.px = { x: 100, y: 50, w: 300, h: 400 }
		t.pxDesired = { ...t.px }

		// User drags the tile to a new size
		const newPx = { x: 200, y: 100, w: 250, h: 350 }
		sim.dragTile('test_tile', newPx, 1000, 600)

		const pxDesired = sim.getTile('test_tile').pxDesired
		assert.deepEqual(pxDesired, newPx, 'pxDesired updated to reflect user drag')

		// Shrink and grow canvas: should restore to the new user-set size
		sim.resizeCanvas(200, 600)
		sim.resizeCanvas(1000, 600)
		const restored = sim.getTilePx('test_tile')
		assert.deepEqual(restored, newPx, 'new user-set size restored after shrink+grow cycle')
	})

	it('fractions update after canvas resize to match the new pixel-to-canvas ratio', () => {
		const sim = createTileResizeSimulator()
		const initialPx = { x: 100, y: 0, w: 500, h: 600 }
		sim.addTile('test_tile', { x: 0.1, y: 0, w: 0.5, h: 1 }, 1000, 600)
		const t = sim.getTile('test_tile')
		t.px = { ...initialPx }
		t.pxDesired = { ...initialPx }

		const fracBefore = sim.getTileFrac('test_tile')
		assert.equal(fracBefore.x, 0.1)
		assert.equal(fracBefore.w, 0.5)

		// Canvas grows to 1200x600
		sim.resizeCanvas(1200, 600)
		const fracAfter = sim.getTileFrac('test_tile')

		// px unchanged, but fractions should reflect new ratio
		assert.equal(fracAfter.x, 100 / 1200, 'x fraction updated for new canvas width')
		assert.equal(fracAfter.w, 500 / 1200, 'w fraction updated for new canvas width')
		assert.equal(Math.round(fracAfter.x * 1200), 100, 'fractions still map back to original pixels')
		assert.equal(Math.round(fracAfter.w * 1200), 500, 'fractions still map back to original pixels')
	})

	it('operator-compose-tiles.js now tracks px/pxDesired in the tile object', () => {
		const src = readOperatorComposeTiles()
		assert.match(src, /const t = \{ def, frac, px: null, pxDesired: null,/, 'tile now has px and pxDesired fields')
	})

	it('layoutTileDom derives px from frac on first layout, then preserves px on subsequent calls', () => {
		const src = readOperatorComposeTiles()
		assert.match(src, /if \(!t\.px\) \{[\s\S]{0,200}t\.px = \{.*frac\.x.*cw.*\}/, 'derives px from frac if not set')
		assert.match(src, /const outer = \{ left: t\.px\.x, top: t\.px\.y, width: t\.px\.w, height: t\.px\.h \}/, 'uses px (not frac) for layout')
	})

	it('onDragMove and onDragEnd update both px and pxDesired when user resizes', () => {
		const src = readOperatorComposeTiles()
		assert.match(src, /t\.px = clamped[\s\S]{0,100}t\.pxDesired = \{ \.\.\.clamped \}/, 'both px and pxDesired updated on drag')
	})

	it('ResizeObserver calls onCanvasResize which preserves px and updates fractions', () => {
		const src = readOperatorComposeTiles()
		assert.match(src, /const ro = typeof ResizeObserver[\s\S]{0,50}new ResizeObserver\(onCanvasResize\)/, 'ResizeObserver uses onCanvasResize')
		// WO-529 repoint: the window was 500 chars, which the body already very nearly filled — the
		// degenerate-observation guard added there overflowed it. Widened, not weakened: the claim is
		// still "onCanvasResize is the function that restores pxDesired through clampTileRect", and
		// the guard's own behaviour is pinned in smoke-wo529-operator-surface-handoff.test.js.
		assert.match(src, /function onCanvasResize\(\)[\s\S]{0,1200}clampTileRect\(t\.pxDesired/, 'onCanvasResize preserves pxDesired, clamps to new size')
		assert.match(src, /newSize\.w.*newSize\.h.*minOuter\.width/, 'onCanvasResize receives new canvas size and clamps with minimum')
	})

	it('resetLayout clears px/pxDesired so they are re-derived from fresh fractions', () => {
		const src = readOperatorComposeTiles()
		assert.match(src, /function resetLayout\(\)[\s\S]{0,400}t\.px = null[\s\S]{0,100}t\.pxDesired = null/, 'reset clears px and pxDesired')
	})
})
