'use strict'

/**
 * WO-536 — a clip with **Loop** ticked restarted its producer instead of seeking.
 *
 * Owner 14.08 (`todos14.08.26`), two reports, one bug:
 *   line 6:  *"when pausing a timeline, jumping the playhead somewhere else and hitting play again
 *             results in a black frame before it starts playing."*
 *   line 12: *"i just changed a clip on timeline that was extended to make it loop multiple times
 *             and it doesnt start in correct place in regard to timelines playhead."*
 *
 * `clip.loopAlways` was excluded from the paused scrub seek AND handled by an exclusive branch that
 * never reached the scrub cases at all — so a scrub sent nothing, `_prevKey.frame` went stale,
 * `_validateClipStateForResume` therefore declined, and `play()` fell through to a full transport:
 * `STOP` + `PLAY … LOOP`. The STOP/PLAY is the black frame; the PLAY carried no start position, so
 * the clip also resumed at its IN point rather than at the playhead.
 *
 * Only `loopAlways` was affected — `implicitLoop` (a clip stretched past its media, WO-449) was
 * always correct, and both are asserted here so a future change cannot quietly swap which is broken.
 *
 * The CasparCG side is settled from the source the running binary was built from
 * (`~/caspar-build/src-tree` @ b96e58d60, whose `build/shell/casparcg` is md5-identical to
 * `highascg/bin/casparcg`): `CALL … SEEK` reaches `AVProducer::seek`, which touches neither `loop_`
 * nor `start_`, so looping survives it — whereas `PLAY … LOOP SEEK n` would alias SEEK onto IN and
 * move the loop's start point. See `loopSeekIsSafe`'s doc comment.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { TimelineEngine } = require('../../src/engine/timeline-engine')
const { loopSeekIsSafe } = require('../../src/engine/timeline-playback-helpers')

/** Records the transport commands; mixer traffic is not what this WO is about. */
function makeEngine(clipOpts = {}, mediaMs = null) {
	const wire = []
	const noop = () => Promise.resolve()
	const self = {
		config: { screen_count: 1 },
		log: () => {},
		mediaDetails: {},
		CHOICES_MEDIAFILES: [],
		_mediaProbeCache: mediaMs ? { 'test.mov': { durationMs: mediaMs } } : {},
		amcp: {
			raw: (s) => { if (/^PLAY/.test(s)) wire.push(s.replace(/\s+AF\s.*$/, '')); return Promise.resolve() },
			stop: (ch, l) => { wire.push(`STOP ${ch}-${l}`); return Promise.resolve() },
			pause: (ch, l) => { wire.push(`PAUSE ${ch}-${l}`); return Promise.resolve() },
			resume: (ch, l) => { wire.push(`RESUME ${ch}-${l}`); return Promise.resolve() },
			call: (ch, l, cmd, arg) => { wire.push(`CALL ${ch}-${l} ${cmd} ${arg}`); return Promise.resolve(arg) },
			loadbg: noop, mixerFill: noop, mixerOpacity: noop, mixerVolume: noop,
			mixerCommit: noop, batchSendChunked: noop, sendBatch: noop,
		},
	}
	const eng = new TimelineEngine(self)
	const tl = eng.create({
		id: 'tl1',
		duration: 60000,
		fps: 25,
		layers: [{ id: 'l1', name: 'L1', clips: [{ id: 'c1', startTime: 0, duration: 60000, source: { value: 'test.mov' }, ...clipOpts }] }],
	})
	eng.setSendTo({ preview: true, program: false, screenIdx: 0 })
	return { eng, tl, wire }
}

/** play(4000) -> pause -> seek(20000) -> play, reporting each phase's transport. */
function pauseScrubPlay(clipOpts, mediaMs) {
	const { eng, tl, wire } = makeEngine(clipOpts, mediaMs)
	eng.play(tl.id, 4000)
	const onPlay = wire.splice(0)
	eng.pause(tl.id)
	wire.length = 0
	eng.seek(tl.id, 20000)
	const onScrub = wire.splice(0)
	const canResume = eng._canResumePlayback(tl.id)
	eng.play(tl.id)
	const onResume = wire.splice(0)
	eng.stop(tl.id, { skipAmcp: true })
	return { onPlay, onScrub, canResume, onResume }
}

