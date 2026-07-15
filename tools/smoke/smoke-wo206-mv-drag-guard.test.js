'use strict'

/**
 * FIX-1 (2026-07-15 review, work/reviews/2026-07-15-multiview.md finding 1): auto-apply could
 * fire mid-drag with unfinished cell geometry — multiviewState.setCell() emits 'apply-request'
 * on every mousemove tick, and the editor's apply-request listener scheduled a debounced apply
 * with no drag-in-progress check. Source-grep smoke: confirm the drag-in-progress guard exists
 * at all the anchors the fix touches.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

describe('WO-206 multiview drag-in-progress apply guard (FIX-1)', () => {
	const repoRoot = path.resolve(__dirname, '../..')
	const stateSrc = fs.readFileSync(path.join(repoRoot, 'client/lib/multiview-state.js'), 'utf8')
	const editorSrc = fs.readFileSync(path.join(repoRoot, 'client/components/multiview-editor.js'), 'utf8')

	it('multiview-state.js: dragInProgress flag is initialized', () => {
		assert.match(
			stateSrc,
			/this\.dragInProgress\s*=\s*false/,
			'MultiviewState must initialize a dragInProgress flag',
		)
	})

	it('multiview-state.js: setDragInProgress(v) exists and fires a final apply-request on drag end', () => {
		assert.match(stateSrc, /setDragInProgress\s*\(v\)/, 'MultiviewState must expose setDragInProgress(v)')
		const methodMatch = stateSrc.match(/setDragInProgress\s*\(v\)\s*\{[\s\S]*?\n\t\}/)
		assert.ok(methodMatch, 'setDragInProgress method body must be present')
		assert.match(
			methodMatch[0],
			/this\.dragInProgress\s*=\s*!!v/,
			'setDragInProgress must set the flag',
		)
		assert.match(
			methodMatch[0],
			/_emit\(\s*['"]apply-request['"]\s*\)/,
			'setDragInProgress must emit a final apply-request when the drag ends',
		)
	})

	it('multiview-editor.js: apply-request listener skips scheduling while dragging', () => {
		assert.match(
			editorSrc,
			/on\(\s*['"]apply-request['"][\s\S]*?dragInProgress[\s\S]*?return/,
			"the 'apply-request' listener must bail out while multiviewState.dragInProgress is true",
		)
	})

	it('multiview-editor.js: mousedown starts a drag and sets dragInProgress(true)', () => {
		assert.match(
			editorSrc,
			/dragMode\s*=\s*'move'[\s\S]{0,200}setDragInProgress\(true\)/,
			'starting a drag (mousedown on a cell) must call multiviewState.setDragInProgress(true)',
		)
	})

	it('multiview-editor.js: mouseup and mouseleave clear dragInProgress on drag end', () => {
		assert.match(
			editorSrc,
			/canvas\.onmouseup\s*=\s*\(\)\s*=>\s*\{[\s\S]{0,120}setDragInProgress\(false\)/,
			'canvas.onmouseup must call multiviewState.setDragInProgress(false)',
		)
		assert.match(
			editorSrc,
			/canvas\.onmouseleave\s*=\s*\(\)\s*=>\s*\{[\s\S]{0,120}setDragInProgress\(false\)/,
			'canvas.onmouseleave must call multiviewState.setDragInProgress(false) so the flag never gets stuck true',
		)
	})
})
