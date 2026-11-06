'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const T = require('../../src/timecode/timecode-math')
const { diffScenes, normalizeTransition, resolveChannelFramerateForMixerTween } = require('../../src/engine/scene-transition')
const { clipTransportMeta } = require('../../src/engine/timeline-playback-amcp-schedule')

for (const mode of [24, 25, '29.97df', 30]) {
	test(`timecode round-trips frame boundaries across 100 days at ${mode}`, () => {
		const day = T.framesPerDay(mode)
		for (const frame of [-day - 1, -1, 0, 1, 63, day - 1, day, day * 100 + 123]) {
			assert.equal(T.msToFrames(T.framesToMs(frame, mode), mode), frame)
			const wrapped = ((frame % day) + day) % day
			assert.equal(T.tcToFrames(T.framesToTc(frame, mode), mode), wrapped)
		}
		assert.equal(T.msToFrames(-1, mode), -1)
		assert.equal(T.msToFrames(0, mode), 0)
	})
}

test('DF minute boundaries across the whole day skip only the prescribed labels', () => {
	for (let minute = 0; minute < 1440; minute++) {
		const dropped = minute % 10 ? 2 : 0
		const expected = minute * 1800 - 2 * (minute - Math.floor(minute / 10)) + dropped
		const tc = { h: Math.floor(minute / 60), m: minute % 60, s: 0, f: dropped, df: true }
		assert.equal(T.tcToFrames(tc, '29.97df'), expected)
		assert.deepEqual(T.framesToTc(expected, '29.97df'), tc)
		for (let f = 0; f < dropped; f++) assert.equal(T.tcToFrames({ ...tc, f }, '29.97df'), expected)
	}
})

test('50/59.94 are unsupported LTC modes, explicitly falling back to 25', () => {
	for (const rate of [50, 59.94, 60000 / 1001]) assert.equal(T.fpsMode(rate).key, '25')
})

for (const fps of [24, 25, 29.97, 30000 / 1001, 30, 50, 59.94, 60000 / 1001]) {
	test(`channel rate and one-hour seek preserve ${fps} fps`, () => {
		const self = { variables: { channel_1_framerate: String(fps) } }
		assert.equal(resolveChannelFramerateForMixerTween(self, 1, 25), fps)
		assert.equal(resolveChannelFramerateForMixerTween({}, 1, String(fps)), fps)
		const clip = { source: { value: 'unknown.mov' }, startTime: 0, duration: 7200000 }
		const meta = clipTransportMeta(clip, 3600000, { fps: 25 }, self, { channel: 1 })
		assert.equal(meta.frame, 90000)
		assert.equal(meta.caspFrame, Math.round(3600 * fps))
	})
}

test('invalid rates use the hint or default; reported channel rate has priority', () => {
	for (const value of [undefined, '', 'junk', 0, -25, Infinity]) {
		assert.equal(resolveChannelFramerateForMixerTween({ variables: { channel_1_framerate: value } }, 1, 24), 24)
		assert.equal(resolveChannelFramerateForMixerTween({}, 1, value), 50)
	}
	assert.equal(resolveChannelFramerateForMixerTween({ variables: { channel_1_framerate: 50 } }, 1, 25), 50)
})

const layer = (layerNumber, value, type = 'media') => ({ layerNumber, source: { type, value } })
test('scene diff handles empty looks and entering, leaving, replaced and retained sources', () => {
	const current = { layers: [layer(10, 'a'), layer(11, 'b'), layer(12, 'c'), layer(13, 'd')] }
	const incoming = { layers: [layer(10, 'a', 'file'), layer(11, ''), layer(12, 'replacement'), layer(14, 'new')] }
	const diff = diffScenes(current, incoming)
	assert.deepEqual(Object.fromEntries(Object.entries(diff).map(([key, rows]) => [key, rows.map(row => row.layerNumber)])), {
		update: [12], enter: [14], exit: [11, 13], unchanged: [10],
	})
	assert.deepEqual(diffScenes(null, null), { update: [], enter: [], exit: [], unchanged: [] })
	assert.deepEqual(diffScenes(current, { layers: [] }).exit, current.layers)
	assert.deepEqual(diffScenes(null, current).enter, current.layers)
})

test('CUT ignores picker duration and negative MIX duration clamps to zero', () => {
	assert.equal(normalizeTransition({ type: 'CUT', duration: 50 }).duration, 0)
	assert.equal(normalizeTransition({ type: 'MIX', duration: -5 }).duration, 0)
})