describe('WO-536: a looping clip is repositioned, not restarted', () => {
	it('the scrub reaches the wire, so the resume shortcut stays available', () => {
		const r = pauseScrubPlay({ loopAlways: true })
		assert.deepEqual(r.onScrub, ['CALL 2-210 SEEK 500'], 'a scrub used to send NOTHING for a looping clip')
		assert.equal(r.canResume, true, 'which is what left _prevKey.frame stale and killed the resume')
	})

	it('and the play that follows no longer tears the producer down', () => {
		const r = pauseScrubPlay({ loopAlways: true })
		assert.equal(r.onResume.filter((l) => l.startsWith('STOP')).length, 0, 'STOP + PLAY is the black frame')
		assert.equal(r.onResume.filter((l) => l.startsWith('PLAY')).length, 0)
	})

	it('starting a looping clip mid-timeline seeks to the playhead', () => {
		const r = pauseScrubPlay({ loopAlways: true })
		assert.deepEqual(r.onPlay, [
			'STOP 2-210',
			'PLAY 2-210 "test.mov" LOOP',
			'CALL 2-210 SEEK 100', // 4000 ms @ 25 fps
		], 'the PLAY carried no position at all, so the clip began at its IN point')
	})

	it('the seek is a separate CALL — never folded into the PLAY, which would move the loop IN point', () => {
		const r = pauseScrubPlay({ loopAlways: true })
		for (const line of r.onPlay) {
			if (line.startsWith('PLAY')) assert.doesNotMatch(line, /SEEK/, 'PLAY … LOOP SEEK n aliases SEEK onto IN')
		}
	})

	it('a stretched-past-media clip wraps the scrub target with the loop modulo', () => {
		// 60 s of timeline over a 10 s file: frame 500 wraps to 0 within the 250-frame span.
		const r = pauseScrubPlay({ loopAlways: true }, 10000)
		assert.deepEqual(r.onScrub, ['CALL 2-210 SEEK 0'])
		assert.equal(r.canResume, true)
		assert.equal(r.onResume.length, 0)
	})
})

describe('WO-536: the paths that were already correct stay correct', () => {
	it('a plain clip is untouched', () => {
		const r = pauseScrubPlay({})
		assert.deepEqual(r.onScrub, ['CALL 2-210 SEEK 500'])
		assert.deepEqual(r.onResume, ['RESUME 2-210'])
	})

	it('implicitLoop (stretched, Loop NOT ticked) is untouched — it was never the broken one', () => {
		const r = pauseScrubPlay({}, 10000)
		assert.deepEqual(r.onScrub, ['CALL 2-210 SEEK 0'])
		assert.deepEqual(r.onResume, ['RESUME 2-210'])
	})
})

describe('WO-536: loopSeekIsSafe refuses only what the producer cannot survive', () => {
	it('a frame inside the loop span is fine', () => {
		assert.equal(loopSeekIsSafe({ frame: 100, inFrames: 0, loopSpanFrames: 250 }), true)
	})

	it('frame 0 is a legal scrub target', () => {
		assert.equal(loopSeekIsSafe({ frame: 0, inFrames: 0, loopSpanFrames: 250 }), true)
	})

	it('the last frames are refused — seek_internal resets frame_count_, so EOF beats the >2 wrap guard', () => {
		assert.equal(loopSeekIsSafe({ frame: 248, inFrames: 0, loopSpanFrames: 250 }), false)
		assert.equal(loopSeekIsSafe({ frame: 247, inFrames: 0, loopSpanFrames: 250 }), true)
	})

	it('the in-point offsets the window', () => {
		assert.equal(loopSeekIsSafe({ frame: 348, inFrames: 100, loopSpanFrames: 250 }), false)
		assert.equal(loopSeekIsSafe({ frame: 300, inFrames: 100, loopSpanFrames: 250 }), true)
	})

	it('an unknown span cannot be near an end, and a route has no frames at all', () => {
		assert.equal(loopSeekIsSafe({ frame: 5000 }), true)
		assert.equal(loopSeekIsSafe({ frame: 100, isRoute: true }), false)
		assert.equal(loopSeekIsSafe({ frame: -1 }), false)
		assert.equal(loopSeekIsSafe(null), false)
	})
})
