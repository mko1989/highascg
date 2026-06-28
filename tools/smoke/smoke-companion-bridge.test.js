'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	MODULE_ID,
	composePreviewImageKey,
	lookAirFrameKey,
	lookIdSlug,
	normalizeHelloPreview,
	isComposePreviewServerKey,
} = require('../../src/companion-bridge/contract')
const { CompanionBridgeRegistry } = require('../../src/companion-bridge/registry')

describe('companion-bridge contract', () => {
	it('composePreviewImageKey matches legacy naming', () => {
		assert.equal(composePreviewImageKey(1), 'compose_preview_ch1_image')
	})

	it('lookAirFrameKey slugifies look id', () => {
		assert.equal(lookAirFrameKey('sc_test-1'), 'look_air_frame_sc_test-1')
		assert.equal(lookIdSlug('sc_test-1'), 'sc_test-1')
	})

	it('isComposePreviewServerKey covers compose + look air keys', () => {
		assert.equal(isComposePreviewServerKey('compose_preview_ch2_image'), true)
		assert.equal(isComposePreviewServerKey('compose_preview_ch2_quad_tl'), true)
		assert.equal(isComposePreviewServerKey('look_air_frame_sc_foo'), true)
		assert.equal(isComposePreviewServerKey('highascg_timeline_id'), false)
	})

	it('normalizeHelloPreview defaults lookAirFrames on', () => {
		const p = normalizeHelloPreview({ enabled: true, channels: [1, 2] })
		assert.equal(p.quadrants, false)
		assert.equal(p.lookAirFrames, true)
	})
})

describe('companion-bridge registry', () => {
	it('merges preview demand across clients', () => {
		const reg = new CompanionBridgeRegistry()
		const ws1 = {}
		const ws2 = {}
		reg.register(ws1, {
			moduleId: MODULE_ID,
			instanceId: 'a',
			preview: { enabled: true, channels: [1], quadrants: false, lookAirFrames: true },
		})
		reg.register(ws2, {
			moduleId: MODULE_ID,
			instanceId: 'b',
			preview: { enabled: true, channels: [2], quadrants: true, lookAirFrames: true },
		})
		const demand = reg.getMergedPreviewDemand()
		assert.equal(demand.enabled, true)
		assert.deepEqual(demand.channels, [1, 2])
		assert.equal(demand.quadrants, true)
		assert.equal(reg.shouldPushQuadrants(), true)
		assert.equal(reg.shouldPushChannelImage(1, [1, 2]), true)
		assert.equal(reg.shouldPushChannelImage(2, [1, 2]), true)
		assert.equal(reg.shouldPushChannelImage(3, [1, 2]), false)
	})

	it('returns null demand when no clients (legacy mode)', () => {
		const reg = new CompanionBridgeRegistry()
		assert.equal(reg.getMergedPreviewDemand(), null)
		assert.equal(reg.shouldPushQuadrants(), true)
		assert.equal(reg.shouldPushChannelImage(1, [1]), true)
	})

	it('ignores wrong moduleId', () => {
		const reg = new CompanionBridgeRegistry()
		assert.equal(reg.register({}, { moduleId: 'other', preview: {} }), false)
		assert.equal(reg.clientCount(), 0)
	})
})
