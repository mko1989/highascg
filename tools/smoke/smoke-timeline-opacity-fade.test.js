'use strict'

const assert = require('assert')
const { TimelineEngine } = require('../../src/engine/timeline-engine')

function makeEngine() {
	const mixerCalls = []
	const batchLines = []
	const self = {
		config: { screen_count: 1 },
		amcp: {
			raw: () => Promise.resolve(),
			stop: () => Promise.resolve(),
			pause: () => Promise.resolve(),
			resume: () => Promise.resolve(),
			call: () => Promise.resolve(),
			mixerFill: () => Promise.resolve(),
			mixerOpacity: (ch, layer, opacity, duration, tween) => {
				mixerCalls.push({ ch, layer, opacity, duration, tween })
				return Promise.resolve()
			},
			mixerVolume: () => Promise.resolve(),
			mixerCommit: () => Promise.resolve(),
			batchSendChunked: (lines) => {
				for (const line of lines || []) batchLines.push(line)
				return Promise.resolve()
			},
		},
	}
	return { eng: new TimelineEngine(self), mixerCalls, batchLines }
}

{
	const { eng } = makeEngine()
	const clip = {
		id: 'c1',
		startTime: 0,
		duration: 10000,
		source: { value: 'test.mov' },
		keyframes: [{ time: 500, property: 'opacity', value: 1, easing: 'linear' }],
	}
	assert.strictEqual(eng._interpProp(clip, 'opacity', 0, 1), 1, 'before first keyframe uses default opacity')
}

{
	const { eng } = makeEngine()
	const clip = {
		id: 'c1',
		startTime: 0,
		duration: 10000,
		source: { value: 'test.mov' },
		keyframes: [
			{ time: 0, property: 'opacity', value: 0, easing: 'linear' },
			{ time: 500, property: 'opacity', value: 1, easing: 'linear' },
		],
	}
	assert.strictEqual(eng._interpProp(clip, 'opacity', 0, 1), 0)
	assert.strictEqual(eng._interpProp(clip, 'opacity', 250, 1), 0.5)
}

{
	const { eng, batchLines } = makeEngine()
	const clip = {
		id: 'c1',
		startTime: 0,
		duration: 10000,
		source: { value: 'test.mov' },
		keyframes: [
			{ time: 0, property: 'opacity', value: 0, easing: 'linear' },
			{ time: 500, property: 'opacity', value: 1, easing: 'linear' },
		],
	}
	const tl = eng.create({
		id: 'tl1',
		duration: 10000,
		fps: 25,
		layers: [{ id: 'l1', name: 'Layer 1', clips: [clip] }],
	})
	eng._airTimelineId = tl.id
	// scheduleLeadTween = take entry (WO-139): the lead opacity segment is batched as
	// instant start + DEFER tween, fired by the take orchestrator's single MIXER COMMIT.
	eng._applyClipMixer(1, 201, clip, 0, { force: true, playing: false, fps: 25, scheduleLeadTween: true })
	const opacityLines = batchLines.filter((l) => l.includes(' OPACITY '))
	assert.ok(opacityLines.length >= 2, 'fade-in schedules start + DEFER tween')
	assert.match(opacityLines[0], /OPACITY 0 0/)
	assert.match(opacityLines[1], /OPACITY 1 13 linear DEFER/)
}

// Static clip.opacity is honored as the hold value (no keyframes). Before the fix the hold value was
// hardcoded 1, so a clip's base opacity was ignored on the timeline path. Mirrors clip.volume.
{
	const { eng, mixerCalls } = makeEngine()
	const clip = {
		id: 'c1',
		startTime: 0,
		duration: 10000,
		source: { value: 'test.mov' },
		opacity: 0.5,
		keyframes: [],
	}
	const tl = eng.create({
		id: 'tlop',
		duration: 10000,
		fps: 25,
		layers: [{ id: 'l1', name: 'Layer 1', clips: [clip] }],
	})
	eng._airTimelineId = tl.id
	eng._applyClipMixer(1, 202, clip, 0, { force: true, playing: false, fps: 25 })
	const op = mixerCalls.find((c) => c.duration === 0)
	assert.ok(op, 'static clip opacity emits a MIXER OPACITY line')
	assert.strictEqual(op.opacity, 0.5, 'hold opacity honors clip.opacity, not a hardcoded 1')
}

// Default opacity (unset) stays 1 — the change must not shift existing clips.
{
	const { eng, mixerCalls } = makeEngine()
	const clip = { id: 'c2', startTime: 0, duration: 10000, source: { value: 'test.mov' }, keyframes: [] }
	const tl = eng.create({ id: 'tlop2', duration: 10000, fps: 25, layers: [{ id: 'l1', name: 'Layer 1', clips: [clip] }] })
	eng._airTimelineId = tl.id
	eng._applyClipMixer(1, 203, clip, 0, { force: true, playing: false, fps: 25 })
	const op = mixerCalls.find((c) => c.duration === 0)
	assert.ok(op && op.opacity === 1, 'unset clip opacity holds at 1 (unchanged behavior)')
}

console.log('smoke-timeline-opacity-fade: OK')
