'use strict'

/**
 * WO-545 — an exiting timeline's own ticking could re-collide with the take's fade-out DEFER
 * during the teardown wait, not just at the moment the fade-out was built.
 *
 * Owner 02.09: *"going back to a look from timeline does a cut instead of mix."* WO-540 explained
 * one cause (channel running slower than declared, teardown STOPping mid-dissolve) and its
 * software half was fixed and deployed the same session — the owner re-tested and it was STILL
 * cutting. Distinct mechanism, found while investigating WO-544 (the sibling bug on the INCOMING
 * side): `activeTimelineIdToFadeOut` (scene-take-lbg.js / scene-take-pgm-only.js) builds a DEFER
 * fade-to-0 line for the exiting timeline's physical layers, committed with the take. But the
 * timeline itself is still `_airTimelineId` — still ticking via its own `setInterval` — right up
 * until `timelineEngine.stop()` runs, which happens AFTER `runSceneTakeLbgTeardown`'s wait.
 *
 * Precisely: `_applyKeyedMixerProp`'s steady-state branch is already quiet mid-tween-span by
 * design (`shouldSendInstantKeyframeMixer`: `!opts.inTweenSpan` — Caspar's own DEFER is trusted to
 * carry an in-progress segment, so JS does not keep re-sending). The real collision is
 * `segChanged` — if the exiting clip has a keyframe SEGMENT BOUNDARY inside the wait window (a
 * clip with more than two opacity keyframes, or the wait spanning into the next clip on that
 * layer), the engine's own tick fires a fresh, uncoordinated instant+DEFER write on that boundary,
 * fighting the take's own fade-out ramp — exactly the sibling of the WO-544 collision, just
 * triggered by ANY segment crossing during the wait instead of only the very first tick.
 *
 * Fix: `setOpacityExitHold(id)` marks a timeline whose opacity a take orchestrator owns for its
 * exit fade; `_syncAmcpLayers` folds the hold into `takeFade` for every tick of that timeline
 * (reusing WO-528/WO-544's existing suppression in `_applyKeyedMixerProp` — no new suppression
 * logic needed there). `stop()` clears the hold automatically.
 *
 * Every test below stops its engine(s) in a `finally` — `play()` starts a real `setInterval`
 * ticker, and a thrown assertion must never leave one running (it would hang the test process).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { TimelineEngine } = require('../../src/engine/timeline-engine')

function noop() {
	return Promise.resolve()
}

function makeEngine() {
	const self = {
		config: { screen_count: 1 },
		log: () => {},
		mediaDetails: {},
		CHOICES_MEDIAFILES: [],
		amcp: {
			raw: noop,
			stop: noop,
			pause: noop,
			resume: noop,
			call: noop,
			loadbg: noop,
			mixerFill: noop,
			mixerOpacity: noop,
			mixerVolume: noop,
			mixerCommit: noop,
			batchSendChunked: noop,
			sendBatch: noop,
		},
	}
	return new TimelineEngine(self)
}

/** Two opacity segments: 0-400ms (1 -> 0.5), 400-5000ms (0.5 -> 0) — a boundary at 400ms to cross mid-wait. */
function twoSegmentClip() {
	return {
		id: 'c1',
		startTime: 0,
		duration: 60000, // _clipAt requires this — a clip with no duration never matches any ms
		source: { value: 'test.mov' },
		opacity: 1,
		keyframes: [
			{ property: 'opacity', time: 0, value: 1 },
			{ property: 'opacity', time: 400, value: 0.5 },
			{ property: 'opacity', time: 5000, value: 0 },
		],
	}
}

function makeSegmentedTimeline(eng, id = 'tl1') {
	return eng.create({
		id,
		duration: 60000,
		fps: 25,
		layers: [{ id: 'l1', name: 'L1', clips: [twoSegmentClip()] }],
	})
}

/** Establishes segment 0 as current (via play()'s own internal apply, before mocks attach), then
 *  swaps in tracking mocks so the caller can drive a tick across the 400ms boundary. */
