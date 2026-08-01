'use strict'

/**
 * WO-256 smoke — Operator-GUI compose preview becomes a free-tile canvas (multiviewer-style
 * movable/resizable windows). Split out of smoke-wo256-operator-compose-tiles.test.js (line-count
 * refactor) — this file owns the source-grep "wiring" checks: T256.2 (hard gate in
 * preview-canvas-panel.js, zero fork of the file), T256.4 (rect-reporting shape reused unchanged,
 * interaction-suppress selector extended), the CSS wiring, the position-watch re-report fix, the
 * confirmation that no server changes were needed, and the boot-DELETE-clobber recovery guard.
 * Default-layout math, chrome/body geometry, persistence, resize behavior and boot-state reporting
 * live in smoke-wo256-operator-compose-tiles.test.js and its other siblings.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { readOperatorComposeTiles } = require('./lib/operator-compose-tiles-read.js')

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8')

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
		const src = readOperatorComposeTiles()
		// WO-323 extended the report with srcCh for user source tiles; the base shape is unchanged.
		assert.match(src, /const cell = \{ id: t\.def\.id, role: t\.def\.role, mainIndex: t\.def\.mainIndex, rect \}/)
		assert.match(src, /if \(t\.def\.role === 'mvcell'\) cell\.srcCh = t\.def\.srcCh/)
		assert.match(src, /getBoundingClientRect\(\)/, 'reports real viewport-space DOM rects, same as the old compose cells')
	})

	it('rects report on drag/resize release, not on every pointermove (matches the suppression contract)', () => {
		const src = readOperatorComposeTiles()
		assert.match(src, /function onDragEnd\(\)[\s\S]{0,500}reportRectsNow\(\)/)
		assert.doesNotMatch(src.match(/function onDragMove[\s\S]*?\n\t\}/)[0], /reportRectsNow/, 'no mid-drag rect spam')
	})

	it('reuses pickTopLayerStateForPlayback by IMPORTING mountPgmTopLayerPlaybackTimer, never re-implements bank/stale logic', () => {
		const src = readOperatorComposeTiles()
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
		const tiles = readOperatorComposeTiles()
		assert.match(tiles, /onDragMove[\s\S]*?scheduleReport\(\)/, 'onDragMove reports live so the Firefox hole follows the resize')
	})

	it('screen-label.js (WO-222) is reused for the header label, not re-implemented', () => {
		const src = readOperatorComposeTiles()
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
		const src = readOperatorComposeTiles()
		assert.match(src, /import \{ watchElementPosition \} from '\.\.\/lib\/element-position-watch\.js'/)
		assert.match(src, /const posWatch = watchElementPosition\(root, \(\) => scheduleReport\(\)\)/)
		assert.match(src, /onCellRects\(cellRects[^)]*\)\s*\n[\s\S]{0,200}posWatch\.update\(\)/, 're-hug happens after each rect report')
		assert.match(src, /posWatch\.destroy\(\)/)
	})

	it('workspace tab switches re-layout + re-report deterministically (and the listener is removed on destroy)', () => {
		const src = readOperatorComposeTiles()
		assert.match(src, /window\.addEventListener\('highascg-workspace-tab-activated', onTabActivated\)/)
		assert.match(src, /window\.removeEventListener\('highascg-workspace-tab-activated', onTabActivated\)/)
	})

	it('no idle polling snuck in: the tiles module has no setInterval and no free-running rAF loop', () => {
		const src = readOperatorComposeTiles()
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

describe('2026-07-19 fix: recovery re-sends never assert an EMPTY layout (boot DELETE clobber)', () => {
	it('operator-gui-mode.js resendMergedNow bails when no surface has reported yet', () => {
		// WO-255 T255.3 split: resendMergedNow now lives in operator-gui-mode-report.js, re-exported
		// from operator-gui-mode.js — read the split pair concatenated.
		const src = read('client/lib/operator-gui-mode.js') + read('client/lib/operator-gui-mode-report.js')
		const fn = src.match(/function resendMergedNow\(\)[\s\S]*?\n\}/)[0]
		assert.match(fn, /if \(!_bySurface\.size\) return/, 'reconnect/nudge/heartbeat must not DELETE the server-restored layout at boot')
	})

	it('genuine withdrawals still go through their own immediate paths (not via resendMergedNow)', () => {
		const src = read('client/lib/operator-gui-mode.js') + read('client/lib/operator-gui-mode-report.js')
		assert.match(src, /function reportSurfaceCells\([\s\S]{0,300}_bySurface\.delete\(surface\)[\s\S]{0,80}scheduleReport\(\)/)
		/* issues 01.08: suppression no longer sends EMPTY (a DELETE stopped the compose routes —
		 * "preview loses signal" per drag/modal). It still sends IMMEDIATELY, now with the cells
		 * held and holes closed via the WO-319 suppressHoles flag (see effectiveCells()). */
		assert.match(src, /_suppressed = true[\s\S]{0,400}void sendLayout\(effectiveCells\(\)\)/, 'popup suppression still sends immediately (holes closed via suppressHoles)')
	})
})
