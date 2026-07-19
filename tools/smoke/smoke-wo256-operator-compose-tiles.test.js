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
		assert.match(src, /onCellRects\(cellRects\)\s*\n[\s\S]{0,200}posWatch\.update\(\)/, 're-hug happens after each rect report')
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
		const src = read('src/system/operator-gui-channel.js')
		assert.match(src, /function resolveCellSourceChannel/)
		assert.doesNotMatch(src, /WO-256/, 'confirms this WO made no server-side edits')
	})
})
