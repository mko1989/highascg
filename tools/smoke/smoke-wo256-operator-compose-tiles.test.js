'use strict'

/**
 * WO-256 smoke — Operator-GUI compose preview becomes a free-tile canvas (multiviewer-style
 * movable/resizable windows). Covers: T256.1 (default-layout math, chrome/body geometry,
 * persistence pure logic), T256.2 (hard gate in preview-canvas-panel.js, zero fork of the file),
 * T256.4 (rect-reporting shape reused unchanged, interaction-suppress selector extended),
 * T256.5 (this file, registered in the curated gate).
 *
 * client/components/operator-compose-tiles.js is plain ESM (import/export) but has no top-level
 * DOM/browser-global access — every exported pure function below is safe to `require()` directly
 * under plain node:test (Node's require(esm) support), same pattern already used by
 * tools/smoke/smoke-wo250-timer-bank-mv-bars.test.js for client/components/playback-timer.js.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
	MIN_BODY,
	TILE_CHROME,
	DEFAULT_TILE_ASPECT,
	minOuterSize,
	tileBodyRectFromOuter,
	tileHoleRectFromOuter,
	resolveTileAspect,
	snapToGrid,
	clampTileRect,
	computeDefaultTileLayout,
	layoutStorageKey,
	resolveTileLayout,
	loadTileLayout,
	saveTileLayout,
} = require('../../client/components/operator-compose-tiles.js')

const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

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

describe('WO-256 T256.1/T256.4: body-rect-excludes-chrome invariant', () => {
	it('tileBodyRectFromOuter never overlaps the border/header/footer on any side', () => {
		const outer = { left: 40, top: 60, width: 300, height: 220 }
		const body = tileBodyRectFromOuter(outer)
		assert.ok(body.left > outer.left, 'body left is strictly inside the outer left border')
		assert.ok(body.top > outer.top + TILE_CHROME.headerH - 1, 'body top clears the header strip')
		assert.ok(body.left + body.width < outer.left + outer.width, 'body right is strictly inside the outer right border')
		assert.ok(
			body.top + body.height < outer.top + outer.height - TILE_CHROME.footerH + 1,
			'body bottom clears the footer strip',
		)
		assert.equal(body.left, outer.left + TILE_CHROME.borderW)
		assert.equal(body.top, outer.top + TILE_CHROME.borderW + TILE_CHROME.headerH)
	})

	it('degenerate (too-small) outer rect never yields a negative body size', () => {
		const body = tileBodyRectFromOuter({ left: 0, top: 0, width: 1, height: 1 })
		assert.ok(body.width >= 0 && body.height >= 0, 'clamped to 0, never negative')
	})

	it('minOuterSize is derived FROM the same chrome constants (no independently-hand-picked minimum)', () => {
		const min = minOuterSize()
		const body = tileBodyRectFromOuter({ left: 0, top: 0, width: min.width, height: min.height })
		assert.ok(body.width >= MIN_BODY.width - 1e-9, 'min outer width yields at least the min body width')
		assert.ok(body.height >= MIN_BODY.height - 1e-9, 'min outer height yields at least the min body height')
	})
})

describe('todos19.07.26: hole is aspect-locked, border sits just outside it (never over the video)', () => {
	it('tileHoleRectFromOuter keeps the given source aspect exactly (wide tile -> pillarbox)', () => {
		const outer = { left: 0, top: 0, width: 1000, height: 300 } // content 996 x (300-4-34)=262, very wide
		const hole = tileHoleRectFromOuter(outer, 16 / 9)
		assert.ok(Math.abs(hole.width / hole.height - 16 / 9) < 1e-9, 'hole w/h is exactly the source aspect')
		const content = tileBodyRectFromOuter(outer)
		assert.ok(Math.abs(hole.height - content.height) < 1e-9, 'height-constrained: bars left/right')
		assert.ok(Math.abs((hole.left - content.left) - (content.left + content.width - (hole.left + hole.width))) < 1e-6, 'pillarbox is centered')
	})

	it('tall tile -> letterbox (bars top/bottom), still exact aspect and centered', () => {
		const outer = { left: 10, top: 20, width: 300, height: 800 }
		const hole = tileHoleRectFromOuter(outer, 16 / 9)
		const content = tileBodyRectFromOuter(outer)
		assert.ok(Math.abs(hole.width / hole.height - 16 / 9) < 1e-9)
		assert.ok(Math.abs(hole.width - content.width) < 1e-9, 'width-constrained: bars top/bottom')
		assert.ok(Math.abs((hole.top - content.top) - (content.top + content.height - (hole.top + hole.height))) < 1e-6, 'letterbox is centered')
	})

	it('border-just-outside invariant: hole stays >= borderW inside the tile box on all four sides, above the footer', () => {
		for (const outer of [
			{ left: 40, top: 60, width: 300, height: 220 },
			{ left: 0, top: 0, width: 1000, height: 300 },
			{ left: 5, top: 5, width: 300, height: 900 },
		]) {
			for (const ar of [16 / 9, 4 / 3, 32 / 9]) {
				const hole = tileHoleRectFromOuter(outer, ar)
				assert.ok(hole.left >= outer.left + TILE_CHROME.borderW - 1e-9, 'left ring reserved for the outline')
				assert.ok(hole.top >= outer.top + TILE_CHROME.borderW - 1e-9, 'top ring reserved for the outline')
				assert.ok(hole.left + hole.width <= outer.left + outer.width - TILE_CHROME.borderW + 1e-9, 'right ring reserved')
				assert.ok(
					hole.top + hole.height <= outer.top + outer.height - TILE_CHROME.borderW - TILE_CHROME.footerH + 1e-9,
					'hole never reaches into the footer strip',
				)
			}
		}
	})

	it('invalid/degenerate aspect falls back to DEFAULT_TILE_ASPECT (16:9); tiny outer never yields negative sizes', () => {
		const hole = tileHoleRectFromOuter({ left: 0, top: 0, width: 500, height: 400 }, NaN)
		assert.ok(Math.abs(hole.width / hole.height - DEFAULT_TILE_ASPECT) < 1e-9)
		assert.equal(DEFAULT_TILE_ASPECT, 16 / 9)
		const tiny = tileHoleRectFromOuter({ left: 0, top: 0, width: 1, height: 1 }, 16 / 9)
		assert.ok(tiny.width >= 0 && tiny.height >= 0)
	})

	it('resolveTileAspect: INFO-derived channelResolutionsByChannel for the resolved source channel wins', () => {
		const cm = {
			programChannels: [1], previewChannels: [3],
			channelResolutionsByChannel: { 1: { w: 3072, h: 1728 }, 3: { w: 1024, h: 768 } },
			programResolutions: [{ w: 1920, h: 1080 }],
		}
		assert.equal(resolveTileAspect({ role: 'pgm', mainIndex: 0 }, cm), 3072 / 1728)
		assert.equal(resolveTileAspect({ role: 'prv', mainIndex: 0 }, cm), 1024 / 768, 'PRV resolves its own channel')
	})

	it('resolveTileAspect: falls back to programResolutions[mainIndex], then 16:9; never NaN/throws', () => {
		const cm = { programChannels: [1], programResolutions: [{ w: 1280, h: 1024 }] }
		assert.equal(resolveTileAspect({ role: 'pgm', mainIndex: 0 }, cm), 1280 / 1024)
		assert.equal(resolveTileAspect({ role: 'pgm', mainIndex: 5 }, cm), DEFAULT_TILE_ASPECT)
		assert.equal(resolveTileAspect({ role: 'pgm', mainIndex: 0 }, null), DEFAULT_TILE_ASPECT)
		assert.equal(resolveTileAspect(null, {}), DEFAULT_TILE_ASPECT)
	})

	it('layoutTileDom positions the BODY from tileHoleRectFromOuter + resolveTileAspect (the reported bodyEl IS the hole)', () => {
		const src = read('client/components/operator-compose-tiles.js')
		assert.match(src, /const hole = tileHoleRectFromOuter\(\s*\{ left: 0, top: 0, width: outer\.width, height: outer\.height \},\s*resolveTileAspect\(t\.def, getCm\(\)\),?\s*\)/)
		assert.match(src, /t\.bodyEl\.style\.left = `\$\{hole\.left\}px`/)
	})
})

describe('WO-256 T256.1: snap + clamp helpers', () => {
	it('snapToGrid rounds to the nearest 8px by default', () => {
		assert.equal(snapToGrid(101), 104)
		assert.equal(snapToGrid(99), 96)
		assert.equal(snapToGrid(4), 8, 'exact half rounds up (Math.round semantics)')
		assert.equal(snapToGrid(3), 0)
	})

	it('clampTileRect keeps a tile fully inside the canvas and never below the min size', () => {
		const out = clampTileRect({ x: 900, y: 500, w: 200, h: 150 }, 1000, 600, 160, 90)
		assert.ok(out.x + out.w <= 1000 && out.y + out.h <= 600, 'kept inside canvas bounds')
		const shrunk = clampTileRect({ x: 0, y: 0, w: 50, h: 30 }, 1000, 600, 160, 90)
		assert.equal(shrunk.w, 160, 'width floored to the minimum')
		assert.equal(shrunk.h, 90, 'height floored to the minimum')
	})

	it('clampTileRect on a too-small canvas does not throw or invert (defensive)', () => {
		assert.doesNotThrow(() => clampTileRect({ x: 0, y: 0, w: 400, h: 300 }, 100, 80, 160, 90))
	})
})

describe('WO-256 T256.1: persistence (storage stub — no real localStorage/jsdom)', () => {
	function fakeStorage() {
		const d = {}
		return { getItem: (k) => (Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null), setItem: (k, v) => { d[k] = String(v) }, _d: d }
	}

	it('layoutStorageKey is keyed by screen count, following the storageKeyPrefix convention', () => {
		assert.equal(layoutStorageKey('casparcg_preview_scenes', 2), 'casparcg_preview_scenes_operator_tiles_2')
		assert.equal(layoutStorageKey('casparcg_preview_scenes', 0), 'casparcg_preview_scenes_operator_tiles_1', 'floors to at least 1')
	})

	it('round-trip: save then load returns the identical layout map', () => {
		const storage = fakeStorage()
		const key = layoutStorageKey('casparcg_preview_scenes', 2)
		const layout = { pgm_1: { x: 0.1, y: 0.2, w: 0.4, h: 0.5 }, prv_1: { x: 0.5, y: 0.2, w: 0.4, h: 0.5 } }
		saveTileLayout(storage, key, layout)
		const loaded = loadTileLayout(storage, key)
		assert.deepEqual(loaded, layout)
	})

	it('loadTileLayout tolerates missing/corrupt storage (returns null, never throws)', () => {
		const storage = fakeStorage()
		assert.equal(loadTileLayout(storage, 'nope'), null)
		storage.setItem('bad', '{not json')
		assert.equal(loadTileLayout(storage, 'bad'), null)
		assert.doesNotThrow(() => loadTileLayout(null, 'x'), 'no storage object at all')
	})

	it('resolveTileLayout: a stored map covering every current def id is used as-is (user positioning wins)', () => {
		const defs = [{ id: 'pgm_1', role: 'pgm', mainIndex: 0 }, { id: 'prv_1', role: 'prv', mainIndex: 0 }]
		const stored = { pgm_1: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 }, prv_1: { x: 0.6, y: 0.6, w: 0.3, h: 0.3 } }
		assert.deepEqual(resolveTileLayout(defs, stored), stored)
	})

	it('resolveTileLayout: a screen-count change (stored map missing an id) falls back to a fresh default wholesale', () => {
		const defs = [
			{ id: 'pgm_1', role: 'pgm', mainIndex: 0 },
			{ id: 'prv_1', role: 'prv', mainIndex: 0 },
			{ id: 'pgm_2', role: 'pgm', mainIndex: 1 },
		]
		const stored = { pgm_1: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 }, prv_1: { x: 0.6, y: 0.6, w: 0.3, h: 0.3 } } // no pgm_2
		const resolved = resolveTileLayout(defs, stored)
		assert.deepEqual(resolved, computeDefaultTileLayout(defs), 'wholesale re-default, not a partial mix')
	})

	it('resolveTileLayout: no stored map -> default layout', () => {
		const defs = [{ id: 'pgm_1', role: 'pgm', mainIndex: 0 }, { id: 'prv_1', role: 'prv', mainIndex: 0 }]
		assert.deepEqual(resolveTileLayout(defs, null), computeDefaultTileLayout(defs))
	})
})

describe('WO-256 T256.2: preview-canvas-panel.js hard-gates the tile canvas on operator-GUI mode, one code path (no fork)', () => {
	const src = read('client/components/preview-canvas-panel.js')

	it('operatorTilesActive requires BOTH composePrvPgmLayoutToggle and isOperatorGuiModeActive()', () => {
		assert.match(src, /const operatorTilesActive = composePrvPgmLayoutToggle && isOperatorGuiModeActive\(\)/)
	})

	it('paint()/updateLive() early-return under the tiles gate instead of forking their logic', () => {
		assert.match(src, /if \(operatorTilesActive\) return/g)
		// Appears at least twice: paint() and updateLive().
		const hits = src.match(/if \(operatorTilesActive\) return/g) || []
		assert.ok(hits.length >= 2, `expected >=2 early-return gates, found ${hits.length}`)
	})

	it('mounts operator-compose-tiles.js (host now, other clients when Live preview flips the view), destroys on teardown', () => {
		assert.match(src, /import \{ initOperatorComposeTiles \} from '\.\/operator-compose-tiles\.js'/)
		// WO-319: the mount is dynamic — built for the host operator kiosk at init, and lazily on the
		// first Live-preview-on for any other client (setComposeTilesMode). Held in tilesRef.
		assert.match(src, /operatorTilesActive\s*\n?\s*\?\s*initOperatorComposeTiles\(/)
		assert.match(src, /tilesRef\.h\?\.destroy\(\)/)
	})

	it('file stays under the repo max-file-lines gate (~500) despite the new branch', () => {
		const lines = src.split('\n').length
		assert.ok(lines <= 500, `preview-canvas-panel.js is ${lines} lines, over the 500 cap`)
	})

	it('is not forked: exactly one initPreviewPanel export, no sibling operator-mode-only copy of the function', () => {
		const matches = src.match(/export function initPreviewPanel/g) || []
		assert.equal(matches.length, 1)
	})
})

describe('WO-256 T256.4: rect reporting reuses the existing merged-report path unchanged, suppression covers the tile canvas', () => {
	it('operator-compose-tiles.js reports the SAME cell shape ({ id, role, mainIndex, rect }) preview-canvas-panel.js already emitted for the canvas-pair', () => {
		const src = read('client/components/operator-compose-tiles.js')
		// WO-323 extended the report with srcCh for user source tiles; the base shape is unchanged.
		assert.match(src, /const cell = \{ id: t\.def\.id, role: t\.def\.role, mainIndex: t\.def\.mainIndex, rect \}/)
		assert.match(src, /if \(t\.def\.role === 'mvcell'\) cell\.srcCh = t\.def\.srcCh/)
		assert.match(src, /getBoundingClientRect\(\)/, 'reports real viewport-space DOM rects, same as the old compose cells')
	})

	it('rects report on drag/resize release, not on every pointermove (matches the suppression contract)', () => {
		const src = read('client/components/operator-compose-tiles.js')
		assert.match(src, /function onDragEnd\(\)[\s\S]{0,500}reportRectsNow\(\)/)
		assert.doesNotMatch(src.match(/function onDragMove[\s\S]*?\n\t\}/)[0], /reportRectsNow/, 'no mid-drag rect spam')
	})

	it('reuses pickTopLayerStateForPlayback by IMPORTING mountPgmTopLayerPlaybackTimer, never re-implements bank/stale logic', () => {
		const src = read('client/components/operator-compose-tiles.js')
		assert.match(src, /import \{ mountPgmTopLayerPlaybackTimer \} from '\.\/playback-timer\.js'/)
		assert.doesNotMatch(src, /function pickTopLayerStateForPlayback/, 'must not copy the picker')
		assert.doesNotMatch(src, /TIMER_BAND_MIN|BORDER_LAYER/, 'must not re-implement the excluded-layer constants either')
	})

	it('playback-timer.js still exports pickTopLayerStateForPlayback (WO-250) for any future direct reuse', () => {
		const { pickTopLayerStateForPlayback } = require('../../client/components/playback-timer.js')
		assert.equal(typeof pickTopLayerStateForPlayback, 'function')
	})

	it('WO-263: tile drags do NOT suppress (holes track the box live) — tile surface excluded from the suppressor; onDragMove reports live', () => {
		const suppress = read('client/lib/operator-gui-interaction-suppress.js')
		assert.doesNotMatch(suppress, /PREVIEW_SURFACE_SELECTOR\s*=\s*'[^']*\.operator-compose-tiles[^']*'/, 'tile surface must NOT suppress — it reports live instead')
		const tiles = read('client/components/operator-compose-tiles.js')
		assert.match(tiles, /onDragMove[\s\S]*?scheduleReport\(\)/, 'onDragMove reports live so the Firefox hole follows the resize')
	})

	it('screen-label.js (WO-222) is reused for the header label, not re-implemented', () => {
		const src = read('client/components/operator-compose-tiles.js')
		assert.match(src, /import \{ screenLabel \} from '\.\.\/lib\/screen-label\.js'/)
		assert.doesNotMatch(src, /function screenLabel/)
	})
})

describe('WO-256: CSS wired, tile chrome/body classes present, styles.css imports the new partial', () => {
	it('client/styles.css imports the new 10b-operator-compose-tiles.css partial', () => {
		assert.match(read('client/styles.css'), /10b-operator-compose-tiles\.css/)
	})
	it('todos19.07.26: the frame is an outline ON THE BODY (hole) — inner edge = hole edge, zero border pixels over the video', () => {
		const css = read('client/styles/10b-operator-compose-tiles.css')
		assert.match(css, /\.operator-tile__body\s*\{[^}]*outline:\s*2px solid/, 'body carries the frame outline')
		assert.match(css, /\.operator-tile__body\s*\{[^}]*outline-offset:\s*0/, 'offset 0: outline hugs the hole edge from OUTSIDE')
		assert.doesNotMatch(css, /\.operator-tile\s*\{[^}]*outline/, 'tile box itself is frameless — no border on the free-form box')
		assert.doesNotMatch(css, /\.operator-tile__body\s*\{[^}]*border:/, 'a real border would eat into the hole box')
		assert.match(css, /\.operator-tile\[data-role='pgm'\] \.operator-tile__body \{ outline-color/, 'role colors target the body outline')
		assert.match(css, /\.operator-tile\[data-role='prv'\] \.operator-tile__body \{ outline-color/)
		// WO-263: chrome moved BELOW the video — the screen-label row lives in the footer now.
		assert.match(css, /\.operator-tile__label/)
		assert.match(css, /\.operator-tile__footer/)
	})
})

describe('2026-07-19 fix: a pure POSITION change (looks list <-> looks editor shifts the canvas vertically, same size) re-reports the rects', () => {
	const {
		POSITION_WATCH_SLACK,
		POSITION_WATCH_THRESHOLDS,
		positionWatchRootMargin,
		watchElementPosition,
	} = require('../../client/lib/element-position-watch.js')

	it('positionWatchRootMargin hugs the rect: negative insets from every viewport edge, inflated by the slack', () => {
		const rect = { left: 100, top: 200, right: 500, bottom: 400 }
		const viewport = { width: 1920, height: 1080 }
		// top=200-2=198, right=1920-500-2=1418, bottom=1080-400-2=678, left=100-2=98 -> negated
		assert.equal(positionWatchRootMargin(rect, viewport), '-198px -1418px -678px -98px')
	})

	it('floors so sub-pixel positions only ever GROW the box (containment at rest is never lost)', () => {
		const rect = { left: 100.6, top: 200.4, right: 500.7, bottom: 400.2 }
		const viewport = { width: 1920, height: 1080 }
		// left: floor(100.6)-2=98 (box edge at 98 <= 100.6), right inset: floor(1920-500.7)-2=1417 (box edge at 503 >= 500.7)
		assert.equal(positionWatchRootMargin(rect, viewport), '-198px -1417px -677px -98px')
	})

	it('a rect edge outside the viewport yields a positive (expanding) component — valid rootMargin, no crash', () => {
		const rect = { left: -50, top: 10, right: 2000, bottom: 500 }
		const m = positionWatchRootMargin(rect, { width: 1920, height: 1080 })
		const [top, right] = m.split(' ')
		assert.equal(top, '-8px')
		assert.equal(right, '82px', 'right edge past the viewport -> expansion, not clamped/NaN')
	})

	it('threshold ladder spans 0..1 so partial-visibility elements still cross a threshold on movement', () => {
		assert.equal(POSITION_WATCH_THRESHOLDS[0], 0)
		assert.equal(POSITION_WATCH_THRESHOLDS[POSITION_WATCH_THRESHOLDS.length - 1], 1)
		assert.ok(POSITION_WATCH_THRESHOLDS.length >= 100)
		assert.ok(POSITION_WATCH_SLACK >= 1, 'some slack: sub-pixel drift must not thrash')
	})

	it('watchElementPosition degrades to a no-op without IntersectionObserver/window (node) — never throws', () => {
		const w = watchElementPosition({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }) }, () => {})
		assert.doesNotThrow(() => { w.update(); w.destroy() })
	})

	it('operator-compose-tiles.js wires the watcher: root position watched, re-hugged after every report, torn down on destroy', () => {
		const src = read('client/components/operator-compose-tiles.js')
		assert.match(src, /import \{ watchElementPosition \} from '\.\.\/lib\/element-position-watch\.js'/)
		assert.match(src, /const posWatch = watchElementPosition\(root, \(\) => scheduleReport\(\)\)/)
		assert.match(src, /onCellRects\(cellRects[^)]*\)\s*\n[\s\S]{0,200}posWatch\.update\(\)/, 're-hug happens after each rect report')
		assert.match(src, /posWatch\.destroy\(\)/)
	})

	it('workspace tab switches re-layout + re-report deterministically (and the listener is removed on destroy)', () => {
		const src = read('client/components/operator-compose-tiles.js')
		assert.match(src, /window\.addEventListener\('highascg-workspace-tab-activated', onTabActivated\)/)
		assert.match(src, /window\.removeEventListener\('highascg-workspace-tab-activated', onTabActivated\)/)
	})

	it('no idle polling snuck in: the tiles module has no setInterval and no free-running rAF loop', () => {
		const src = read('client/components/operator-compose-tiles.js')
		assert.doesNotMatch(src, /setInterval/, 'position watching must be observer-driven, not polled')
	})
})

describe('WO-256: server needs no changes — operator-gui-channel.js already accepts arbitrary role/mainIndex/rect cells', () => {
	it('resolveCellSourceChannel branches only on role + mainIndex, not on rect position/size/count (grep-level, source unchanged by this WO)', () => {
		const src = read('src/system/operator-gui-channel.js') + read('src/system/operator-gui-channel-geometry.js')
		assert.match(src, /function resolveCellSourceChannel/)
		assert.doesNotMatch(src, /WO-256/, 'confirms this WO made no server-side edits')
	})
})

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
		const src = read('client/components/operator-compose-tiles.js')
		assert.match(src, /const t = \{ def, frac, px: null, pxDesired: null,/, 'tile now has px and pxDesired fields')
	})

	it('layoutTileDom derives px from frac on first layout, then preserves px on subsequent calls', () => {
		const src = read('client/components/operator-compose-tiles.js')
		assert.match(src, /if \(!t\.px\) \{[\s\S]{0,200}t\.px = \{.*frac\.x.*cw.*\}/, 'derives px from frac if not set')
		assert.match(src, /const outer = \{ left: t\.px\.x, top: t\.px\.y, width: t\.px\.w, height: t\.px\.h \}/, 'uses px (not frac) for layout')
	})

	it('onDragMove and onDragEnd update both px and pxDesired when user resizes', () => {
		const src = read('client/components/operator-compose-tiles.js')
		assert.match(src, /t\.px = clamped[\s\S]{0,100}t\.pxDesired = \{ \.\.\.clamped \}/, 'both px and pxDesired updated on drag')
	})

	it('ResizeObserver calls onCanvasResize which preserves px and updates fractions', () => {
		const src = read('client/components/operator-compose-tiles.js')
		assert.match(src, /const ro = typeof ResizeObserver[\s\S]{0,50}new ResizeObserver\(onCanvasResize\)/, 'ResizeObserver uses onCanvasResize')
		assert.match(src, /function onCanvasResize\(\)[\s\S]{0,500}clampTileRect\(t\.pxDesired/, 'onCanvasResize preserves pxDesired, clamps to new size')
		assert.match(src, /newSize\.w.*newSize\.h.*minOuter\.width/, 'onCanvasResize receives new canvas size and clamps with minimum')
	})

	it('resetLayout clears px/pxDesired so they are re-derived from fresh fractions', () => {
		const src = read('client/components/operator-compose-tiles.js')
		assert.match(src, /function resetLayout\(\)[\s\S]{0,400}t\.px = null[\s\S]{0,100}t\.pxDesired = null/, 'reset clears px and pxDesired')
	})
})

/**
 * 2026-07-19 bug (owner: "after highascg restart the operator gui starts with a stale compose
 * preview layout and only comes back to the saved one when i trigger a look").
 *
 * PROVEN mechanism: the kiosk client builds the compose tile canvas BEFORE the WS `state` message
 * lands, so `channelMap` is still `{}`. preview-canvas-panel.js's `getComposeCellDefs` then yields
 * ONE provisional `pgm_1` def, `resolveTileLayout` legitimately defaults it to a single
 * full-canvas tile, and the resulting rect report OVERWRITES the multi-cell layout the server had
 * just re-applied from `operatorGuiLayout` persistence ("Operator GUI re-apply: 3 cell(s)
 * applied" -> "[Operator GUI] timing: first rect report cells=1" -> shape overlay down to 1 rect).
 *
 * These tests drive the REAL `initOperatorComposeTiles` against a minimal DOM stub (no jsdom in
 * this repo) so they fail if the pre-state suppression regresses.
 */
