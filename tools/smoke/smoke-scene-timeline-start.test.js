'use strict'

// WO-152 B152.1 — starting a timeline from inside a look must not pop:
// startSceneTimelineLayer presets the timeline's physical layers to opacity 0
// BEFORE PLAY reaches Caspar, and returns the layers the caller fades in inside
// its own take batch. CUT path: plain play, no preset, nothing to fade.

const test = require('node:test')
const assert = require('node:assert/strict')
const { startSceneTimelineLayer } = require('../../src/engine/timeline-take')
const { TIMELINE_LAYER_BASE } = require('../../src/engine/timeline-playback-helpers')

function makeMocks({ tlLayers = 2, clipKeyframes = [] } = {}) {
	const events = []
	const tl = {
		id: 'tl1',
		layers: Array.from({ length: tlLayers }, (_, i) => ({
			id: `l${i}`,
			clips: [{ id: `c${i}`, startTime: 0, duration: 5000, keyframes: clipKeyframes }],
		})),
	}
	const eng = {
		setSendTo: () => {},
		setLoop: () => {},
		getPlayback: () => ({ position: 1234 }),
		get: () => tl,
		play: (id, pos) => events.push({ type: 'play', id, pos }),
		_clipAt: (layer, ms) =>
			layer.clips.find((c) => ms >= c.startTime && ms < c.startTime + c.duration) || null,
	}
	const amcp = {
		batchSendChunked: (lines, opts) => {
			events.push({ type: 'batch', lines: [...lines], opts })
			return Promise.resolve()
		},
	}
	return { events, eng, amcp, tl }
}

test('fade path: preset 0 lands before play; fade-in layers returned', async () => {
	const { events, eng, amcp } = makeMocks({ tlLayers: 2 })
	const fadeIn = await startSceneTimelineLayer({ timelineEngine: eng }, amcp, 1, { source: { value: 'tl1' } }, {
		fadeDur: 25,
		screenIdx: 0,
	})
	const batchIdx = events.findIndex((e) => e.type === 'batch')
	const playIdx = events.findIndex((e) => e.type === 'play')
	assert.ok(batchIdx >= 0 && playIdx >= 0, 'both preset batch and play must happen')
	assert.ok(batchIdx < playIdx, 'opacity preset must be sent BEFORE play (flash race)')
	assert.deepEqual(
		events[batchIdx].lines,
		[`MIXER 1-${TIMELINE_LAYER_BASE} OPACITY 0 0`, `MIXER 1-${TIMELINE_LAYER_BASE + 1} OPACITY 0 0`],
	)
	assert.equal(events[batchIdx].opts?.skipMixerPreCommit, true, 'preset must not pre-commit (would fire stale DEFERs)')
	assert.deepEqual(fadeIn, [TIMELINE_LAYER_BASE, TIMELINE_LAYER_BASE + 1], 'caller fades both layers in')
})

test('cut path: plain play, no preset, nothing to fade', async () => {
	const { events, eng, amcp } = makeMocks()
	const fadeIn = await startSceneTimelineLayer({ timelineEngine: eng }, amcp, 1, { source: { value: 'tl1' } }, {
		fadeDur: 0,
		screenIdx: 0,
	})
	assert.deepEqual(fadeIn, [])
	assert.ok(!events.some((e) => e.type === 'batch'), 'no preset batch on cut')
	assert.ok(events.some((e) => e.type === 'play'))
})

test('clip with own opacity keyframes is excluded from layer fade-in', async () => {
	const { events, eng, amcp } = makeMocks({
		tlLayers: 1,
		clipKeyframes: [
			{ time: 0, property: 'opacity', value: 0 },
			{ time: 500, property: 'opacity', value: 1 },
		],
	})
	const fadeIn = await startSceneTimelineLayer({ timelineEngine: eng }, amcp, 1, { source: { value: 'tl1' } }, {
		fadeDur: 25,
		screenIdx: 0,
	})
	assert.deepEqual(fadeIn, [], 'clip keyframes own OPACITY — no layer-level fade line')
	assert.ok(events.some((e) => e.type === 'batch'), 'preset still happens (clip starts at 0 anyway)')
})

test('startAtCurrentPosition resumes from playback position; default starts at 0', async () => {
	const a = makeMocks()
	await startSceneTimelineLayer({ timelineEngine: a.eng }, a.amcp, 1, { source: { value: 'tl1' } }, {
		fadeDur: 0,
		screenIdx: 0,
		startAtCurrentPosition: true,
	})
	assert.equal(a.events.find((e) => e.type === 'play').pos, 1234)
	const b = makeMocks()
	await startSceneTimelineLayer({ timelineEngine: b.eng }, b.amcp, 1, { source: { value: 'tl1' } }, {
		fadeDur: 0,
		screenIdx: 0,
	})
	assert.equal(b.events.find((e) => e.type === 'play').pos, 0)
})
