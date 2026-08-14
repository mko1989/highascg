'use strict'

/**
 * WO-529 smoke — "going between looks editor and timeline editor resets the compose preview to
 * either nothing inside of it or just one small rect showing" (owner, 14.08.2026).
 *
 * Two independent faults, one per symptom. Both are pinned here.
 *
 * FAULT 1 ("nothing inside of it") — the surface handoff went through an empty set.
 *   A workspace tab switch is TWO reports in the same frame: the outgoing editor's pane is
 *   `display:none`, so every getBoundingClientRect is 0, cellRectsToLayoutCells filters them all
 *   and that surface withdraws; then the incoming editor reports its own cells. The old
 *   scheduleReport put the withdrawal on the LEADING edge, so the intermediate empty set went on
 *   the wire — and an empty POST is a DELETE, i.e. clearOperatorGuiLayout ->
 *   _doApplyOperatorGuiLayout(ctx, ch, []), which STOPs + MIXER CLEARs every route layer and
 *   empties the shape rects. Verified against the real module before the fix:
 *     POST, DELETE, POST   (pre-fix)      vs      POST, POST   (post-fix)
 *
 * FAULT 2 ("just one small rect showing") — a hidden pane's 0x0 ResizeObserver observation was
 *   treated as a resize. canvasSize()'s Math.max(1, …) turns it into a 1x1 canvas, so every tile
 *   was clamped into 1x1: px collapsed to the minimum outer size at the origin and `frac` was
 *   rewritten from raw pixel counts. The tab-switch re-report (onTabActivated -> layoutAll) runs
 *   in the SAME task as the class toggle, while the restoring observation is still queued, so the
 *   surface came back punching minimum-size holes.
 *
 * Offline: no Caspar, no X, no kiosk. Fault 1 drives the REAL client module with a stubbed fetch;
 * fault 2 pins the guard in source and simulates the geometry decision.
 */

