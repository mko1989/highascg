'use strict'

/**
 * WO-611 #4 (found porting the compose frame to Godot, 2026-10-18): startDrag compared the left-edge
 * snap against the right-edge "snap" — when only ONE edge was near a snap line, the other edge's
 * no-op result (distance 0) always won, so a moved layer only snapped when BOTH edges snapped at once.
 * snapMoveAxis picks the nearer edge that actually snapped.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

test('a moved layer snaps by either edge, nearest wins', async () => {
	const { snapMoveAxis } = await import('../../client/components/scenes-compose-handlers.js')
	assert.equal(snapMoveAxis(0.004, 0.5, [0, 1], 0.01), 0, 'left edge 0.004 from the border snaps')
	assert.ok(Math.abs(snapMoveAxis(0.495, 0.5, [0, 1], 0.01) - 0.5) < 1e-12, 'right edge 0.995 snaps to 1')
	assert.ok(Math.abs(snapMoveAxis(0.26, 0.5, [0, 1, 0.75], 0.02) - 0.25) < 1e-12, "right edge snaps to a neighbour's left edge")
	assert.equal(snapMoveAxis(0.3, 0.5, [0, 1], 0.01), 0.3, 'nothing near → unchanged')
	assert.equal(snapMoveAxis(0.006, 0.988, [0, 1], 0.01), 0, 'both edges near, equal distance → left edge wins (as the old code)')
	assert.ok(Math.abs(snapMoveAxis(0.008, 0.988, [0, 1], 0.01) - 0.012) < 1e-12, 'both near: right edge 0.004 away beats left 0.008')
})

test('startDrag uses snapMoveAxis for both axes (source)', () => {
	const src = require('fs').readFileSync(require('path').join(__dirname, '../../client/components/scenes-compose-handlers.js'), 'utf8')
	assert.match(src, /nx = snapMoveAxis\(nextFill\.x, nextFill\.scaleX, xCandidates, snapThresholdX\)/)
	assert.match(src, /ny = snapMoveAxis\(nextFill\.y, nextFill\.scaleY, yCandidates, snapThresholdY\)/)
})
