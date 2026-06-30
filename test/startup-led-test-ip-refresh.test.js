'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	buildStartupLedTestUpdateCommands,
	STARTUP_LED_TEST_LAYER,
} = require('../src/bootstrap/startup-led-test-pattern')

test('buildStartupLedTestUpdateCommands sends CG UPDATE with fresh ipLines', () => {
	const channels = [
		{
			index: 1,
			videoMode: '720p5000',
			resolutionLabel: '1280×720 · 720p5000',
			screenWidth: 1280,
			screenHeight: 720,
		},
	]
	const flat = buildStartupLedTestUpdateCommands(channels, ['192.168.0.42'], {})
	assert.equal(flat.length, 1)
	assert.match(flat[0], new RegExp(`^CG 1-${STARTUP_LED_TEST_LAYER} UPDATE 0 "`))
	assert.match(flat[0], /192\.168\.0\.42/)
	assert.doesNotMatch(flat[0], /CG 1-999 CLEAR/)
})
