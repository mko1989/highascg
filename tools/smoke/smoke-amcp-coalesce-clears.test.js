'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { coalescePerLayerClearStorm } = require('../../src/caspar/amcp-coalesce-clears')

test('coalescePerLayerClearStorm collapses large preview clear sweeps to CLEAR channel', () => {
	const lines = []
	for (let L = 794; L <= 810; L++) {
		lines.push(`CG 3-${L} CLEAR`, `MIXER 3-${L} CLEAR`)
		if (L % 10 === 0) lines.push(`STOP 3-${L}`)
	}
	lines.push('PLAY 3-10 "clip.mov"', 'MIXER 3 COMMIT')

	const { lines: out, coalesced, channels } = coalescePerLayerClearStorm(lines)
	assert.equal(coalesced, true)
	assert.deepEqual(channels, [3])
	assert.equal(out[0], 'CLEAR 3')
	assert.equal(out.filter((l) => /^CG 3-\d+ CLEAR$/i.test(l)).length, 0)
	assert.equal(out.filter((l) => /^MIXER 3-\d+ CLEAR$/i.test(l)).length, 0)
	assert.equal(out.filter((l) => /^STOP 3-\d+$/i.test(l)).length, 0)
	assert.ok(out.includes('PLAY 3-10 "clip.mov"'))
	assert.ok(out.includes('MIXER 3 COMMIT'))
})

test('coalescePerLayerClearStorm collapses bare CLEAR ch-layer sweeps (multiview)', () => {
	const lines = []
	for (let L = 10; L <= 60; L++) lines.push(`CLEAR 4-${L}`)
	lines.push('CG 4-10 ADD 0 "color_bg" 1 {}', 'MIXER 4 COMMIT')

	const { lines: out, coalesced, channels } = coalescePerLayerClearStorm(lines)
	assert.equal(coalesced, true)
	assert.deepEqual(channels, [4])
	assert.equal(out[0], 'CLEAR 4')
	assert.equal(out.filter((l) => /^CLEAR 4-\d+$/i.test(l)).length, 0)
	assert.ok(out.includes('MIXER 4 COMMIT'))
})

test('coalescePerLayerClearStorm leaves small surgical clears alone', () => {
	const lines = ['CG 1-10 CLEAR', 'MIXER 1-10 CLEAR', 'PLAY 1-10 "a.mov"']
	const { lines: out, coalesced } = coalescePerLayerClearStorm(lines)
	assert.equal(coalesced, false)
	assert.deepEqual(out, lines)
})
