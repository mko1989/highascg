'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { param, audioFilterParam, clipParamForPlay } = require('../../src/caspar/amcp-utils')
const { buildClipCommandPlan, serializeClipCommandPlan } = require('../../src/caspar/amcp-command-plan')
const { msToFrames, normalizeTransitionForAmcp, diffCasparLayerPlan } = require('../../src/caspar/amcp-layer-diff-plan')
const { normalizeSpeed, speedFilters, scaleLength } = require('../../src/caspar/clip-speed')

const serialize = (clip, opts = {}) => serializeClipCommandPlan(buildClipCommandPlan('LOADBG', 1, 10, clip, opts))

for (const [input, expected] of [
	['folder/Zażółć 東京.mov', '"folder/Zażółć 東京.mov"'],
	['C:\\Media Files\\a"b.mov', '"C:\\\\Media Files\\\\a\\"b.mov"'],
	['Take(2)_final', '"Take(2)_final"'],
	['a\r\nCLEAR 1', '"a CLEAR 1"'],
]) {
	test(`AMCP quoting preserves token contents: ${JSON.stringify(input)}`, () => {
		assert.equal(param(input), expected)
		assert.equal(audioFilterParam(input), expected)
		assert.equal(clipParamForPlay(input), expected)
		assert.equal(serialize(input), `LOADBG 1-10 ${expected}`)
	})
}

test('bare tokens, empty values, routes and filters retain their serialization contracts', () => {
	assert.equal(param('東京'), '東京')
	assert.equal(param('a"b'), 'a\\"b')
	assert.equal(param('C:\\clip'), 'C:\\\\clip')
	for (const value of [null, undefined, '']) assert.equal(param(value), '')
	assert.equal(clipParamForPlay('route://1-10'), 'route://1-10')
	assert.equal(audioFilterParam('pan=2c|c0=c1'), '"pan=2c|c0=c1"')
	assert.equal(serialize('[HTML] https://host/a b'), 'LOADBG 1-10 [HTML] "https://host/a b"')
	assert.equal(serialize('shm://ring_1'), 'LOADBG 1-10 SHM NAME ring_1')
})

test('empty layer plans and stopped layers do not emit transport commands', () => {
	assert.deepEqual(diffCasparLayerPlan(null, null), [])
	assert.deepEqual(diffCasparLayerPlan(null, { channel: 1, layer: 10, playing: false }), [])
	const next = { channel: 1, layer: 10, nextUp: { clip: 'a' }, playing: true }
	assert.deepEqual(diffCasparLayerPlan(next, next).map(serializeClipCommandPlan), ['PLAY 1-10'])
})

for (const fps of [24, 25, 30000 / 1001, 30, 50, 60000 / 1001]) {
	test(`transition duration floors partial frames and clamps negatives at ${fps}`, () => {
		for (const frames of [0, 0.25, 1.25, 100.25, 10000000.25]) {
			assert.equal(msToFrames(frames * 1000 / fps, fps), Math.floor(frames))
		}
		assert.equal(msToFrames(-1000, fps), 0)
		assert.equal(normalizeTransitionForAmcp({ type: 'CUT', durationMs: 1000 }, fps), null)
		assert.equal(normalizeTransitionForAmcp({ type: 'MIX', durationFrames: 0, durationMs: 1000 }, fps).duration, 0)
	})
}

test('exact frame boundaries must not lose a frame to floating point division (WO-983: +1e-6 frame, as timecode-math)', () => {
	assert.equal(msToFrames(5 * 1000 / 30, 30), 5, 'exactly five frames; division currently yields 4.999999999999999')
	assert.equal(msToFrames(2102.1, 30000 / 1001), 63)
	assert.equal(msToFrames(1051.05, 60000 / 1001), 63)
})

test('invalid and extreme speed inputs stay bounded; filters never contain invalid atempo', () => {
	for (const value of [0, -1, -Infinity, Infinity, NaN, 'junk']) {
		assert.equal(normalizeSpeed(value), null)
		assert.deepEqual(speedFilters(value), {})
		assert.equal(scaleLength(100, value), 100)
	}
	for (const [value, expected] of [[Number.MIN_VALUE, 0.25], [Number.MAX_VALUE, 4], [1.004, null], [1.006, 1.01]]) {
		assert.equal(normalizeSpeed(value), expected)
	}
	assert.equal(scaleLength(0, 2), 1)
	assert.equal(scaleLength(-10, 2), 1)
	assert.equal(scaleLength(100000000, 0.25), 400000000)
	assert.equal(scaleLength(null, 2), null)
})
