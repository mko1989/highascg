'use strict'

const assert = require('assert')
const {
	mergedFillKeyframeTimes,
	keyframeSegmentIndex,
	msToMixerFrames,
} = require('../../src/engine/timeline-keyframe-mixer')

const clip = {
	keyframes: [
		{ time: 0, property: 'fill_x', value: 0 },
		{ time: 0, property: 'fill_y', value: 0 },
		{ time: 1000, property: 'fill_x', value: 1 },
		{ time: 1000, property: 'fill_y', value: 0.5 },
	],
}

assert.deepStrictEqual(mergedFillKeyframeTimes(clip), [0, 1000])
assert.strictEqual(keyframeSegmentIndex([0, 1000], 500), 0)
assert.strictEqual(keyframeSegmentIndex([0, 1000], 1000), 1)
assert.strictEqual(msToMixerFrames(1000, 25), 25)

console.log('smoke-timeline-keyframe-mixer: OK')
