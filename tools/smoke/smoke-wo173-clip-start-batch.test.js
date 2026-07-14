'use strict'

const assert = require('assert')
const { TimelineEngine } = require('../../src/engine/timeline-engine')
const { msToMixerFrames } = require('../../src/engine/timeline-keyframe-mixer')

function makeEngine() {
	const batchCalls = []
	const commitCalls = []
	const noop = () => Promise.resolve()
	const self = {
		config: { screen_count: 1 },
		amcp: {
			raw: noop,
			stop: noop,
			pause: noop,
			resume: noop,
			call: noop,
			mixerFill: noop,
			mixerOpacity: noop,
			mixerVolume: noop,
			mixerCommit: (ch) => {
				commitCalls.push({ ch })
				return Promise.resolve()
			},
			batchSendChunked: (lines, options) => {
				batchCalls.push({ lines: [...(lines || [])], options })
				return Promise.resolve()
			},
		},
	}
	const eng = new TimelineEngine(self)
	return { eng, batchCalls, commitCalls }
}

// T173.3: Clip with opacity keyframes 0→1 over 500ms starting at ms 0
// Should produce exactly one batch on clip start containing:
// - STOP + OPACITY 0 0 (init) + PLAY + OPACITY 1 13 linear DEFER (tween)
// And exactly one commit for the channel
;(async () => {
	{
		const { eng, batchCalls, commitCalls } = makeEngine()
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

		// Play will trigger the clip start; clear pre-play calls
		batchCalls.length = 0
		commitCalls.length = 0

		// Play triggers _applyAt which calls _syncAmcpLayers with force=true
		eng.play(tl.id, 0)
		if (eng._ticker) {
			clearInterval(eng._ticker)
			eng._ticker = null
		}

		// T173.3.1: exactly one batch on clip start
		assert.strictEqual(
			batchCalls.length,
			1,
			`should have exactly 1 batch on clip start; got ${batchCalls.length}`,
		)

		const batch = batchCalls[0]
		const lines = batch.lines
		assert.ok(Array.isArray(lines), 'batch lines should be array')
		assert.ok(lines.length >= 4, `batch should have ≥4 lines (STOP, PLAY, OPACITY start, OPACITY tween DEFER); got ${lines.length}`)

		// Check STOP
		const stopLine = lines.find((l) => l.startsWith('STOP'))
		assert.ok(stopLine, `batch should contain STOP`)
		assert.ok(/STOP \d+-\d+/.test(stopLine), `STOP format should be "STOP ch-layer"; got: ${stopLine}`)

		// Check PLAY
		const playLine = lines.find((l) => l.startsWith('PLAY') && l.includes('test.mov'))
		assert.ok(playLine, 'batch should contain PLAY with source')

		// Check opacity init (MIXER OPACITY 0 0)
		const opacityInitLine = lines.find((l) => l.includes('OPACITY') && l.endsWith(' 0'))
		assert.ok(opacityInitLine, 'batch should contain OPACITY init (duration 0)')
		assert.match(opacityInitLine, /OPACITY 0 0$/, 'should initialize opacity to 0 with duration 0')

		// Check opacity tween (MIXER OPACITY 1 <dur> linear DEFER)
		const opacityTweenLine = lines.find((l) => l.includes('DEFER'))
		assert.ok(opacityTweenLine, 'batch should contain OPACITY tween with DEFER')
		const expectedFrames = msToMixerFrames(500, 25)
		assert.match(opacityTweenLine, /OPACITY 1 \d+ linear DEFER/, 'tween should be OPACITY 1 <frames> linear DEFER')
		assert.match(opacityTweenLine, new RegExp(`OPACITY 1 ${expectedFrames}`), `tween duration should be ${expectedFrames} frames for 500ms@25fps`)

		// T173.3.2: exactly one commit on clip start tick
		assert.ok(commitCalls.length >= 1, `should have ≥1 commit on clip start; got ${commitCalls.length}`)

		// T173.3.3: next two ticks send no batches
		batchCalls.length = 0
		commitCalls.length = 0

		// Tick 2 at ms 40
		eng._pbFor(tl.id)._p0 = 0
		eng._pbFor(tl.id)._t0 = Date.now() - 40
		eng._syncAmcpOnTimelineTick(tl.id, 40)
		assert.strictEqual(batchCalls.length, 0, `tick 2 should send no batches; got ${batchCalls.length}`)

		// Tick 3 at ms 80
		eng._pbFor(tl.id)._p0 = 0
		eng._pbFor(tl.id)._t0 = Date.now() - 80
		eng._syncAmcpOnTimelineTick(tl.id, 80)
		assert.strictEqual(batchCalls.length, 0, `tick 3 should send no batches; got ${batchCalls.length}`)

		eng.stop(tl.id, { skipAmcp: true })
	}

	console.log('smoke-wo173-clip-start-batch: OK')
})().catch((err) => {
	console.error('smoke-wo173-clip-start-batch failed:', err.message)
	process.exit(1)
})
