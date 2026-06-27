const test = require('node:test')
const assert = require('node:assert/strict')

const {
	resolveFtbChannels,
	shouldStopTimelineForFtb,
} = require('../../src/api/routes-ftb')

const map = {
	screenCount: 2,
	programCh: (n) => (n === 1 ? 1 : 3),
	previewCh: (n) => (n === 1 ? 2 : null),
	programChannels: [1, 3],
}

test('resolveFtbChannels: all screens', () => {
	assert.deepEqual(resolveFtbChannels(map, null), [1, 2, 3])
})

test('resolveFtbChannels: single screen with PRV', () => {
	assert.deepEqual(resolveFtbChannels(map, 0), [1, 2])
})

test('resolveFtbChannels: PGM-only screen', () => {
	assert.deepEqual(resolveFtbChannels(map, 1), [3])
})

test('resolveFtbChannels: out of range', () => {
	assert.equal(resolveFtbChannels(map, 9), null)
})

test('shouldStopTimelineForFtb: global always stops', () => {
	assert.equal(shouldStopTimelineForFtb({}, null), true)
})

test('shouldStopTimelineForFtb: per-screen stops when scoped', () => {
	const ctx = {
		timelineEngine: {
			getPlayback: () => ({ timelineId: 'tl1', sendTo: { screenIdx: 1 } }),
		},
	}
	assert.equal(shouldStopTimelineForFtb(ctx, 1), true)
	assert.equal(shouldStopTimelineForFtb(ctx, 0), false)
})
