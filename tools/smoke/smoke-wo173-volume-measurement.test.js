'use strict'

const assert = require('assert')
const { TimelineEngine } = require('../../src/engine/timeline-engine')

function makeEngine() {
	const mixerLines = []
	const batchCalls = []
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
			mixerCommit: () => Promise.resolve(),
			batchSendChunked: (lines, options) => {
				batchCalls.push({ lines: [...(lines || [])], options })
				for (const line of lines || []) {
					if (line.includes('MIXER') && line.includes('OPACITY')) {
						mixerLines.push(line)
					}
				}
				return Promise.resolve()
			},
		},
	}
	const eng = new TimelineEngine(self)
	return { eng, mixerLines, batchCalls }
}

// T173.7: Volume measurement smoke
// Simulate 10s of playback (250 ticks at 40ms each) with 3 layers,
// each with one 2s opacity fade. Count total MIXER OPACITY lines sent.
// Expected: < 40 lines (boundaries-proportional, not ticks-proportional).
;(async () => {
	{
		const { eng, mixerLines, batchCalls } = makeEngine()

		const makeClip = (id, startTime) => ({
			id,
			startTime,
			duration: 10000,
			source: { value: `test${id}.mov` },
			keyframes: [
				// One 2s opacity fade at clip start
				{ time: 0, property: 'opacity', value: 0, easing: 'linear' },
				{ time: 2000, property: 'opacity', value: 1, easing: 'linear' },
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

		// Play to start playback (counts as batch 1)
		eng.play(tl.id, 0)
		if (eng._ticker) {
			clearInterval(eng._ticker)
			eng._ticker = null
		}

		// Simulate 10s of playback with 250 ticks (starting after clip start)
		const tickMs = 40 // TICK_MS
		const totalMs = 10000
		const tickCount = Math.floor(totalMs / tickMs)

		// Count all lines from the start (including clip start)
		const linesSentAtStart = mixerLines.length
		const batchesAtStart = batchCalls.length

		for (let tick = 1; tick <= tickCount; tick++) {
			const ms = tick * tickMs
			eng._pbFor(tl.id)._p0 = 0
			eng._pbFor(tl.id)._t0 = Date.now() - ms
			eng._syncAmcpOnTimelineTick(tl.id, ms)
		}

		const linesFromTicks = mixerLines.length - linesSentAtStart
		const totalLines = mixerLines.length

		// Count MIXER OPACITY lines
		console.log(`T173.7: ${tickCount} ticks × 3 layers = ${tickCount * 3} layer-ticks`)
		console.log(`  MIXER OPACITY lines at clip start: ${linesSentAtStart}`)
		console.log(`  MIXER OPACITY lines from ticks: ${linesFromTicks}`)
		console.log(`  Total MIXER OPACITY lines: ${totalLines}`)
		console.log(`  Batches: ${batchCalls.length}`)

		// Assert that we sent far fewer lines than ticks would suggest (O(boundaries), not O(ticks))
		assert.ok(
			totalLines < 40,
			`should send < 40 total MIXER OPACITY lines for 250 ticks; got ${totalLines}`,
		)

		// In 10s with one 2s fade per layer, we expect:
		// - Clip start: 2 lines per layer × 3 layers = 6 lines total
		// - Ticks: 0 lines (no more boundaries crossed)
		// So we expect 6 lines total
		const maxExpected = 40
		console.log(`✓ MIXER volume proportional to boundaries: ${totalLines} lines (limit: ${maxExpected})`)

		eng.stop(tl.id, { skipAmcp: true })
	}

	console.log('smoke-wo173-volume-measurement: OK')
})().catch((err) => {
	console.error('smoke-wo173-volume-measurement failed:', err.message)
	process.exit(1)
})
