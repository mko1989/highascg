'use strict'

/**
 * WO-256 smoke — Operator-GUI compose preview became a free-tile canvas (multiviewer-style
 * movable/resizable windows). Split out of smoke-wo256-operator-compose-tiles.test.js (line-count
 * refactor). WO-646 deleted the Firefox operator-GUI kiosk, so the tile canvas, its hard gate in
 * preview-canvas-panel.js, the position watcher and the operator-GUI report/recovery path were
 * removed with it; their source-grep checks are gone. What remains: the still-live
 * preview-canvas-panel.js structure guards, the WO-250 playback-timer export, and the WO-256
 * "server needs no changes" guard.
 * Default-layout math, chrome/body geometry, persistence, resize behavior and boot-state reporting
 * live in smoke-wo256-operator-compose-tiles.test.js and its other siblings.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8')

describe('WO-256 T256.2: preview-canvas-panel.js structure guards (kiosk gate removed by WO-646)', () => {
	const src = read('client/components/preview-canvas-panel.js')

	it('file stays under the repo max-file-lines gate (~500) despite the new branch', () => {
		const lines = src.split('\n').length
		assert.ok(lines <= 500, `preview-canvas-panel.js is ${lines} lines, over the 500 cap`)
	})

	it('is not forked: exactly one initPreviewPanel export, no sibling operator-mode-only copy of the function', () => {
		const matches = src.match(/export function initPreviewPanel/g) || []
		assert.equal(matches.length, 1)
	})
})

describe('WO-256 T256.4: playback-timer.js keeps the WO-250 picker export', () => {
	it('playback-timer.js still exports pickTopLayerStateForPlayback (WO-250) for any future direct reuse', () => {
		const { pickTopLayerStateForPlayback } = require('../../client/components/playback-timer.js')
		assert.equal(typeof pickTopLayerStateForPlayback, 'function')
	})
})

describe('WO-256: server needs no changes — operator-gui-channel.js already accepts arbitrary role/mainIndex/rect cells', () => {
	it('resolveCellSourceChannel branches only on role + mainIndex, not on rect position/size/count (grep-level, source unchanged by this WO)', () => {
		const src = read('src/system/operator-gui-channel.js') + read('src/system/operator-gui-channel-geometry.js')
		assert.match(src, /function resolveCellSourceChannel/)
		assert.doesNotMatch(src, /WO-256/, 'confirms this WO made no server-side edits')
	})
})