describe('2026-07-19 fix: a provisional (pre-state) render must never report rects', () => {
	const DEFAULT_CANVAS = { w: 1200, h: 700 }

	function px(v) {
		const n = parseFloat(String(v == null ? '0' : v))
		return Number.isFinite(n) ? n : 0
	}

	function makeEl(tag) {
		const el = {
			tagName: tag,
			className: '',
			textContent: '',
			title: '',
			type: '',
			disabled: false,
			dataset: {},
			style: {},
			children: [],
			parent: null,
			__h: {},
			classList: { add() {}, remove() {}, toggle() {} },
			appendChild(c) { c.parent = el; el.children.push(c); return c },
			append(...cs) { for (const c of cs) el.appendChild(c) },
			remove() { if (el.parent) el.parent.children = el.parent.children.filter((c) => c !== el); el.parent = null },
			addEventListener(type, fn) { (el.__h[type] = el.__h[type] || []).push(fn) },
			removeEventListener(type, fn) { el.__h[type] = (el.__h[type] || []).filter((f) => f !== fn) },
			fire(type, ev) { for (const fn of [...(el.__h[type] || [])]) fn(ev) },
			getBoundingClientRect() {
				let left = px(el.style.left)
				let top = px(el.style.top)
				for (let p = el.parent; p; p = p.parent) { left += px(p.style.left); top += px(p.style.top) }
				const width = el.style.width === undefined ? DEFAULT_CANVAS.w : px(el.style.width)
				const height = el.style.height === undefined ? DEFAULT_CANVAS.h : px(el.style.height)
				return { left, top, width, height, right: left + width, bottom: top + height }
			},
		}
		return el
	}

	/** Installs the DOM stub globals, runs `fn(harness)`, restores the globals unconditionally. */
	function withFakeDom(fn) {
		const saved = {}
		for (const k of ['document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'ResizeObserver', 'IntersectionObserver']) {
			saved[k] = Object.prototype.hasOwnProperty.call(globalThis, k) ? globalThis[k] : undefined
		}
		const rafQueue = []
		const docHandlers = {}
		const store = new Map()
		globalThis.document = {
			createElement: (tag) => makeEl(tag),
			addEventListener(type, f) { (docHandlers[type] = docHandlers[type] || []).push(f) },
			removeEventListener(type, f) { docHandlers[type] = (docHandlers[type] || []).filter((x) => x !== f) },
			dispatchEvent() {},
		}
		globalThis.window = { innerWidth: 1920, innerHeight: 1080, addEventListener() {}, removeEventListener() {} }
		globalThis.requestAnimationFrame = (f) => { rafQueue.push(f); return rafQueue.length }
		globalThis.cancelAnimationFrame = () => {}
		globalThis.localStorage = {
			getItem: (k) => (store.has(k) ? store.get(k) : null),
			setItem: (k, v) => { store.set(k, String(v)) },
		}
		delete globalThis.ResizeObserver
		delete globalThis.IntersectionObserver
		try {
			return fn({
				flushRaf: () => { while (rafQueue.length) rafQueue.shift()() },
				fireDoc: (type, ev) => { for (const f of [...(docHandlers[type] || [])]) f(ev) },
				storage: store,
			})
		} finally {
			for (const [k, v] of Object.entries(saved)) {
				if (v === undefined) delete globalThis[k]
				else globalThis[k] = v
			}
		}
	}

	/** Mirrors client/lib/state-store.js: a full `setState` emits ONLY '*', never 'channelMap'. */
	function makeStore(initialChannelMap) {
		const listeners = new Map()
		let state = initialChannelMap ? { channelMap: initialChannelMap } : {}
		return {
			getState: () => state,
			on(key, fn) {
				if (!listeners.has(key)) listeners.set(key, [])
				listeners.get(key).push(fn)
				return () => { listeners.set(key, (listeners.get(key) || []).filter((f) => f !== fn)) }
			},
			/** WS 'state' arrival — StateStore.setState() emits '*' only. */
			setFullState(channelMap) {
				state = { channelMap }
				for (const fn of listeners.get('*') || []) fn('*', null)
			},
		}
	}

	/** Mirrors preview-canvas-panel.js's `getComposeCellDefs` for the compose toggle path. */
	function defsFromChannelMap(cm) {
		const map = cm || {}
		const screenCount = Math.max(1, map.screenCount || 1)
		const out = []
		for (let i = 0; i < screenCount; i++) {
			out.push({ id: `pgm_${i + 1}`, role: 'pgm', mainIndex: i })
			const prvCh = map.previewChannels?.[i] ?? null
			if (map.previewEnabledByMain?.[i] !== false && prvCh != null) out.push({ id: `prv_${i + 1}`, role: 'prv', mainIndex: i })
		}
		return out
	}

	const REAL_CM = {
		screenCount: 3,
		programChannels: [1, 2, 3],
		previewChannels: [null, null, null],
		previewEnabledByMain: [false, false, false],
	}

	it('hasResolvedChannelState: {} is provisional, a server-built channelMap is real', () => {
		const { hasResolvedChannelState } = require('../../client/components/operator-compose-tiles.js')
		assert.equal(hasResolvedChannelState(null), false)
		assert.equal(hasResolvedChannelState({}), false, 'the pre-WS-state channelMap is NOT real state')
		assert.equal(hasResolvedChannelState({ screenCount: 0 }), false)
		assert.equal(hasResolvedChannelState(REAL_CM), true)
		assert.equal(hasResolvedChannelState({ programChannels: [1, 2] }), true, 'programChannels alone is enough')
	})

	it('pre-state render builds tiles but reports NOTHING (the single provisional tile never reaches the wire)', () => {
		withFakeDom(({ flushRaf }) => {
			const { initOperatorComposeTiles } = require('../../client/components/operator-compose-tiles.js')
			const reports = []
			const stateStore = makeStore(null)
			const handle = initOperatorComposeTiles(makeEl('div'), {
				getComposeCellDefs: () => defsFromChannelMap(stateStore.getState().channelMap),
				stateStore,
				onCellRects: (cells) => reports.push(cells),
			})
			flushRaf()
			assert.equal(defsFromChannelMap(stateStore.getState().channelMap).length, 1, 'pre-state defs really are the single provisional pgm_1 tile')
			assert.deepEqual(reports, [], 'no report at all while the channelMap is still empty')
			handle.destroy()
			assert.deepEqual(reports, [], 'destroy of a never-ready canvas must not send an empty withdrawal either')
		})
	})

	it('post-state render DOES report, with every cell of the real screen set', () => {
		withFakeDom(({ flushRaf }) => {
			const { initOperatorComposeTiles } = require('../../client/components/operator-compose-tiles.js')
			const reports = []
			const stateStore = makeStore(REAL_CM)
			initOperatorComposeTiles(makeEl('div'), {
				getComposeCellDefs: () => defsFromChannelMap(stateStore.getState().channelMap),
				stateStore,
				onCellRects: (cells) => reports.push(cells),
			})
			flushRaf()
			assert.equal(reports.length, 1, 'exactly one report once state is already present')
			assert.deepEqual(reports[0].map((c) => c.id), ['pgm_1', 'pgm_2', 'pgm_3'])
			for (const c of reports[0]) assert.ok(c.rect.width > 0 && c.rect.height > 0, 'real non-empty rects')
		})
	})

	it('boot sequence: a saved 3-cell layout survives the provisional window and is the FIRST thing reported', () => {
		withFakeDom(({ flushRaf, storage }) => {
			const { initOperatorComposeTiles } = require('../../client/components/operator-compose-tiles.js')
			// Operator's saved layout from the previous session, keyed by screen count (3).
			const saved = {
				pgm_1: { x: 0.02, y: 0.1, w: 0.3, h: 0.35 },
				pgm_2: { x: 0.35, y: 0.1, w: 0.3, h: 0.35 },
				pgm_3: { x: 0.68, y: 0.1, w: 0.3, h: 0.35 },
			}
			storage.set(layoutStorageKey('casparcg_preview', 3), JSON.stringify(saved))

			const reports = []
			const stateStore = makeStore(null) // kiosk boots: WS state has NOT arrived yet
			initOperatorComposeTiles(makeEl('div'), {
				getComposeCellDefs: () => defsFromChannelMap(stateStore.getState().channelMap),
				stateStore,
				onCellRects: (cells) => reports.push(cells),
			})
			flushRaf()
			assert.deepEqual(reports, [], 'provisional window: server keeps its re-applied layout')

			// WS 'state' lands. StateStore.setState emits ONLY '*' — the fix must latch on that.
			stateStore.setFullState(REAL_CM)
			flushRaf()

			assert.ok(reports.length >= 1, 'reports resume once real state arrives')
			assert.deepEqual(reports[0].map((c) => c.id), ['pgm_1', 'pgm_2', 'pgm_3'], 'FIRST report on the wire is the full saved 3-cell set, never a 1-cell shrink')
			const first = reports[0]
			// Saved fractions, not the default layout (which is one FULL-WIDTH row per screen at x=0).
			const savedLeft = saved.pgm_1.x * DEFAULT_CANVAS.w
			assert.ok(first[0].rect.left >= savedLeft && first[0].rect.left < savedLeft + 12, 'restored from the saved layout, not re-defaulted')
			assert.ok(first[0].rect.width < DEFAULT_CANVAS.w * 0.5, 'saved narrow tiles, not the full-width default row')
			assert.ok(first[1].rect.left > first[0].rect.left, 'saved side-by-side arrangement preserved')
		})
	})

	it('a genuine operator tile MOVE still reports immediately after state is ready', () => {
		withFakeDom(({ flushRaf, fireDoc }) => {
			const { initOperatorComposeTiles } = require('../../client/components/operator-compose-tiles.js')
			const reports = []
			const container = makeEl('div')
			const stateStore = makeStore(REAL_CM)
			initOperatorComposeTiles(container, {
				getComposeCellDefs: () => defsFromChannelMap(stateStore.getState().channelMap),
				stateStore,
				onCellRects: (cells) => reports.push(cells),
			})
			flushRaf()
			const before = reports.length
			// Default layout = one full-width row per screen, so the only free axis is vertical.
			const startTop = reports[before - 1][0].rect.top

			// The footer strip is the drag handle (operator grabs a tile and moves it right+down).
			const root = container.children[0]
			const tileEl = root.children.find((c) => c.className === 'operator-tile')
			const footerEl = tileEl.children.find((c) => c.className === 'operator-tile__footer')
			footerEl.fire('pointerdown', {
				button: 0, clientX: 100, clientY: 100, pointerId: 1,
				preventDefault() {}, stopPropagation() {}, target: { setPointerCapture() {} },
			})
			fireDoc('pointermove', { clientX: 260, clientY: 180 })
			flushRaf()
			assert.ok(reports.length > before, 'mid-drag reports still fire LIVE (WO-263 holes track the box)')
			assert.ok(reports[reports.length - 1][0].rect.top > startTop, 'the moved rect is what got reported')

			const midCount = reports.length
			fireDoc('pointerup', {})
			assert.equal(reports.length, midCount + 1, 'drag end reports the final settled rect immediately, no debounce')
		})
	})
})

describe('2026-07-19 fix: recovery re-sends never assert an EMPTY layout (boot DELETE clobber)', () => {
	it('operator-gui-mode.js resendMergedNow bails when no surface has reported yet', () => {
		const src = read('client/lib/operator-gui-mode.js')
		const fn = src.match(/function resendMergedNow\(\)[\s\S]*?\n\}/)[0]
		assert.match(fn, /if \(!_bySurface\.size\) return/, 'reconnect/nudge/heartbeat must not DELETE the server-restored layout at boot')
	})

	it('genuine withdrawals still go through their own immediate paths (not via resendMergedNow)', () => {
		const src = read('client/lib/operator-gui-mode.js')
		assert.match(src, /function reportSurfaceCells\([\s\S]{0,300}_bySurface\.delete\(surface\)[\s\S]{0,80}scheduleReport\(\)/)
		assert.match(src, /_suppressed = true[\s\S]{0,200}void sendLayout\(\[\]\)/, 'popup suppression still sends empty immediately')
	})
})