function setUpPlayingAcrossBoundary(eng, id = 'tl1') {
	makeSegmentedTimeline(eng, id)
	eng.setSendTo({ preview: false, program: true, screenIdx: 0 })
	eng.play(id, 350) // inside segment 0 (0-400)

	const calls = []
	eng.self.amcp.mixerOpacity = async (ch, l, val, dur) => calls.push(`OPACITY ${ch}-${l} ${val} ${dur}`)
	eng.self.amcp.batchSendChunked = async (lines) => {
		for (const l of lines) calls.push(l)
	}
	return calls
}

describe('WO-545: setOpacityExitHold', () => {
	it('crossing the keyframe boundary while HELD writes nothing', () => {
		const eng = makeEngine()
		try {
			const calls = setUpPlayingAcrossBoundary(eng)
			eng.setOpacityExitHold('tl1')
			eng._syncAmcpOnTimelineTick('tl1', 450) // crosses the 400ms boundary — segIdx 0 -> 1
			assert.deepEqual(calls, [], `no opacity write while the hold is active: ${JSON.stringify(calls)}`)
		} finally {
			eng.stop('tl1')
		}
	})

	it('the SAME boundary crossing without a hold DOES write (proves the hold is what suppresses it)', () => {
		const eng = makeEngine()
		try {
			const calls = setUpPlayingAcrossBoundary(eng)
			eng._syncAmcpOnTimelineTick('tl1', 450) // no hold set this time
			assert.ok(
				calls.some((l) => /^MIXER \d+-\d+ OPACITY .* DEFER$/.test(l)),
				`the boundary crossing fires its own uncoordinated tween without a hold: ${JSON.stringify(calls)}`,
			)
		} finally {
			eng.stop('tl1')
		}
	})

	it('a held boundary crossing does not record segment state either — it re-arms once released', () => {
		const eng = makeEngine()
		try {
			const calls = setUpPlayingAcrossBoundary(eng)
			eng.setOpacityExitHold('tl1')
			eng._syncAmcpOnTimelineTick('tl1', 450)
			assert.deepEqual(calls, [])

			eng.setOpacityExitHold(null) // released — as stop() would do, but tested independently here
			eng._syncAmcpOnTimelineTick('tl1', 470)
			assert.ok(
				calls.some((l) => /DEFER/.test(l)),
				`once released, the boundary tween still gets issued (fail-bright, not fail-dark): ${JSON.stringify(calls)}`,
			)
		} finally {
			eng.stop('tl1')
		}
	})

	it('stop() clears the hold automatically', () => {
		const eng = makeEngine()
		try {
			setUpPlayingAcrossBoundary(eng)
			eng.setOpacityExitHold('tl1')
		} finally {
			eng.stop('tl1')
		}
		assert.equal(eng._opacityExitHoldId, null)
	})

	it('a hold on one timeline does not suppress a DIFFERENT timeline', () => {
		const eng = makeEngine()
		try {
			makeSegmentedTimeline(eng, 'tl1')
			makeSegmentedTimeline(eng, 'tl2')
			eng.setSendTo({ preview: false, program: true, screenIdx: 0 })
			eng.play('tl2', 350)

			const calls = []
			eng.self.amcp.mixerOpacity = async (ch, l, val, dur) => calls.push(`OPACITY ${ch}-${l} ${val} ${dur}`)
			eng.self.amcp.batchSendChunked = async (lines) => {
				for (const l of lines) calls.push(l)
			}

			eng.setOpacityExitHold('tl1') // held, but tl2 is the one actually playing/ticking
			eng._syncAmcpOnTimelineTick('tl2', 450)

			assert.ok(calls.length > 0, `tl2 is unaffected by a hold on tl1: ${JSON.stringify(calls)}`)
		} finally {
			eng.stop('tl2')
		}
	})
})

describe('WO-545: wired into both take orchestrators', () => {
	const lbg = fs.readFileSync(path.join(__dirname, '../../src/engine/scene-take-lbg.js'), 'utf8')
	const pgmOnly = fs.readFileSync(path.join(__dirname, '../../src/engine/scene-take-pgm-only.js'), 'utf8')

	it('scene-take-lbg.js sets the hold under the same gate as the fade-out DEFER', () => {
		assert.match(lbg, /setOpacityExitHold\(activeTimelineIdToFadeOut\)/)
	})

	it('scene-take-pgm-only.js sets the hold under the same gate as its fade-out DEFER', () => {
		assert.match(pgmOnly, /setOpacityExitHold\(activeTimelineIdToFadeOut\)/)
	})
})
