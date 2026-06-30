'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { resolveEffectiveOsModeSource, readOsModeSourceSetting } = require('../../src/utils/os-mode-source')
const { shouldCreateXrandrModeForPlan } = require('../../src/utils/xrandr-custom-mode')

test('readOsModeSourceSetting returns explicit values only', () => {
	assert.equal(readOsModeSourceSetting({ screen_1_os_mode_source: 'edid' }, 1), 'edid')
	assert.equal(readOsModeSourceSetting({ screen_1_os_mode_source: 'custom' }, 1), 'custom')
	assert.equal(readOsModeSourceSetting({}, 1), '')
})

test('resolveEffectiveOsModeSource infers custom from bare os_mode or caspar custom', () => {
	assert.equal(resolveEffectiveOsModeSource({ screen_1_os_mode: '1920x1080' }, 1, {}), 'custom')
	assert.equal(resolveEffectiveOsModeSource({ screen_1_mode: 'custom' }, 1, { casparMode: 'custom' }), 'custom')
	assert.equal(resolveEffectiveOsModeSource({ screen_1_os_mode: '1920x1080_60.00' }, 1, {}), 'edid')
	assert.equal(resolveEffectiveOsModeSource({ screen_1_os_mode_source: 'edid', screen_1_os_mode: '1920x1080' }, 1, {}), 'edid')
})

test('shouldCreateXrandrModeForPlan follows operator source not WxH EDID match', () => {
	assert.equal(shouldCreateXrandrModeForPlan({}, 'edid', '1920x1080'), false)
	assert.equal(shouldCreateXrandrModeForPlan({}, 'custom', '1920x1080'), true)
	assert.equal(shouldCreateXrandrModeForPlan({ os_xrandr_create_missing_modes: false }, 'custom', '1920x1080'), false)
})
