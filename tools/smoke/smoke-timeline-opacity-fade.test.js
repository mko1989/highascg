'use strict'

const assert = require('assert')
const { TimelineEngine } = require('../../src/engine/timeline-engine')

function makeEngine() {
	const mixerCalls = []
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
			batchSendChunked: () => Promise.resolve(),
		},
	}
	return { eng: new TimelineEngine(self), mixerCalls }
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
	const { eng, mixerCalls } = makeEngine()
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
	eng._applyClipMixer(1, 201, clip, 0, { force: true, playing: false, fps: 25 })
	const opacityCalls = mixerCalls.filter((c) => c.layer === 201)
	assert.ok(opacityCalls.length >= 2, 'fade-in schedules start + tween before play')
	assert.strictEqual(opacityCalls[0].opacity, 0)
	assert.strictEqual(opacityCalls[0].duration, 0)
	assert.strictEqual(opacityCalls[1].opacity, 1)
	assert.strictEqual(opacityCalls[1].duration, 13)
	assert.strictEqual(opacityCalls[1].tween, 'linear')
}

console.log('smoke-timeline-opacity-fade: OK')
