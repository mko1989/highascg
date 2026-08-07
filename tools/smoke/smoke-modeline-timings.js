'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	parseModelineFromGeneratorOutput,
	breakdownCvtStyleTimings,
	classifyPixelClockBandwidth,
	normalizeTimingKind,
} = require('../../src/utils/modeline-timings')

test('parse + breakdown CVT sample', () => {
	const sample = `Modeline "1920x1080_60.00"  173.00  1920 2048 2248 2576  1080 1083 1088 1120 -hsync +vsync\n`
	const p = parseModelineFromGeneratorOutput(sample)
	assert.ok(p)
	const b = breakdownCvtStyleTimings(p)
	assert.ok(b)
	assert.equal(b.hTotal, 2576)
	assert.equal(b.vTotal, 1120)
	assert.ok(b.framePixels > 0)
})

test('classifyPixelClockBandwidth tiers', () => {
	assert.equal(classifyPixelClockBandwidth(140).short, 'SL')
	assert.equal(classifyPixelClockBandwidth(200).short, 'DL')
	assert.equal(classifyPixelClockBandwidth(500).short, '4K')
	assert.equal(classifyPixelClockBandwidth(800).short, '8K')
	assert.equal(classifyPixelClockBandwidth(NaN).short, '?')
})

test('normalizeTimingKind', () => {
	assert.equal(normalizeTimingKind('cvt-r'), 'cvt_r')
	assert.equal(normalizeTimingKind('GTF'), 'gtf')
})
