'use strict'

/**
 * WO-842 follow-ups: the after-update sweep child has a kill timeout, and the DeckLink multiview feed resolves a
 * custom multiview with the channel plan's rule (multiview_custom_*), not screen 1's custom keys.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { feedFromMultiviewConfig } = require('../../src/config/decklink-output-resolve-feed')

describe('WO-842 sweep timeout and multiview feed', () => {
	it('the sweep spawn is killed after a timeout and closes its log on a spawn error', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/system/sweep-after-update.js'), 'utf8')
		assert.match(src, /timeout: SWEEP_TIMEOUT_MS, killSignal: 'SIGKILL'/)
		assert.match(src, /child\.on\('error'/)
	})

	it('a custom multiview feed reads multiview_custom_*', () => {
		const feed = feedFromMultiviewConfig(
			{
				multiview_mode: 'custom',
				multiview_custom_width: 2560,
				multiview_custom_height: 1440,
				multiview_custom_fps: 50,
				screen_1_custom_width: 999,
				screen_1_custom_height: 999,
			},
			1
		)
		assert.equal(feed.width, 2560)
		assert.equal(feed.height, 1440)
		assert.equal(feed.sourceKind, 'multiview')
	})

	it('a standard multiview mode still resolves', () => {
		const feed = feedFromMultiviewConfig({ multiview_mode: '720p5000' }, 1)
		assert.equal(feed.width, 1280)
		assert.equal(feed.height, 720)
	})
})
