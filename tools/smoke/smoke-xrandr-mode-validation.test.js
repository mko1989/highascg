'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	assertSafeXrandrModeToken,
	assertSafeXrandrOutputName,
	buildXrandrLayoutArgv,
} = require('../../src/utils/xrandr-safety')

test('assertSafeXrandrModeToken accepts standard mode tokens', () => {
	assert.equal(assertSafeXrandrModeToken('1920x1080'), '1920x1080')
	assert.equal(assertSafeXrandrModeToken('3840x2160_60.00'), '3840x2160_60.00')
})

test('assertSafeXrandrModeToken rejects shell metacharacters', () => {
	assert.throws(() => assertSafeXrandrModeToken('1920x1080; rm -rf /'), /Unsafe xrandr mode/)
	assert.throws(() => assertSafeXrandrModeToken('$(whoami)'), /Unsafe xrandr mode/)
})

test('buildXrandrLayoutArgv uses argument arrays without shell interpolation', () => {
	const argv = buildXrandrLayoutArgv([
		{ output: 'DP-1', x: 0, y: 0, mode: '1920x1080', rate: 60 },
	])
	assert.deepEqual(argv, [
		'--display',
		':0',
		'--output',
		'DP-1',
		'--pos',
		'0x0',
		'--mode',
		'1920x1080',
		'--rate',
		'60',
	])
})

test('assertSafeXrandrOutputName rejects unsafe output names', () => {
	assert.equal(assertSafeXrandrOutputName('HDMI-1'), 'HDMI-1')
	assert.throws(() => assertSafeXrandrOutputName('DP-1;id'), /Unsafe xrandr output/)
})
