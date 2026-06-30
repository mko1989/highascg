'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	parseModelineFromCvtOutput,
	readCreateMissingModes,
	pickStripFallbackMode,
	pickBestExistingModeForPlan,
	rateHintFromModeSuffix,
} = require('../../src/utils/xrandr-custom-mode')

test('parseModelineFromCvtOutput extracts name and timings', () => {
	const sample = `# 1920x1080 59.96 Hz (CVT) fieldrate 60.00 Hz; hsync: 67.49 kHz; pclk: 173.00 MHz
Modeline "1920x1080_60.00"  173.00  1920 2048 2248 2576  1080 1083 1088 1120 -hsync +vsync
`
	const p = parseModelineFromCvtOutput(sample)
	assert.ok(p)
	assert.equal(p.modeName, '1920x1080_60.00')
	assert.ok(p.timings.length > 5)
	assert.equal(p.timings[0], '173.00')
})

test('readCreateMissingModes defaults on; explicit false disables', () => {
	assert.equal(readCreateMissingModes({}), true)
	assert.equal(readCreateMissingModes({ os_xrandr_create_missing_modes: true }), true)
	assert.equal(readCreateMissingModes({ casparServer: { os_xrandr_create_missing_modes: '1' } }), true)
	assert.equal(readCreateMissingModes({ os_xrandr_create_missing_modes: false }), false)
	assert.equal(readCreateMissingModes({ casparServer: { os_xrandr_create_missing_modes: '0' } }), false)
})

test('shouldCreateXrandrModeForPlan: EDID source never creates; custom always creates', () => {
	const { shouldCreateXrandrModeForPlan } = require('../../src/utils/xrandr-custom-mode')
	assert.equal(shouldCreateXrandrModeForPlan({}, 'edid', '5120x1024'), false)
	assert.equal(shouldCreateXrandrModeForPlan({}, 'custom', '5120x1024'), true)
	assert.equal(shouldCreateXrandrModeForPlan({ os_xrandr_create_missing_modes: false }, 'custom', '5120x1024'), false)
	assert.equal(shouldCreateXrandrModeForPlan({}, 'custom', '1920x1080_60.00'), false)
})

test('pickStripFallbackMode prefers first WxH in set', () => {
	assert.equal(pickStripFallbackMode(null), null)
	assert.equal(pickStripFallbackMode(new Set(['1920x1080_60.00', '1680x1050'])), '1680x1050')
	assert.equal(pickStripFallbackMode(new Set(['1920x1080'])), '1920x1080')
})

test('pickBestExistingModeForPlan prefers bare WxH when present', () => {
	const s = new Set(['5120x1024', '5120x1024_50.00'])
	assert.equal(pickBestExistingModeForPlan('5120x1024', s, 50), '5120x1024')
})

test('pickBestExistingModeForPlan uses suffixed name when bare missing', () => {
	const s = new Set(['5120x1024_50.00'])
	assert.equal(pickBestExistingModeForPlan('5120x1024', s, 50), '5120x1024_50.00')
})

test('pickBestExistingModeForPlan picks closest refresh when multiple', () => {
	const s = new Set(['5120x1024_50.00', '5120x1024_60.00'])
	assert.equal(pickBestExistingModeForPlan('5120x1024', s, 60), '5120x1024_60.00')
})

test('rateHintFromModeSuffix', () => {
	assert.equal(rateHintFromModeSuffix('5120x1024_50.00', '5120x1024'), 50)
	assert.equal(rateHintFromModeSuffix('5120x1024', '5120x1024'), null)
})
