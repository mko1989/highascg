'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

describe('WO-110 T110.8 CG deck thumb contain', () => {
	it('drawImageContainInRect letterboxes 16:9 into a square layer rect', async () => {
		// the contain helper the CG deck thumb draws with (cg-only-look-deck-thumb.js); the test used to import a
		// computeContainDestRect from fill-math.js that never landed
		const { drawImageContainInRect } = await import('../../client/components/preview-canvas-draw-base.js')
		const calls = []
		drawImageContainInRect({ drawImage: (...a) => calls.push(a) }, { naturalWidth: 1920, naturalHeight: 1080 }, 10, 20, 100, 100)
		assert.equal(calls.length, 1)
		const [, x, y, w, h] = calls[0]
		assert.ok(w <= 100 && h <= 100)
		assert.ok(Math.abs(w / h - 16 / 9) < 0.01)
		assert.equal(x, 10)
		assert.ok(y > 20)
	})

	it('formatModeCreationStatus summarizes created custom modes', async () => {
		const { formatModeCreationStatus } = await import('../../client/lib/os-mode-creation-status.js')
		const text = formatModeCreationStatus([
			{ output: 'HDMI-1', modeName: '1920x1080_60.00', created: true, source: 'cvt' },
			{ output: 'DP-2', modeName: '1920x1080', created: false, source: 'edid' },
		])
		assert.match(text, /Custom RandR mode\(s\): 1 created/)
		assert.match(text, /HDMI-1: 1920x1080_60\.00 \(created, cvt\)/)
		assert.match(text, /DP-2: 1920x1080 \(existing, edid\)/)
	})
})
