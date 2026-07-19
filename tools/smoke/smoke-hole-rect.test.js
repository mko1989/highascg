'use strict'

/**
 * Smoke — client/lib/hole-rect.js, the single home for outer-rect -> inner hole-rect (border
 * inset) geometry (todos19.07.26 release refactor). Guards:
 *  - the pure inset math (per-side insets, zero-clamped sizes),
 *  - PARITY with operator-compose-tiles' tileBodyRectFromOuter via chromeInsets() — proving the
 *    planned operator-compose-tiles.js migration (`holeRectFromOuter(outer, chromeInsets(chrome))`)
 *    is a behavioral no-op,
 *  - PARITY with multiview-editor's old inline MV_BLEND_INSET math (top 20 / others 6),
 *  - the multiview-editor call site actually uses the shared helper (source scan).
 *
 * client/lib/hole-rect.js is plain ESM with no top-level DOM access — require(esm) under plain
 * node:test, same pattern as tools/smoke/smoke-wo256-operator-compose-tiles.test.js.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { holeRectFromOuter, chromeInsets } = require('../../client/lib/hole-rect.js')
const { tileBodyRectFromOuter, TILE_CHROME } = require('../../client/components/operator-compose-tiles.js')

const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

describe('holeRectFromOuter: per-side inset math', () => {
	it('insets each side independently', () => {
		const hole = holeRectFromOuter(
			{ left: 100, top: 50, width: 400, height: 300 },
			{ top: 20, right: 6, bottom: 6, left: 6 }
		)
		assert.deepEqual(hole, { left: 106, top: 70, width: 388, height: 274 })
	})

	it('clamps over-inset rects to zero size (never negative)', () => {
		const hole = holeRectFromOuter({ left: 0, top: 0, width: 10, height: 10 }, { top: 20, right: 6, bottom: 6, left: 6 })
		assert.equal(hole.width, 0)
		assert.equal(hole.height, 0)
	})
})

describe('parity: chromeInsets(TILE_CHROME) reproduces tileBodyRectFromOuter exactly', () => {
	const outers = [
		{ left: 0, top: 0, width: 320, height: 214 },
		{ left: 17, top: 33, width: 641, height: 399 },
		{ left: -8, top: 4, width: 160, height: 90 },
		{ left: 5, top: 5, width: 3, height: 3 }, // collapses: both clamp to zero size
	]
	it('matches for the real TILE_CHROME and an asymmetric custom chrome', () => {
		for (const chrome of [TILE_CHROME, { headerH: 14, footerH: 34, borderW: 3 }]) {
			for (const outer of outers) {
				assert.deepEqual(holeRectFromOuter(outer, chromeInsets(chrome)), tileBodyRectFromOuter(outer, chrome))
			}
		}
	})
})

describe('parity: multiview-editor blend-hole insets (old inline MV_BLEND_INSET math)', () => {
	it('top 20 / right-bottom-left 6 matches the pre-refactor arithmetic', () => {
		const MV_BLEND_INSETS = { top: 20, right: 6, bottom: 6, left: 6 }
		for (const outer of [
			{ left: 240.5, top: 96, width: 512, height: 288 },
			{ left: 0, top: 0, width: 100, height: 40 },
		]) {
			const hole = holeRectFromOuter(outer, MV_BLEND_INSETS)
			assert.deepEqual(hole, {
				left: outer.left + 6,
				top: outer.top + 20,
				width: Math.max(0, outer.width - 6 * 2),
				height: Math.max(0, outer.height - 20 - 6),
			})
		}
	})
})

describe('call sites use the shared helper', () => {
	it('multiview-editor.js imports hole-rect.js and has no leftover inline inset arithmetic', () => {
		const src = read('client/components/multiview-editor.js')
		assert.match(src, /from '\.\.\/lib\/hole-rect\.js'/)
		assert.match(src, /holeRectFromOuter\(/)
		assert.doesNotMatch(src, /MV_BLEND_INSET_TOP/)
		assert.doesNotMatch(src, /MV_BLEND_INSET\b/)
	})
})
