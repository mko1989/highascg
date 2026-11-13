'use strict'

const assert = require('assert')
const { TimelineEngine } = require('../../src/engine/timeline-engine')
const { msToMixerFrames } = require('../../src/engine/timeline-keyframe-mixer')

function makeEngine() {
	const batchCalls = []
	const commitCalls = []
	let batchesDone = 0
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
				commitCalls.push({ ch, afterBatches: batchesDone })
				return Promise.resolve()
			},
			batchSendChunked: (lines, options) => {
				batchCalls.push({ lines: [...(lines || [])], options })
				// like the real client: the lines reach the wire later than a direct send queued now
				return new Promise((resolve) => setImmediate(() => (batchesDone++, resolve())))
			},
		},
	}
	const eng = new TimelineEngine(self)
	return { eng, batchCalls, commitCalls }
}

// T173.5: 3 layers crossing opacity segments on the same tick
// Each layer fades from 0 to 1 over 100ms, crossing boundary at tick time.
// Expect: exactly one batch containing all 6 MIXER lines (2 per layer) + one commit.
;(async () => {
	{
		const { eng, batchCalls, commitCalls } = makeEngine()

		const makeClip = (id, startTime) => ({
			id,
			startTime,
			duration: 10000,
			source: { value: `test${id}.mov` },
			keyframes: [
				// Segment 1: [0, 100) fades 0→1
				{ time: 0, property: 'opacity', value: 0, easing: 'linear' },
				{ time: 100, property: 'opacity', value: 1, easing: 'linear' },
				// Segment 2: [100, 200) fades 1→0 (to test boundary crossing)
				{ time: 200, property: 'opacity', value: 0, easing: 'linear' },
			],
		})

		const tl = eng.create({
			id: 'tl1',
			duration: 10000,
			fps: 25,
			layers: [
				{ id: 'l1', name: 'Layer 1', clips: [makeClip('c1', 0)] },
				{ id: 'l2', name: 'Layer 2', clips: [makeClip('c2', 0)] },
				{ id: 'l3', name: 'Layer 3', clips: [makeClip('c3', 0)] },
			],
		})
		eng._airTimelineId = tl.id

		// Play to initialize
		eng.play(tl.id, 0)
		if (eng._ticker) {
			clearInterval(eng._ticker)
			eng._ticker = null
		}

		// Clear counts after play
		batchCalls.length = 0
		commitCalls.length = 0

		// Tick at ms 40: within segment [0, 100), no segment boundary
		// Should send zero AMCP
		eng._syncAmcpOnTimelineTick(tl.id, 40)
		assert.strictEqual(batchCalls.length, 0, `tick@40ms should send no batches; got ${batchCalls.length}`)

		// Clear for next test
		batchCalls.length = 0
		commitCalls.length = 0

		// Tick at ms 100: at segment boundary, 3 layers should sync opacity
		// Expect exactly one batch with 6 MIXER lines (2 per layer) + one commit per channel
		eng._syncAmcpOnTimelineTick(tl.id, 100)

		assert.strictEqual(batchCalls.length, 1, `tick@100ms should send exactly 1 batch; got ${batchCalls.length}`)
		const batch = batchCalls[0]
		const lines = batch.lines
		assert.ok(Array.isArray(lines), 'batch lines should be array')

		// Count MIXER lines (should be 6: 2 per layer for opacity start and tween)
		const mixerLines = lines.filter((l) => l.includes('MIXER'))
		assert.ok(
			mixerLines.length === 6,
			`batch should contain exactly 6 MIXER lines for 3 layers crossing segment; got ${mixerLines.length}: ${mixerLines.join('; ')}`
		)

		// Verify DEFER lines (one per layer for tween end)
		const deferLines = lines.filter((l) => l.includes('DEFER'))
		assert.strictEqual(deferLines.length, 3, `should have 3 DEFER lines (one per layer tween)`)

		// One MIXER COMMIT per channel, and only AFTER the batch with the DEFER tweens is on the wire: a commit
		// queued at once overtakes them and the fade never fires (box 13.11, stills on a timeline).
		assert.strictEqual(commitCalls.length, 0, 'the commit waits for the batch')
		await new Promise((r) => setTimeout(r, 20))
		assert.ok(commitCalls.length >= 1, `should have ≥1 commit; got ${commitCalls.length}`)
		assert.ok(commitCalls.every((c) => c.afterBatches >= 1), 'commit sent after the tween batch')

		eng.stop(tl.id, { skipAmcp: true })
	}

	console.log('smoke-wo173-keyframe-batch-tick: OK')
})().catch((err) => {
	console.error('smoke-wo173-keyframe-batch-tick failed:', err.message)
	process.exit(1)
})
