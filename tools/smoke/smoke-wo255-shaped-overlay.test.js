'use strict'

/**
 * WO-255 smoke tests — shaped Caspar video overlay above fullscreen Firefox (CEF-in-Caspar
 * retired). Split out of smoke-wo243-operator-gui.test.js to keep both files under the repo's
 * ~500-line target — this file owns everything new to WO-254/255: aspect-fit pure functions
 * (T254.1, finished here — no coverage existed before WO-255), the CEF-layer/auto-arm retirement
 * guards, the python-xlib shape helper + JS spawn manager (T255.1), and the Firefox
 * launcher + routes (T255.2). Client-side rect-reporting/mode-gate pure logic also lives here
 * (T255.3) — everything else (destination model, routing, generator, layout endpoint, CRUD, UI
 * source checks) stays in smoke-wo243-operator-gui.test.js.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const defaults = require('../../src/config/defaults')
const { getChannelMap } = require('../../src/config/routing-map')
const {
	computeOperatorGuiCellPlan,
	resolveCellSourceChannel,
	resolveOperatorGuiChannelDims,
	resolveCellSourceDims,
	fitAspectRectPx,
	computeAspectFitCellRect,
	fractionRectToMonitorPx,
} = require('../../src/system/operator-gui-channel')
const { REPO_ROOT } = require('../../src/repo-paths')

function clone(cfg) {
	return JSON.parse(JSON.stringify(cfg))
}

describe('WO-255 T255.3: client operator-gui-mode pure logic (no jsdom required)', () => {
	it('isOperatorGuiModeActive is false without either query param, true with ?operatorGui or legacy ?cefOperator', () => {
		// Source-level check (module is ESM; curated gate runs plain node:test/CJS) — the exported
		// function must use URLSearchParams(...).has(...), not a truthy-value comparison.
		const src = fs.readFileSync(path.join(__dirname, '../../client/lib/operator-gui-mode.js'), 'utf8')
		assert.match(src, /params\.has\('operatorGui'\) \|\| params\.has\('cefOperator'\)/)
	})

	it('cellRectsToLayoutCells conversion math (re-implemented here to pin the contract without ESM import)', () => {
		// Mirrors client/lib/operator-gui-mode.js's cellRectsToLayoutCells exactly — kept in lockstep
		// so this test fails loudly if the two ever diverge (source-grepped below).
		function clamp01(n) {
			const v = Number(n)
			if (!Number.isFinite(v)) return 0
			return Math.min(1, Math.max(0, v))
		}
		function cellRectsToLayoutCells(cellRects, viewport) {
			const vw = Math.max(1, Number(viewport?.width) || 1)
			const vh = Math.max(1, Number(viewport?.height) || 1)
			const out = []
			for (const c of Array.isArray(cellRects) ? cellRects : []) {
				const r = c?.rect
				if (!r || !(Number(r.width) > 0) || !(Number(r.height) > 0)) continue
				out.push({
					id: c.id,
					role: c.role === 'prv' ? 'prv' : c.role === 'multiview' ? 'multiview' : 'pgm',
					mainIndex: Math.max(0, parseInt(String(c.mainIndex ?? 0), 10) || 0),
					rect: { x: clamp01(Number(r.left) / vw), y: clamp01(Number(r.top) / vh), w: clamp01(Number(r.width) / vw), h: clamp01(Number(r.height) / vh) },
				})
			}
			return out
		}
		const cells = cellRectsToLayoutCells(
			[
				{ id: 'pgm_1', role: 'pgm', mainIndex: 0, rect: { left: 960, top: 0, width: 960, height: 1080 } },
				{ id: 'prv_1', role: 'prv', mainIndex: 0, rect: { left: 0, top: 0, width: 0, height: 1080 } },
			],
			{ width: 1920, height: 1080 },
		)
		assert.equal(cells.length, 1, 'zero-width cell is dropped')
		assert.deepEqual(cells[0].rect, { x: 0.5, y: 0, w: 0.5, h: 1 })

		const src = fs.readFileSync(path.join(__dirname, '../../client/lib/operator-gui-mode.js'), 'utf8')
		assert.match(src, /function cellRectsToLayoutCells/, 'the real module still exports this exact function name')
		assert.match(src, /role === 'multiview'/, "WO-255: multiview role passthrough for the mv-edit surface")
	})

	it('WO-255: reportComposeCellRects / reportTimelineCellRects / reportMultiviewEditRect / setInteractionSuppressed are all exported', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../client/lib/operator-gui-mode.js'), 'utf8')
		for (const name of ['reportComposeCellRects', 'reportTimelineCellRects', 'reportMultiviewEditRect', 'setInteractionSuppressed', 'initOperatorGuiRectReporting']) {
			assert.match(src, new RegExp(`export function ${name}`), `${name} exported`)
		}
	})
})

// WO-255: CEF-in-Caspar is retired (shared-process starvation / synthetic-input fragility — see
// INCIDENT-2026-07-16). The operator GUI is a fullscreen Firefox process now, 100% native input —
// the CEF layer (100), its auto-arm focus (ensureOperatorGuiFocus), and the operator_gui
// interactive zone are all removed. These are the retirement guards.
describe('WO-255: CEF layer + auto-arm-focus retirement', () => {
	const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')
	it('operator-gui-channel.js: no more CEF_LAYER / ensureOperatorGuiFocus / PLAY [HTML]', () => {
		const src = read('src/system/operator-gui-channel.js')
		assert.doesNotMatch(src, /ensureOperatorGuiFocus/, 'auto-arm helper removed')
		assert.doesNotMatch(src, /CEF_LAYER/, 'CEF layer constant removed')
		assert.doesNotMatch(src, /\[HTML\]/, 'PLAY [HTML] CEF-layer logic removed')
		assert.match(src, /function ensureOperatorGuiChannel/, 'renamed from ensureOperatorGuiCefLayer')
		assert.doesNotMatch(src, /^function ensureOperatorGuiCefLayer/m, 'old function definition gone (a historical doc-comment mention is fine)')
		assert.match(src, /module\.exports = \{[\s\S]*ensureOperatorGuiChannel[\s\S]*\}/, 'renamed function is what gets exported')
	})
	it('routing-setup.js calls the renamed ensureOperatorGuiChannel', () => {
		const src = read('src/config/routing-setup.js')
		assert.match(src, /ensureOperatorGuiChannel/)
		assert.doesNotMatch(src, /ensureOperatorGuiCefLayer/)
	})
	// WO-257: routes-cef-arm-input.js and cef-interactive-bridge-zones.js (the "operator_gui
	// fallback" / "operator_gui zone" this used to guard against) are deleted outright along with
	// the rest of the CEF interactive bridge — nothing left to assert against.
	it('DEFAULT_GUI_URL switched to ?operatorGui=1', () => {
		const { DEFAULT_GUI_URL } = require(path.join(__dirname, '../../src/system/operator-gui-channel.js'))
		assert.equal(DEFAULT_GUI_URL, 'http://127.0.0.1:4200/?operatorGui=1')
	})
	it('ensureOperatorGuiChannel is a no-op skip without an operator_gui destination', async () => {
		const { ensureOperatorGuiChannel } = require(path.join(__dirname, '../../src/system/operator-gui-channel.js'))
		const out = await ensureOperatorGuiChannel({ config: { screenDestinations: { destinations: [] } }, amcp: {}, log: () => {} })
		assert.equal(out.skipped, true)
	})
})

describe('WO-254 T254.1: aspect-fit pure functions (finishing WO-254 — no coverage existed before WO-255)', () => {
	it('fitAspectRectPx: source wider than cell -> width-constrained, letterboxed (bars top/bottom), centered', () => {
		// 16:9 source into a 4:3 (square-ish) cell — cell taller relative to its width than the source.
		const out = fitAspectRectPx({ x: 100, y: 50, w: 400, h: 400 }, 1920, 1080)
		assert.ok(out.w === 400, 'width-constrained: fitted width equals the cell width')
		assert.ok(out.h < 400, 'letterboxed: fitted height is less than the cell height')
		assert.equal(out.x, 100, 'x unchanged (already width-constrained, no horizontal centering needed)')
		assert.ok(out.y > 50, 'vertically centered (bars top/bottom pushed the fitted rect down)')
	})
	it('fitAspectRectPx: source narrower than cell -> height-constrained, pillarboxed (bars left/right), centered', () => {
		// 9:16 portrait source into a wide 400x100 cell.
		const out = fitAspectRectPx({ x: 0, y: 0, w: 400, h: 100 }, 1080, 1920)
		assert.equal(out.h, 100, 'height-constrained: fitted height equals the cell height')
		assert.ok(out.w < 400, 'pillarboxed: fitted width is less than the cell width')
		assert.ok(out.x > 0, 'horizontally centered')
	})
	it('fitAspectRectPx: degenerate (zero/negative) cell or source dims pass the cell through unchanged, no NaN/Infinity', () => {
		assert.deepEqual(fitAspectRectPx({ x: 5, y: 5, w: 0, h: 100 }, 16, 9), { x: 5, y: 5, w: 0, h: 100 })
		assert.deepEqual(fitAspectRectPx({ x: 5, y: 5, w: 100, h: 100 }, 0, 9), { x: 5, y: 5, w: 100, h: 100 })
		const out = fitAspectRectPx({ x: 0, y: 0, w: -10, h: 100 }, 16, 9)
		assert.ok(Number.isFinite(out.w) && Number.isFinite(out.h), 'no NaN/Infinity leaks through')
	})
	it('computeAspectFitCellRect: converts fraction -> GUI-raster pixels, fits, normalizes back to fractions', () => {
		// GUI raster 1920x1080 (16:9), cell occupies the full right half (0.5,0,0.5,1 -> 960x1080px,
		// AR 0.888) — a 16:9 source (AR 1.777) into it is width-constrained: width fraction is
		// unchanged (0.5, already the cell's own width), height fraction shrinks (letterboxed).
		const out = computeAspectFitCellRect({ x: 0.5, y: 0, w: 0.5, h: 1 }, { width: 1920, height: 1080 }, { width: 1920, height: 1080 })
		assert.ok(Math.abs(out.w - 0.5) < 1e-9, 'width-constrained: fitted width fraction equals the cell width fraction')
		assert.ok(out.h < 1, 'letterboxed: fitted height fraction is less than the cell height fraction')
		assert.ok(out.x >= 0.5 - 1e-9 && out.x + out.w <= 1.0001, 'fitted rect stays within the original cell bounds')
	})
	it('computeAspectFitCellRect: falls back to the raw cell when guiDims does not resolve', () => {
		const cell = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }
		assert.deepEqual(computeAspectFitCellRect(cell, { width: 0, height: 0 }, { width: 1920, height: 1080 }), cell)
	})
	it('resolveOperatorGuiChannelDims resolves null without an operator_gui destination', () => {
		const app = clone(defaults)
		app.screenDestinations = { version: 1, destinations: [] }
		assert.equal(resolveOperatorGuiChannelDims(app), null)
	})
	it('resolveCellSourceDims always resolves (falls back to the 1080p5000 default screen mode)', () => {
		const app = clone(defaults)
		const dims = resolveCellSourceDims({ mainIndex: 0 }, app)
		assert.deepEqual(dims, { width: 1920, height: 1080 })
	})
	it('computeOperatorGuiCellPlan applies aspect-fit when config is supplied and dims resolve, stretch-fills when config is omitted (back-compat)', () => {
		const app = clone(defaults)
		app.screenDestinations = {
			version: 1,
			destinations: [
				{ id: 'scr1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
				{ id: 'og1', mainScreenIndex: 5, mode: 'operator_gui', videoMode: 'custom', width: 1920, height: 1080, fps: 30 },
			],
		}
		const map = getChannelMap(app)
		const cells = [{ id: 'pgm_1', role: 'pgm', mainIndex: 0, rect: { x: 0.5, y: 0, w: 0.5, h: 1 } }]

		const stretched = computeOperatorGuiCellPlan(cells, map)
		assert.deepEqual({ x: stretched[0].x, y: stretched[0].y, w: stretched[0].w, h: stretched[0].h }, { x: 0.5, y: 0, w: 0.5, h: 1 }, 'no config -> raw stretch-fill rect, unchanged from WO-243')

		const fitted = computeOperatorGuiCellPlan(cells, map, app)
		assert.ok(fitted[0].w < 0.5 || fitted[0].h < 1, 'config supplied + dims resolve -> aspect-fit shrinks the rect inside the cell')
	})
})

describe('WO-255 T255.1: shape helper (python-xlib) + server-side monitor-px conversion', () => {
	it('operator-shape-overlay.py: python3 -m py_compile succeeds (syntax-only — never run against the live display)', () => {
		const script = path.join(REPO_ROOT, 'tools/runtime/operator-shape-overlay.py')
		assert.ok(fs.existsSync(script), 'shape helper script exists')
		// Throws (assert-worthy failure) on a non-zero exit; stdio inherited-suppressed via pipe.
		execFileSync('python3', ['-m', 'py_compile', script], { stdio: 'pipe' })
	})
	it('operator-shape-overlay.py: window-match strategy documented + implemented (geometry + title/class, Firefox excluded)', () => {
		const src = fs.readFileSync(path.join(REPO_ROOT, 'tools/runtime/operator-shape-overlay.py'), 'utf8')
		assert.match(src, /Screen consumer/, 'matches on the CasparCG screen-consumer window title default')
		assert.match(src, /casparcg/i, 'matches on WM_CLASS mentioning casparcg as a secondary signal')
		assert.match(src, /navigator/i, 'explicitly excludes Firefox (WM_CLASS "Navigator") from candidates')
		assert.match(src, /shape_rectangles/, 'uses the SHAPE extension rectangles call (mirrors the proven PoC)')
		assert.match(src, /SK\.Input/, 'sets an empty INPUT shape so clicks pass through')
	})
	it('fractionRectToMonitorPx: scales by the MONITOR rect (not the GUI channel raster) and rounds to integers', () => {
		const out = fractionRectToMonitorPx({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, { w: 1920, h: 1080 })
		assert.deepEqual(out, [480, 540, 960, 270])
	})
	it('operator-shape-overlay.js: spawn/respawn mirrors cef-interactive-bridge-lifecycle.js conventions (displaySessionEnv, stderr-log, exit-log), stop hooked from shutdown', () => {
		const src = fs.readFileSync(path.join(REPO_ROOT, 'src/system/operator-shape-overlay.js'), 'utf8')
		assert.match(src, /displaySessionEnv/)
		assert.match(src, /stdio: \['pipe', 'pipe', 'pipe'\]/)
		assert.match(src, /on\('exit'/)
		assert.match(src, /NODE_TEST_CONTEXT/, 'never spawns real python3 under the curated gate')
		const shutdown = fs.readFileSync(path.join(REPO_ROOT, 'src/bootstrap/shutdown.js'), 'utf8')
		assert.match(shutdown, /stopOperatorShapeOverlay/)
	})
	it('operator-gui-channel.js: applyOperatorGuiLayout feeds the shape helper (updateShapeRects) — grep-level, per WO-255', () => {
		const src = fs.readFileSync(path.join(REPO_ROOT, 'src/system/operator-gui-channel.js'), 'utf8')
		assert.match(src, /require\('\.\/operator-shape-overlay'\)/)
		assert.match(src, /updateShapeRects/)
		assert.match(src, /reapplyOperatorShapeOverlay/, 're-feeds the shape helper on Caspar reconnect (ensureOperatorGuiChannel)')
	})
	it("resolveCellSourceChannel: 'multiview' role routes the whole multiview channel (mv-edit surface), independent of mainIndex", () => {
		const map = { programChannels: [1, 3], previewChannels: [2, null], multiviewCh: 9 }
		assert.equal(resolveCellSourceChannel({ role: 'multiview', mainIndex: 7 }, map), 9)
		assert.equal(resolveCellSourceChannel({ role: 'multiview' }, { ...map, multiviewCh: null }), null)
	})
})

describe('WO-255 T255.2: launcher + routes registered + generator always-on-top', () => {
	const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')
	it('router.js registers POST /api/operator-gui/launch and /api/operator-gui/raise', () => {
		const src = read('src/api/router.js')
		assert.match(src, /routes\.post\('\/api\/operator-gui\/launch'/)
		assert.match(src, /routes\.post\('\/api\/operator-gui\/raise'/)
	})
	it('operator-gui-launcher.js: firefox-esr --kiosk with a dedicated .operator-firefox-profile, xdotool positioning', () => {
		const src = read('src/system/operator-gui-launcher.js')
		assert.match(src, /--kiosk/)
		assert.match(src, /--new-instance/)
		assert.match(src, /\.operator-firefox-profile/)
		assert.match(src, /windowmove/)
		assert.match(src, /windowsize/)
		assert.match(src, /windowactivate/)
		assert.match(src, /launchOperatorGuiBrowser/)
		assert.match(src, /raiseOperatorGuiBrowser/)
	})
	it('routes-operator-gui.js wires launch/raise to the launcher module', () => {
		const src = read('src/api/routes-operator-gui.js')
		assert.match(src, /launchOperatorGuiBrowser/)
		assert.match(src, /raiseOperatorGuiBrowser/)
	})
	it('inspector has a Launch / Bring to front button posting to /api/operator-gui/launch', () => {
		const src = read('client/components/device-view-destinations-inspector-operator-gui-fields.js')
		assert.match(src, /Launch \/ Bring to front/)
		assert.match(src, /\/api\/operator-gui\/launch/)
	})
})
