'use strict'

/**
 * WO-546 — the REAL root cause of "going back to a look from timeline does a cut instead of mix"
 * / "playing from look goes up in opacity then down, then shows up on the next look" — found from
 * the actual AMCP wire log (`log/caspar_2026-09-02.log`), not from theory. WO-544/545 (the same
 * session, hours earlier) fixed a real but different bug and did not touch this path.
 *
 * `routes-scene-take.js`'s pgm/prv "preview exchange" runs the real PGM take
 * (`pgmTakePromise`) and a SECOND, concurrent `runSceneTakeLbg` call that flips the PREVIOUS look
 * onto the preview bus — deliberately concurrent (its own comment: serializing it reintroduces
 * WO-150 B150.1, "wrong look on preview after transition"). `startSceneTimelineLayer` always
 * routes a timeline to BOTH the program and preview channel of its screen (by design, for the
 * normal single-take case). So when the incoming look contains a timeline, BOTH concurrent calls
 * see it as "currently playing on this channel" — and the preview-exchange call, whose own
 * incoming scene (the OLD look) has no timeline, reads that as the timeline exiting THIS take and
 * calls `timelineEngine.stop()` on it, mid-take, from a call that has nothing to do with it.
 *
 * Measured on the real wire at 11:04:15–16 today: `PLAY 1-210/211/212 ...`, then the identical
 * `STOP+PLAY` a second time (the two concurrent callers each independently restarting the SAME
 * timeline), then `STOP 1-210/211/212` with NO further PLAY — the timeline goes dark and stays
 * dark until an unrelated later take happens to reset the layers' opacity back to 1.
 *
 * Fix: `routes-scene-take.js` passes `protectedTimelineId` (the incoming PGM scene's timeline, if
 * any) into the preview-exchange call; `resolveActiveTimelineIdToFadeOut` (split out to its own
 * file to test directly) never treats a protected id as exiting.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { resolveActiveTimelineIdToFadeOut } = require('../../src/engine/scene-take-lbg-timeline-guard.js')

function hasContent(l) {
	return !!l?.source?.value
}

describe('WO-546: resolveActiveTimelineIdToFadeOut', () => {
	it('a protected timeline is never treated as exiting, even though it looks like it is', () => {
		const pbNow = { timelineId: 'tl-1', sendTo: { preview: true, program: true, screenIdx: 0 } }
		const result = resolveActiveTimelineIdToFadeOut(
			pbNow,
			[], // nothing in diff.exit names it either — the "isPlayingOnThisChannel" path is what would trigger
			2, // the preview-exchange call's own channel (bus1)
			'tl-1', // protected: this is the concurrent PGM take's own incoming timeline
			() => [1, 2], // channelsFor: both channels, matching startSceneTimelineLayer's real behavior
			hasContent,
		)
		assert.equal(result, null, 'protected id must never be flagged as exiting')
	})

	it('without protection, the identical inputs DO flag it (pins the pre-fix bug for real)', () => {
		const pbNow = { timelineId: 'tl-1', sendTo: { preview: true, program: true, screenIdx: 0 } }
		const result = resolveActiveTimelineIdToFadeOut(pbNow, [], 2, null, () => [1, 2], hasContent)
		assert.equal(result, 'tl-1', 'without the guard, isPlayingOnThisChannel alone marks it exiting')
	})

	it('protection only shields the NAMED id — a genuinely different exiting timeline still fades', () => {
		const pbNow = { timelineId: 'tl-OTHER', sendTo: { preview: true, program: true, screenIdx: 0 } }
		const result = resolveActiveTimelineIdToFadeOut(pbNow, [], 2, 'tl-1', () => [1, 2], hasContent)
		assert.equal(result, 'tl-OTHER', 'protecting tl-1 does not shield an unrelated exiting timeline')
	})

	it('no timeline currently air: always null, protection or not', () => {
		assert.equal(resolveActiveTimelineIdToFadeOut(null, [], 2, 'tl-1', () => [1, 2], hasContent), null)
		assert.equal(resolveActiveTimelineIdToFadeOut({ timelineId: null }, [], 2, 'tl-1', () => [1, 2], hasContent), null)
	})

	it('a timeline named in diff.exit but on a DIFFERENT channel still exits normally when unprotected', () => {
		const pbNow = { timelineId: 'tl-2', sendTo: { preview: true, program: true, screenIdx: 5 } }
		const diffExit = [{ source: { type: 'timeline', value: 'tl-2' } }]
		const result = resolveActiveTimelineIdToFadeOut(pbNow, diffExit, 2, null, () => [9, 10], hasContent)
		assert.equal(result, 'tl-2', 'named in this channel’s own exit diff — exits regardless of isPlayingOnThisChannel')
	})
})

describe('WO-546: routes-scene-take.js wiring', () => {
	const src = fs.readFileSync(path.join(__dirname, '../../src/api/routes-scene-take.js'), 'utf8')

	it('extracts the incoming PGM scene’s timeline id', () => {
		assert.match(src, /function incomingTimelineId\(scene\)/)
		assert.match(src, /l\.source\?\.type === 'timeline'/)
	})

	it('passes it into the preview-exchange runSceneTakeLbg call specifically', () => {
		const exchangeCallStart = src.indexOf('incomingScene: previousPgmScene')
		assert.ok(exchangeCallStart > 0, 'found the preview-exchange call')
		const nearby = src.slice(exchangeCallStart, exchangeCallStart + 400)
		assert.match(nearby, /protectedTimelineId: incomingTimelineId\(inc\)/)
	})

	it('the staging call and the real PGM take are NOT given protectedTimelineId — only the exchange call needs it', () => {
		const stagingCallStart = src.indexOf('currentScene: prvCurrent')
		const pgmCallStart = src.indexOf('const pgmTakePromise = runSceneTakeLbg')
		assert.ok(stagingCallStart > 0 && pgmCallStart > 0, 'found both call sites')
		assert.doesNotMatch(src.slice(stagingCallStart, stagingCallStart + 250), /protectedTimelineId/)
		assert.doesNotMatch(src.slice(pgmCallStart, pgmCallStart + 250), /protectedTimelineId/)
	})
})
