'use strict'

/**
 * WO-256 smoke — Operator-GUI compose preview becomes a free-tile canvas (multiviewer-style
 * movable/resizable windows). Covers: T256.1 (chrome/body geometry, persistence pure logic —
 * default-layout math itself lives in the -layout.test.js sibling), T256.5 (this file plus its
 * split siblings, registered in the curated gate).
 *
 * Line-count refactor split this file (originally 1061 lines) into topical siblings, all still
 * registered in tools/ci/run-offline-tests.js's curated FILES array:
 *   - smoke-wo256-operator-compose-tiles-layout.test.js: T256.1 default-layout math
 *   - smoke-wo256-operator-compose-tiles-wiring.test.js: T256.2/T256.4 source-grep wiring checks,
 *     CSS, the position-watch re-report fix, the no-server-changes check, boot-recovery guard
 *   - smoke-wo256-operator-compose-tiles-resize.test.js: todos19.07.26 canvas-resize px/pxDesired fix
 *   - smoke-wo256-operator-compose-tiles-boot-state.test.js: 2026-07-19 provisional-render fix
 * This file keeps T256.1's chrome/body geometry invariants and layout persistence.
 *
 * client/components/operator-compose-tiles.js is plain ESM (import/export) but has no top-level
 * DOM/browser-global access — every exported pure function below is safe to `require()` directly
 * under plain node:test (Node's require(esm) support), same pattern already used by
 * tools/smoke/smoke-wo250-timer-bank-mv-bars.test.js for client/components/playback-timer.js.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

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
const { readOperatorComposeTiles } = require('./lib/operator-compose-tiles-read.js')

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
		const src = readOperatorComposeTiles()
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
