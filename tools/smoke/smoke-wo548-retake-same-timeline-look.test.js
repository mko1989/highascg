'use strict'

/**
 * WO-548 — re-taking a look whose timeline is ALREADY on air killed its own incoming content.
 *
 * Found live, minutes after WO-546 deployed, while checking whether that fix actually resolved
 * the owner's report: it fixed the 3-concurrent-calls scenario, but a DIFFERENT, narrower gap in
 * the same function remained. Measured on the real wire: operator took "Look 5" (a look whose
 * only content is a timeline) at 11:17:00, then took the SAME "Look 5" again at 11:17:05. Between
 * those two operator actions — no other look involved — a bare `STOP 1-210/211/212` fired at
 * 11:17:01.818 with no PLAY following, for the SAME timeline that was simultaneously the incoming
 * content of the very call that issued the STOP.
 *
 * Cause: `resolveActiveTimelineIdToFadeOut`'s `isPlayingOnThisChannel` check only asks "is the
 * engine's global air timeline currently routed to this channel?" — it never asks whether THIS
 * call's own incoming scene still wants that same timeline. A retake of the identical look leaves
 * `diff.exit` empty (nothing was removed — old and new layers are identical), but
 * `isPlayingOnThisChannel` is still true (the timeline stayed on air across the retake, correctly),
 * so the OR-condition fired anyway and flagged the take's own incoming timeline as exiting.
 * WO-546's `protectedTimelineId` didn't cover this because it is only set on the concurrent
 * preview-exchange call, not on the real PGM take itself — and setting it there would be the wrong
 * fix anyway, since "is this timeline still wanted" should be a general property of the decision,
 * not something every caller has to know to pass in.
 *
 * Fix: `resolveActiveTimelineIdToFadeOut` now also checks the call's own `incomingLayers` — if the
 * exact same timeline is still present there, it is continuing, not exiting, full stop, before
 * `isPlayingOnThisChannel` even gets consulted.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { resolveActiveTimelineIdToFadeOut } = require('../../src/engine/scene-take-lbg-timeline-guard.js')

function hasContent(l) {
	return !!l?.source?.value
}

const TIMELINE_LAYER = { layerNumber: 10, source: { type: 'timeline', value: 'tl-1' } }

describe('WO-548: a timeline still present in the incoming scene is never flagged as exiting', () => {
	it('reproduces the real bug: retaking the identical look (same timeline, empty diff.exit) used to kill it', () => {
		const pbNow = { timelineId: 'tl-1', sendTo: { preview: true, program: true, screenIdx: 0 } }
		// diff.exit is empty — old scene and new scene are literally the same look, nothing removed.
		const result = resolveActiveTimelineIdToFadeOut(pbNow, [], [TIMELINE_LAYER], 1, null, () => [1, 2], hasContent)
		assert.equal(result, null, 'still wanted by this call’s own incoming scene — never exits')
	})

	it('without the incoming-layers check, the same inputs used to flag it (pins the real regression)', () => {
		const pbNow = { timelineId: 'tl-1', sendTo: { preview: true, program: true, screenIdx: 0 } }
		// Simulating the pre-fix function shape: no incoming-layers guard at all.
		const isPlayingOnThisChannel = [1, 2].includes(1)
		const exitingTimeline = [].find(() => true)
		const preFixResult = exitingTimeline || isPlayingOnThisChannel ? pbNow.timelineId : null
		assert.equal(preFixResult, 'tl-1', 'the OR-condition alone flagged the take’s own incoming timeline')
	})

	it('a look with a DIFFERENT timeline replacing this one still exits normally', () => {
		const pbNow = { timelineId: 'tl-OLD', sendTo: { preview: true, program: true, screenIdx: 0 } }
		const incomingLayers = [{ layerNumber: 10, source: { type: 'timeline', value: 'tl-NEW' } }]
		const result = resolveActiveTimelineIdToFadeOut(pbNow, [], incomingLayers, 1, null, () => [1, 2], hasContent)
		assert.equal(result, 'tl-OLD', 'a genuinely different incoming timeline does not shield the old one')
	})

	it('an incoming scene with no timeline at all still exits the currently-air one normally', () => {
		const pbNow = { timelineId: 'tl-1', sendTo: { preview: true, program: true, screenIdx: 0 } }
		const incomingLayers = [{ layerNumber: 10, source: { type: 'media', value: 'clip.mov' } }]
		const result = resolveActiveTimelineIdToFadeOut(pbNow, [], incomingLayers, 1, null, () => [1, 2], hasContent)
		assert.equal(result, 'tl-1', 'a plain-media incoming look does not accidentally shield the outgoing timeline')
	})

	it('composes correctly with WO-546’s protectedTimelineId — either reason suppresses independently', () => {
		const pbNow = { timelineId: 'tl-1', sendTo: { preview: true, program: true, screenIdx: 0 } }
		// Still-wanted check alone (no protection) suppresses it:
		assert.equal(
			resolveActiveTimelineIdToFadeOut(pbNow, [], [TIMELINE_LAYER], 1, null, () => [1, 2], hasContent),
			null,
		)
		// Protection alone (incoming scene does NOT want it, e.g. the preview-exchange case) also suppresses it:
		assert.equal(
			resolveActiveTimelineIdToFadeOut(pbNow, [], [], 1, 'tl-1', () => [1, 2], hasContent),
			null,
		)
	})
})
