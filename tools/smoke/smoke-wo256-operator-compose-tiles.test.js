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
	minOuterSize,
	tileBodyRectFromOuter,
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

	it('3 screens, one with no PRV (pgm-only row) -> that row is a single full-width cell', () => {
		const defs = [
			{ id: 'pgm_1', role: 'pgm', mainIndex: 0 },
			{ id: 'prv_1', role: 'prv', mainIndex: 0 },
			{ id: 'pgm_2', role: 'pgm', mainIndex: 1 }, // no PRV for screen 2 (previewEnabledByMain false)
			{ id: 'pgm_3', role: 'pgm', mainIndex: 2 },
			{ id: 'prv_3', role: 'prv', mainIndex: 2 },
		]
		const layout = computeDefaultTileLayout(defs)
		const rowH = 1 / 3
		assert.deepEqual(layout.pgm_2, { x: 0, y: rowH, w: 1, h: rowH }, 'lone PGM fills its whole row')
		assert.ok(Math.abs(layout.prv_3.y - rowH * 2) < 1e-9, 'third screen is the third row')
	})

	it('empty defs -> empty layout, no NaN/crash', () => {
		assert.deepEqual(computeDefaultTileLayout([]), {})
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

	it('mounts operator-compose-tiles.js only when the gate is active, destroys it on panel teardown', () => {
		assert.match(src, /import \{ initOperatorComposeTiles \} from '\.\/operator-compose-tiles\.js'/)
		assert.match(src, /operatorTilesActive\s*\n?\s*\?\s*initOperatorComposeTiles\(/)
		assert.match(src, /tilesHandle\?\.destroy\(\)/)
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
		assert.match(src, /cellRects\.push\(\{ id: t\.def\.id, role: t\.def\.role, mainIndex: t\.def\.mainIndex, rect \}\)/)
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
	it('CSS defines the tile chrome classes with the border-box invariant that keeps border off the body', () => {
		const css = read('client/styles/10b-operator-compose-tiles.css')
		assert.match(css, /\.operator-tile\s*\{[^}]*box-sizing:\s*border-box/)
		assert.match(css, /\.operator-tile__body/)
		// WO-263: chrome moved BELOW the video — the screen-label row lives in the footer now.
		assert.match(css, /\.operator-tile__label/)
		assert.match(css, /\.operator-tile__footer/)
	})
})

describe('WO-256: server needs no changes — operator-gui-channel.js already accepts arbitrary role/mainIndex/rect cells', () => {
	it('resolveCellSourceChannel branches only on role + mainIndex, not on rect position/size/count (grep-level, source unchanged by this WO)', () => {
		const src = read('src/system/operator-gui-channel.js')
		assert.match(src, /function resolveCellSourceChannel/)
		assert.doesNotMatch(src, /WO-256/, 'confirms this WO made no server-side edits')
	})
})
