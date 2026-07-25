'use strict'

/**
 * WO-256 smoke — Operator-GUI compose preview becomes a free-tile canvas (multiviewer-style
 * movable/resizable windows). Split out of smoke-wo256-operator-compose-tiles.test.js (line-count
 * refactor) — this file owns T256.1's default-layout math: given N screen tile defs, does
 * computeDefaultTileLayout() produce the expected (and hole-area-optimal) rects. Everything else
 * (chrome/body geometry, persistence, T256.2/T256.4/T256.5 wiring, resize behavior, boot-state
 * reporting) stays in smoke-wo256-operator-compose-tiles.test.js and its other siblings.
 *
 * client/components/operator-compose-tiles.js is plain ESM (import/export) but has no top-level
 * DOM/browser-global access — every exported pure function below is safe to `require()` directly
 * under plain node:test (Node's require(esm) support), same pattern already used by
 * tools/smoke/smoke-wo250-timer-bank-mv-bars.test.js for client/components/playback-timer.js.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { computeDefaultTileLayout, tileHoleRectFromOuter } = require('../../client/components/operator-compose-tiles.js')

describe('WO-256 T256.1: default-layout math (N screens -> expected tile rects)', () => {
	it('1 screen, PRV+PGM -> single row, two columns, PRV left / PGM right, full height', () => {
		const defs = [
			{ id: 'prv_1', role: 'prv', mainIndex: 0 },
			{ id: 'pgm_1', role: 'pgm', mainIndex: 0 },
		]
		const layout = computeDefaultTileLayout(defs)
		assert.deepEqual(layout.prv_1, { x: 0, y: 0, w: 0.5, h: 1 })
		assert.deepEqual(layout.pgm_1, { x: 0.5, y: 0, w: 0.5, h: 1 })
	})

	it('2 screens, PRV+PGM each -> two rows (mainIndex order), each split 50/50 within its own row', () => {
		const defs = [
			{ id: 'pgm_1', role: 'pgm', mainIndex: 0 },
			{ id: 'prv_1', role: 'prv', mainIndex: 0 },
			{ id: 'pgm_2', role: 'pgm', mainIndex: 1 },
			{ id: 'prv_2', role: 'prv', mainIndex: 1 },
		]
		const layout = computeDefaultTileLayout(defs)
		assert.deepEqual(layout.prv_1, { x: 0, y: 0, w: 0.5, h: 0.5 })
		assert.deepEqual(layout.pgm_1, { x: 0.5, y: 0, w: 0.5, h: 0.5 })
		assert.deepEqual(layout.prv_2, { x: 0, y: 0.5, w: 0.5, h: 0.5 })
		assert.deepEqual(layout.pgm_2, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 })
	})

	it('3 screens, one with no PRV (pgm-only in middle) -> optimized to 2x3 grid, better hole area than 3x1', () => {
		const defs = [
			{ id: 'pgm_1', role: 'pgm', mainIndex: 0 },
			{ id: 'prv_1', role: 'prv', mainIndex: 0 },
			{ id: 'pgm_2', role: 'pgm', mainIndex: 1 }, // no PRV for screen 2 (previewEnabledByMain false)
			{ id: 'pgm_3', role: 'pgm', mainIndex: 2 },
			{ id: 'prv_3', role: 'prv', mainIndex: 2 },
		]
		const layout = computeDefaultTileLayout(defs, 1920, 1080)

		// New algorithm: 2 rows x 3 cols is better than old 3 rows x variable cols
		// Sorted order: prv_1, pgm_1, pgm_2, prv_3, pgm_3 (by mainIndex, then prv before pgm)
		// Grid fill:
		//   (0,0)=prv_1, (0,1)=pgm_1, (0,2)=pgm_2
		//   (1,0)=prv_3, (1,1)=pgm_3, (1,2)=empty
		const colW = 1 / 3
		const rowH = 0.5
		assert.deepEqual(layout.prv_1, { x: 0, y: 0, w: colW, h: rowH }, 'prv_1 in row 0, col 0')
		assert.deepEqual(layout.pgm_1, { x: colW, y: 0, w: colW, h: rowH }, 'pgm_1 in row 0, col 1')
		assert.deepEqual(layout.pgm_2, { x: colW * 2, y: 0, w: colW, h: rowH }, 'pgm_2 in row 0, col 2')
		assert.deepEqual(layout.prv_3, { x: 0, y: rowH, w: colW, h: rowH }, 'prv_3 in row 1, col 0')
		assert.deepEqual(layout.pgm_3, { x: colW, y: rowH, w: colW, h: rowH }, 'pgm_3 in row 1, col 1')

		// Verify hole areas are better than the old 3x1 layout
		function calcHoleArea(x, y, w, h, aspect = 16 / 9) {
			const outer = { left: x * 1920, top: y * 1080, width: w * 1920, height: h * 1080 }
			const hole = tileHoleRectFromOuter(outer, aspect)
			return hole.width * hole.height
		}
		let optimized_total = 0
		for (const l of Object.values(layout)) {
			optimized_total += calcHoleArea(l.x, l.y, l.w, l.h)
		}

		// Old layout: 3 rows, each with varying widths
		const old_prv1 = calcHoleArea(0, 0, 0.5, 1 / 3)
		const old_pgm1 = calcHoleArea(0.5, 0, 0.5, 1 / 3)
		const old_pgm2 = calcHoleArea(0, 1 / 3, 1.0, 1 / 3)
		const old_prv3 = calcHoleArea(0, 2 / 3, 0.5, 1 / 3)
		const old_pgm3 = calcHoleArea(0.5, 2 / 3, 0.5, 1 / 3)
		const old_total = old_prv1 + old_pgm1 + old_pgm2 + old_prv3 + old_pgm3

		assert.ok(optimized_total > old_total, `optimized (${Math.round(optimized_total)}) beats old 3x1 (${Math.round(old_total)})`)
	})

	it('empty defs -> empty layout, no NaN/crash', () => {
		assert.deepEqual(computeDefaultTileLayout([]), {})
	})

	it('2 tiles on a wide (16:9) canvas: side-by-side layout beats stacked layout on hole area', () => {
		// Canvas 1920x1080 (16:9, wide)
		const defs = [
			{ id: 'prv_1', role: 'prv', mainIndex: 0 },
			{ id: 'pgm_1', role: 'pgm', mainIndex: 0 },
		]
		const layout = computeDefaultTileLayout(defs, 1920, 1080)

		// Verify layout is side-by-side (2 cols, 1 row)
		assert.ok(Math.abs(layout.prv_1.w - 0.5) < 1e-9, 'prv tile is half-width')
		assert.ok(Math.abs(layout.pgm_1.w - 0.5) < 1e-9, 'pgm tile is half-width')
		assert.ok(Math.abs(layout.prv_1.h - 1.0) < 1e-9, 'prv tile is full height')
		assert.ok(Math.abs(layout.pgm_1.h - 1.0) < 1e-9, 'pgm tile is full height')
		assert.ok(layout.pgm_1.x > layout.prv_1.x, 'pgm is to the right of prv')

		// Compute hole areas to prove optimality
		function calcHoleArea(x, y, w, h, aspect = 16 / 9) {
			const outer = { left: x * 1920, top: y * 1080, width: w * 1920, height: h * 1080 }
			const hole = tileHoleRectFromOuter(outer, aspect)
			return hole.width * hole.height
		}
		const prv_area = calcHoleArea(layout.prv_1.x, layout.prv_1.y, layout.prv_1.w, layout.prv_1.h)
		const pgm_area = calcHoleArea(layout.pgm_1.x, layout.pgm_1.y, layout.pgm_1.w, layout.pgm_1.h)
		const optimized_total = prv_area + pgm_area

		// Compare against stacked layout (old algorithm: 2 rows, 1 col)
		const stacked_area_per_tile = calcHoleArea(0, 0, 1.0, 0.5)
		const stacked_total = stacked_area_per_tile * 2

		assert.ok(optimized_total > stacked_total, `optimized (${Math.round(optimized_total)}) beats stacked (${Math.round(stacked_total)}) for 2 tiles on 16:9 canvas`)
	})

	it('3 tiles on a 16:9 canvas: 2x2 grid layout beats alternatives on hole area', () => {
		// Canvas 1920x1080, 3 tiles
		const defs = [
			{ id: 'pgm_1', role: 'pgm', mainIndex: 0 },
			{ id: 'prv_1', role: 'prv', mainIndex: 0 },
			{ id: 'pgm_2', role: 'pgm', mainIndex: 1 },
		]
		const layout = computeDefaultTileLayout(defs, 1920, 1080)

		// Should be 2 cols x 2 rows, filling: [prv_1(0,0), pgm_1(0,1), pgm_2(1,0), empty(1,1)]
		// Actually, order is: sorted by mainIndex then role, so: prv_1, pgm_1, pgm_2
		// Grid 2x2: (0,0)=prv_1, (1,0)=pgm_1, (0,1)=pgm_2, (1,1)=empty
		// But we're filling row-by-row: row 0: col 0, col 1; row 1: col 0, col 1
		// So: (row 0, col 0)=prv_1, (row 0, col 1)=pgm_1, (row 1, col 0)=pgm_2
		assert.ok(Math.abs(layout.prv_1.w - 0.5) < 1e-9, 'tile is half-width in 2-col grid')
		assert.ok(Math.abs(layout.prv_1.h - 0.5) < 1e-9, 'tile is half-height in 2-row grid')
		assert.ok(Math.abs(layout.pgm_1.x - 0.5) < 1e-9 && Math.abs(layout.pgm_1.y - 0) < 1e-9, 'pgm_1 is in row 0, col 1')

		// Compute total hole area
		function calcHoleArea(x, y, w, h, aspect = 16 / 9) {
			const outer = { left: x * 1920, top: y * 1080, width: w * 1920, height: h * 1080 }
			const hole = tileHoleRectFromOuter(outer, aspect)
			return hole.width * hole.height
		}
		let optimized_total = 0
		for (const def of defs) {
			const l = layout[def.id]
			optimized_total += calcHoleArea(l.x, l.y, l.w, l.h)
		}

		// Compare against 3x1 (old algorithm: one row per screen with varying widths)
		// Old: screen 0 has 2 tiles (prv, pgm), screen 1 has 1 tile (pgm)
		// So: row 0: 2 cols (prv 0.5w, pgm 0.5w, height 0.5), row 1: 1 col (pgm 1.0w, height 0.5)
		const old_prv = calcHoleArea(0, 0, 0.5, 0.5)
		const old_pgm1 = calcHoleArea(0.5, 0, 0.5, 0.5)
		const old_pgm2 = calcHoleArea(0, 0.5, 1.0, 0.5)
		const old_total = old_prv + old_pgm1 + old_pgm2

		assert.ok(optimized_total >= old_total, `optimized (${Math.round(optimized_total)}) >= old layout (${Math.round(old_total)}) for 3 tiles on 16:9`)
	})

	it('4 tiles on a 16:9 canvas: 2x2 grid is optimal, all tiles equal size', () => {
		// Canvas 1920x1080, 4 tiles (2 screens, 2 tiles each)
		const defs = [
			{ id: 'prv_1', role: 'prv', mainIndex: 0 },
			{ id: 'pgm_1', role: 'pgm', mainIndex: 0 },
			{ id: 'prv_2', role: 'prv', mainIndex: 1 },
			{ id: 'pgm_2', role: 'pgm', mainIndex: 1 },
		]
		const layout = computeDefaultTileLayout(defs, 1920, 1080)

		// Should be 2x2 grid, all tiles 0.5w x 0.5h
		for (const l of Object.values(layout)) {
			assert.ok(Math.abs(l.w - 0.5) < 1e-9, 'all tiles half-width')
			assert.ok(Math.abs(l.h - 0.5) < 1e-9, 'all tiles half-height')
		}

		// Verify all tiles fit inside canvas
		for (const l of Object.values(layout)) {
			assert.ok(l.x >= 0 && l.y >= 0 && l.x + l.w <= 1 && l.y + l.h <= 1, 'tile stays in 0-1 bounds')
		}

		// Compute hole area
		function calcHoleArea(x, y, w, h, aspect = 16 / 9) {
			const outer = { left: x * 1920, top: y * 1080, width: w * 1920, height: h * 1080 }
			const hole = tileHoleRectFromOuter(outer, aspect)
			return hole.width * hole.height
		}
		let total = 0
		for (const l of Object.values(layout)) {
			total += calcHoleArea(l.x, l.y, l.w, l.h)
		}

		// Compare against old algorithm (2 rows, each row 2 cols)
		const old_per_tile = calcHoleArea(0, 0, 0.5, 0.5)
		const old_total = old_per_tile * 4

		assert.equal(total, old_total, 'for 4 tiles, optimized = old (both use 2x2 grid)')
	})

	it('every default rect stays within the 0-1 canvas fraction bounds', () => {
		const defs = [
			{ id: 'pgm_1', role: 'pgm', mainIndex: 0 },
			{ id: 'prv_1', role: 'prv', mainIndex: 0 },
			{ id: 'pgm_2', role: 'pgm', mainIndex: 1 },
			{ id: 'prv_2', role: 'prv', mainIndex: 1 },
			{ id: 'pgm_3', role: 'pgm', mainIndex: 2 },
		]
		const layout = computeDefaultTileLayout(defs)
		for (const r of Object.values(layout)) {
			assert.ok(r.x >= 0 && r.y >= 0, 'no negative origin')
			assert.ok(r.x + r.w <= 1 + 1e-9 && r.y + r.h <= 1 + 1e-9, 'no rect overflows the canvas')
		}
	})
})
