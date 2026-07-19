/**
 * todos19.07.26 — border-resize drag math smoke (looks editor).
 * Covers the pure `edgeResizeDeltaToFill` helper in client/components/scenes-compose-handlers.js
 * (pointer delta → next layer fill), split out of `startEdgeResize` so the aspect-lock behaviour
 * is unit-testable without DOM/pointer-event mocks (same pattern as smoke-scenes-compose-crop-drag).
 *
 * Guards the two todos19.07.26 changes:
 * 1. aspect lock is honoured from EVERY edge/corner (previously only the removed "scale dot"
 *    preserved aspect; corner grab bands resized freely);
 * 2. the border grab bands are the only resize affordance — corner drags resize both axes
 *    (dominant axis drives, opposite corner anchored), edge drags resize the dragged axis with
 *    the perpendicular axis derived proportionally around its centre; `lockAspect: false`
 *    (inspector unlock or Shift) restores free per-axis resize.
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const modPromise = import(
	pathToFileURL(path.join(__dirname, '../../client/components/scenes-compose-handlers.js')).href
)

// 16:9-ish box in fill space: ratio scaleX/scaleY = 2
const START = { x: 0.2, y: 0.2, scaleX: 0.4, scaleY: 0.2 }

function ratioOf(f) {
	return f.scaleX / f.scaleY
}

test('edgeResizeDeltaToFill: locked corner drag preserves aspect ratio and anchors the opposite corner', async () => {
	const { edgeResizeDeltaToFill } = await modPromise

	// SE corner, dominant X move.
	const se = edgeResizeDeltaToFill('se', START, 0.2, 0.01, { lockAspect: true })
	assert.ok(Math.abs(ratioOf(se) - 2) < 1e-9, `ratio preserved (got ${ratioOf(se)})`)
	assert.equal(se.x, START.x, 'NW anchor: x fixed')
	assert.equal(se.y, START.y, 'NW anchor: y fixed')
	assert.ok(Math.abs(se.scaleX - 0.6) < 1e-9, 'X drives (0.4 + 0.2)')
	assert.ok(Math.abs(se.scaleY - 0.3) < 1e-9, 'Y derived from ratio')

	// NW corner, dominant Y move — opposite (SE) corner anchored.
	const nw = edgeResizeDeltaToFill('nw', START, -0.01, -0.1, { lockAspect: true })
	assert.ok(Math.abs(ratioOf(nw) - 2) < 1e-9, 'ratio preserved')
	assert.ok(Math.abs(nw.x + nw.scaleX - (START.x + START.scaleX)) < 1e-9, 'right edge fixed')
	assert.ok(Math.abs(nw.y + nw.scaleY - (START.y + START.scaleY)) < 1e-9, 'bottom edge fixed')
	assert.ok(Math.abs(nw.scaleY - 0.3) < 1e-9, 'Y drives (0.2 - (-0.1))')
	assert.ok(Math.abs(nw.scaleX - 0.6) < 1e-9, 'X derived from ratio')
})

test('edgeResizeDeltaToFill: locked edge drag scales proportionally, perpendicular axis centred', async () => {
	const { edgeResizeDeltaToFill } = await modPromise

	// East edge: +0.2 → scaleX 0.6, scaleY derived 0.3, vertical growth split around centre.
	const e = edgeResizeDeltaToFill('e', START, 0.2, 0, { lockAspect: true })
	assert.ok(Math.abs(ratioOf(e) - 2) < 1e-9, 'ratio preserved')
	assert.equal(e.x, START.x, 'west edge fixed')
	assert.ok(Math.abs(e.scaleX - 0.6) < 1e-9)
	assert.ok(Math.abs(e.scaleY - 0.3) < 1e-9)
	const startCy = START.y + START.scaleY / 2
	assert.ok(Math.abs(e.y + e.scaleY / 2 - startCy) < 1e-9, 'vertical centre unchanged')

	// North edge: -0.1 (drag up) → scaleY 0.3 drives, scaleX derived 0.6, horizontal centred,
	// bottom edge fixed.
	const n = edgeResizeDeltaToFill('n', START, 0, -0.1, { lockAspect: true })
	assert.ok(Math.abs(ratioOf(n) - 2) < 1e-9, 'ratio preserved')
	assert.ok(Math.abs(n.y + n.scaleY - (START.y + START.scaleY)) < 1e-9, 'south edge fixed')
	assert.ok(Math.abs(n.scaleY - 0.3) < 1e-9)
	assert.ok(Math.abs(n.scaleX - 0.6) < 1e-9)
	const startCx = START.x + START.scaleX / 2
	assert.ok(Math.abs(n.x + n.scaleX / 2 - startCx) < 1e-9, 'horizontal centre unchanged')
})

test('edgeResizeDeltaToFill: lockAspect false (inspector unlock / Shift) resizes each axis freely', async () => {
	const { edgeResizeDeltaToFill } = await modPromise

	const se = edgeResizeDeltaToFill('se', START, 0.2, 0.05, { lockAspect: false })
	assert.ok(Math.abs(se.scaleX - 0.6) < 1e-9)
	assert.ok(Math.abs(se.scaleY - 0.25) < 1e-9)
	assert.ok(Math.abs(ratioOf(se) - 2) > 0.1, 'aspect NOT preserved when unlocked')

	// Free edge drag touches only its own axis.
	const e = edgeResizeDeltaToFill('e', START, 0.1, 0, { lockAspect: false })
	assert.ok(Math.abs(e.scaleX - 0.5) < 1e-9)
	assert.equal(e.scaleY, START.scaleY, 'perpendicular axis untouched when unlocked')
	assert.equal(e.y, START.y)
})

test('edgeResizeDeltaToFill: min-size clamp holds on both axes, aspect kept while locked', async () => {
	const { edgeResizeDeltaToFill } = await modPromise
	const minS = 0.02

	// Drag the east edge far past the west edge (negative size) while locked.
	const locked = edgeResizeDeltaToFill('e', START, -2, 0, { lockAspect: true, minS })
	assert.ok(locked.scaleX >= minS - 1e-12, 'scaleX floored')
	assert.ok(locked.scaleY >= minS - 1e-12, 'scaleY floored')
	assert.ok(Math.abs(ratioOf(locked) - 2) < 1e-9, 'ratio survives the clamp')

	// Same in free mode: classic per-axis clamp, west edge anchored on a 'w' drag.
	const free = edgeResizeDeltaToFill('w', START, 2, 0, { lockAspect: false, minS })
	assert.ok(Math.abs(free.scaleX - minS) < 1e-12)
	assert.ok(Math.abs(free.x - (START.x + START.scaleX - minS)) < 1e-12, 'right edge fixed via x re-anchor')
	assert.equal(free.scaleY, START.scaleY)
})

test('edgeResizeDeltaToFill: WO-158 border snapping applies to the dragged edge before the ratio', async () => {
	const { edgeResizeDeltaToFill } = await modPromise

	// snapX snaps a raw right edge of 0.79 to a neighbour border at 0.8.
	const snapX = (v) => (Math.abs(v - 0.8) < 0.02 ? 0.8 : v)
	const e = edgeResizeDeltaToFill('e', START, 0.19, 0, { lockAspect: true, snapX })
	assert.ok(Math.abs(e.x + e.scaleX - 0.8) < 1e-9, 'dragged edge lands on the snap candidate')
	assert.ok(Math.abs(ratioOf(e) - 2) < 1e-9, 'derived axis still follows the ratio')

	// Same drag without a matching candidate: no snap.
	const noSnap = edgeResizeDeltaToFill('e', START, 0.19, 0, { lockAspect: true })
	assert.ok(Math.abs(noSnap.x + noSnap.scaleX - 0.79) < 1e-9)
})

test('edgeResizeDeltaToFill: extra fill props pass through, defaults are safe', async () => {
	const { edgeResizeDeltaToFill } = await modPromise

	const withExtra = edgeResizeDeltaToFill('s', { ...START, someFlag: true }, 0, 0.1, {})
	assert.equal(withExtra.someFlag, true, 'unknown fill props preserved')
	// Defaults: lockAspect true.
	assert.ok(Math.abs(ratioOf(withExtra) - 2) < 1e-9, 'lockAspect defaults to true')

	// Missing scales fall back to 1 without throwing.
	const degenerate = edgeResizeDeltaToFill('se', { x: 0, y: 0 }, 0.1, 0.1, {})
	assert.ok(degenerate.scaleX > 0 && degenerate.scaleY > 0)
})