const { describe, it, before, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const { readOperatorComposeTiles } = require('./lib/operator-compose-tiles-read.js')

/* ------------------------------------------------------------------ fault 1 */

/** Minimal browser globals the client module chain (api-client -> api-origin) touches at call time. */
function installBrowserGlobals() {
	globalThis.location = {
		search: '?operatorGui=1',
		protocol: 'http:',
		port: '4200',
		pathname: '/',
		href: 'http://127.0.0.1:4200/?operatorGui=1',
		origin: 'http://127.0.0.1:4200',
	}
	globalThis.window = {
		innerWidth: 1920,
		innerHeight: 1080,
		location: globalThis.location,
		addEventListener() {},
		removeEventListener() {},
	}
}

const methods = []
function installFetchRecorder() {
	globalThis.fetch = async (url, opts) => {
		methods.push(`${opts?.method || 'GET'} ${url}`)
		return {
			ok: true,
			status: 200,
			headers: { get: () => 'application/json' },
			json: async () => ({}),
			text: async () => '{}',
		}
	}
}

/** A DOM rect as getBoundingClientRect returns it. A hidden pane returns all zeros. */
const rect = (left, top, width, height) => ({ left, top, width, height })
const VIEWPORT = { width: 1920, height: 1080 }
const HIDDEN = [{ id: 'pgm_1', role: 'pgm', mainIndex: 0, rect: rect(0, 0, 0, 0) }]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

describe('WO-529 fault 1: a surface handoff never puts an empty layout on the wire', () => {
	let mod

	before(() => {
		installBrowserGlobals()
		installFetchRecorder()
		mod = require('../../client/lib/operator-gui-mode-report.js')
	})

	beforeEach(() => {
		mod.resetOperatorGuiModeStateForTests()
		methods.length = 0
	})

	it('looks editor -> timeline editor emits no DELETE (the compose routes are never torn down)', async () => {
		// Settled on the looks editor: the compose surface owns the mosaic.
		mod.reportComposeCellRects([{ id: 'pgm_1', role: 'pgm', mainIndex: 0, rect: rect(0, 0, 960, 540) }], VIEWPORT)
		await sleep(250) // let the throttle window reopen, as a user-paced tab switch would

		// The tab switch: both surfaces report in the same frame, withdrawal first.
		mod.reportComposeCellRects(HIDDEN, VIEWPORT)
		mod.reportTimelineCellRects([{ id: 'pgm_1', role: 'pgm', mainIndex: 0, rect: rect(10, 10, 800, 450) }], VIEWPORT)
		await sleep(400)

		assert.deepEqual(
			methods.filter((m) => m.startsWith('DELETE')),
			[],
			'an empty POST/DELETE STOPs every compose route layer — the handoff must not pass through one',
		)
		assert.ok(methods.length >= 2, `the incoming surface still reports (got ${JSON.stringify(methods)})`)
	})

	it('a genuinely final withdrawal still clears the layout, one interval later', async () => {
		mod.reportComposeCellRects([{ id: 'pgm_1', role: 'pgm', mainIndex: 0, rect: rect(0, 0, 960, 540) }], VIEWPORT)
		await sleep(250)
		methods.length = 0

		// Nothing takes over — e.g. switching to the Devices tab. The holes MUST close.
		mod.reportComposeCellRects(HIDDEN, VIEWPORT)
		await sleep(400)

		assert.deepEqual(methods, ['DELETE /api/operator-gui/layout'], 'deferring a withdrawal must not cancel it')
	})
})

/* ------------------------------------------------------------------ fault 2 */

describe('WO-529 fault 2: a hidden pane’s 0x0 observation is not a resize', () => {
	it('onCanvasResize guards the degenerate case and leaves lastCanvasSize alone', () => {
		const src = readOperatorComposeTiles()
		assert.match(
			src,
			/const real = newSize\.w > 1 && newSize\.h > 1/,
			'the degenerate (no-box) observation is identified explicitly',
		)
		assert.match(
			src,
			/if \(real && \(newSize\.w !== lastCanvasSize\.w \|\| newSize\.h !== lastCanvasSize\.h\) && lastCanvasSize\.w > 0\)/,
			'px/frac are only rewritten for a REAL resize',
		)
		assert.match(
			src,
			/if \(real\) lastCanvasSize = newSize/,
			'lastCanvasSize must keep the pre-hide size, so the restoring observation is a no-op',
		)
		// The withdrawal path depends on a hidden surface still laying out and reporting zero rects.
		assert.match(src, /if \(real\) lastCanvasSize = newSize\n\t\tlayoutAll\(\)/, 'layoutAll still runs while hidden')
	})

	it('the guard preserves tile geometry across hide -> show, and still applies a real resize', () => {
		// The decision under test, transcribed from onCanvasResize.
		const MIN = { width: 160, height: 110 }
		const clamp = (r, cw, ch) => ({
			w: Math.min(Math.max(r.w, MIN.width), cw),
			h: Math.min(Math.max(r.h, MIN.height), ch),
			x: Math.max(0, Math.min(r.x, cw - Math.min(Math.max(r.w, MIN.width), cw))),
			y: Math.max(0, Math.min(r.y, ch - Math.min(Math.max(r.h, MIN.height), ch))),
		})
		const tile = { px: { x: 100, y: 50, w: 800, h: 450 }, pxDesired: { x: 100, y: 50, w: 800, h: 450 } }
		let lastCanvasSize = { w: 1200, h: 700 }

		function onCanvasResize(newSize) {
			const real = newSize.w > 1 && newSize.h > 1
			if (real && (newSize.w !== lastCanvasSize.w || newSize.h !== lastCanvasSize.h) && lastCanvasSize.w > 0) {
				tile.px = clamp(tile.pxDesired, newSize.w, newSize.h)
				tile.frac = { x: tile.px.x / newSize.w, y: tile.px.y / newSize.h, w: tile.px.w / newSize.w, h: tile.px.h / newSize.h }
			}
			if (real) lastCanvasSize = newSize
		}

		// Pane hidden: canvasSize() clamps 0x0 up to 1x1.
		onCanvasResize({ w: 1, h: 1 })
		assert.deepEqual(tile.px, { x: 100, y: 50, w: 800, h: 450 }, 'hiding a pane must not resize its tiles')
		assert.deepEqual(lastCanvasSize, { w: 1200, h: 700 }, 'the pre-hide canvas size is what the pane returns to')

		// Pane shown again at the same size — the restoring observation must be a no-op.
		onCanvasResize({ w: 1200, h: 700 })
		assert.deepEqual(tile.px, { x: 100, y: 50, w: 800, h: 450 }, 'the arrangement survives the round trip')

		// A genuine resize still re-clamps and re-derives frac.
		onCanvasResize({ w: 600, h: 400 })
		assert.equal(tile.px.w, 600, 'a real shrink still clamps the tile into the canvas')
		assert.ok(tile.frac.w > 0 && tile.frac.w <= 1, `frac stays a fraction (got ${tile.frac.w})`)
	})
})
