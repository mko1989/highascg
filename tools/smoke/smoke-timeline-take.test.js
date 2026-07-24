'use strict'

const assert = require('assert')
const { transitionIsCut } = require('../../src/engine/timeline-take')
const { normalizeTransition } = require('../../src/engine/scene-transition')
const { TIMELINE_LAYER_BASE } = require('../../src/engine/timeline-playback-helpers')

{
	const t = normalizeTransition({ type: 'MIX', duration: 25, tween: 'linear' }, false)
	assert.strictEqual(transitionIsCut(t), false)
}

{
	const t = normalizeTransition({ type: 'CUT', duration: 0, tween: 'linear' }, false)
	assert.strictEqual(transitionIsCut(t), true)
}

{
	const mixerCalls = []
	const batchLines = []
	const transportCalls = []
	const self = {
		config: { screen_count: 1 },
		amcp: {
			raw: (cmd) => {
				transportCalls.push(cmd)
				return Promise.resolve()
			},
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
	const { TimelineEngine } = require('../../src/engine/timeline-engine')
	const eng = new TimelineEngine(self)
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
		sendTo: { preview: false, program: true, screenIdx: 0 },
		layers: [{ id: 'l1', name: 'Layer 1', clips: [clip] }],
	})

	void (async () => {
		await eng.playForTake(tl.id, 0)
		assert.strictEqual(eng._airTimelineId, tl.id)
		assert.strictEqual(eng.getPlayback(tl.id).playing, true)
		const opacityLines = batchLines.filter((l) => l.includes(' OPACITY '))
		assert.ok(opacityLines.length >= 2, 'playForTake schedules clip fade-in on program route')
		assert.match(opacityLines[0], new RegExp(`1-${TIMELINE_LAYER_BASE} OPACITY 0 0`))
		// T173: transport is now batched via batchSendChunked, so check batchLines
		const playLine = batchLines.some((c) => c.includes(`PLAY 1-${TIMELINE_LAYER_BASE}`))
		assert.ok(
			playLine || transportCalls.some((c) => c.includes(`PLAY 1-${TIMELINE_LAYER_BASE}`)),
			'playForTake starts transport on PGM',
		)
		console.log('smoke-timeline-take: OK')
	})().catch((err) => {
		console.error(err)
		process.exit(1)
	})
}

// Bug: after Take (program:true) a timeline that STOPS (e.g. a look replaces it) must reset to
// preview-only — otherwise re-activating the Timeline tab re-adopts the stale program flag and
// re-routes it onto PGM, interrupting the live look. stop() of an on-air timeline clears program.
{
	const noop = () => Promise.resolve()
	const self = {
		config: { screen_count: 1 },
		amcp: {
			raw: noop, stop: noop, pause: noop, resume: noop, call: noop,
			mixerFill: noop, mixerOpacity: noop, mixerVolume: noop, mixerCommit: noop,
			batchSendChunked: noop,
		},
	}
	const { TimelineEngine } = require('../../src/engine/timeline-engine')
	const eng = new TimelineEngine(self)
	const tl = eng.create({
		id: 'tlb',
		duration: 10000,
		fps: 25,
		sendTo: { preview: false, program: true, screenIdx: 0 },
		layers: [{ id: 'l1', name: 'Layer 1', clips: [] }],
	})
	void (async () => {
		await eng.playForTake(tl.id, 0)
		assert.strictEqual(eng._airTimelineId, tl.id, 'on air after take')
		assert.strictEqual(tl.sendTo.program, true, 'take put it on PGM')
		eng.stop(tl.id)
		assert.strictEqual(eng._airTimelineId, null, 'no longer on air')
		assert.strictEqual(tl.sendTo.program, false, 'stop clears the program flag')
		assert.strictEqual(tl.sendTo.preview, true, 'stop restores preview-only')
		assert.strictEqual(tl.sendTo.screenIdx, 0, 'screenIdx preserved')
		assert.strictEqual(eng.getPlayback(tl.id).sendTo.program, false, 'broadcast carries the cleared flag')
		console.log('smoke-timeline-take stop-resets-sendTo: OK')
	})().catch((err) => {
		console.error(err)
		process.exit(1)
	})
}
