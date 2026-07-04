'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

describe('WO-110 T110.8 CG deck thumb contain', () => {
	it('computeContainDestRect letterboxes 16:9 into a square layer rect', async () => {
		const { computeContainDestRect } = await import('../../client/lib/fill-math.js')
		const rect = computeContainDestRect(1920, 1080, 10, 20, 100, 100)
		assert.ok(rect.w <= 100 && rect.h <= 100)
		assert.ok(Math.abs(rect.w / rect.h - 16 / 9) < 0.01)
		assert.equal(rect.x, 10)
		assert.ok(rect.y > 20)
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
