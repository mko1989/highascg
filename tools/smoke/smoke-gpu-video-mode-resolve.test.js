'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	normalizeCasparVideoModeId,
	matchCasparVideoModeFromDimensions,
	resolveGpuInspectorVideoMode,
} = require('../../client/components/device-view-destinations-inspector.js')

describe('normalizeCasparVideoModeId', () => {
	it('maps shorthand aliases to canonical ids', () => {
		assert.equal(normalizeCasparVideoModeId('1080p50'), '1080p5000')
		assert.equal(normalizeCasparVideoModeId('2160p50'), '2160p5000')
	})
})

describe('matchCasparVideoModeFromDimensions', () => {
	it('matches standard modes by WxH and fps', () => {
		assert.equal(matchCasparVideoModeFromDimensions(3840, 2160, 50), '2160p5000')
		assert.equal(matchCasparVideoModeFromDimensions(1920, 1080, 25), '1080p2500')
	})
})

describe('resolveGpuInspectorVideoMode', () => {
	it('prefers EDID over generic saved 1080p5000', () => {
		const out = resolveGpuInspectorVideoMode({
			cs: { screen_1_mode: '1080p5000' },
			currentSettings: { casparServer: { screen_1_mode: '1080p5000' } },
			screenN: 1,
			conn: null,
			inherited: null,
			detectedDisplay: { resolution: '3840x2160', refreshHz: 50 },
			uniqueDetectedModes: [{ mode: '3840x2160', rate: '50', current: true }],
			defaultModeIdx: 0,
			physicalCasparMode: null,
		})
		assert.equal(out.modeId, '2160p5000')
	})

	it('keeps explicit non-default saved mode', () => {
		const out = resolveGpuInspectorVideoMode({
			cs: { screen_1_mode: '1080p2500' },
			currentSettings: {},
			screenN: 1,
			detectedDisplay: { resolution: '3840x2160', refreshHz: 50 },
			uniqueDetectedModes: [{ mode: '3840x2160', rate: '50', current: true }],
			defaultModeIdx: 0,
		})
		assert.equal(out.modeId, '1080p2500')
	})
})
