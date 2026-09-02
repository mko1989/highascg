'use strict'

/**
 * WO-550 — previewing an unrelated look on PRV could still kill a timeline live on PGM.
 *
 * Owner 02.09, after WO-549: *"its better but there are still issue coming from recalling to prv
 * probably."* Measured on the wire: with a timeline live on program (via an earlier take), clicking
 * to preview a different, timeline-free look on PRV produced `STOP 1-210/211/212` (killing the
 * PROGRAM copy) alongside `STOP 2-210/211/212` (the preview copy it actually meant to replace) —
 * no replay on either channel.
 *
 * WO-549 added `restrictTimelineToPreview` so a PRV-only call's OWN incoming timeline (if any)
 * only ever gets ROUTED to preview. It said nothing about an EXISTING timeline the call doesn't
 * even mention: `resolveActiveTimelineIdToFadeOut` still asked "is the current air timeline
 * routed to this channel?" — true, since a real take had earlier routed it to both — and happily
 * flagged it as exiting from a call whose own incoming scene has nothing to do with it. Since
 * `timelineEngine.stop()` kills a timeline everywhere at once (there's no "remove from preview
 * only" primitive), a PRV-only call correctly concluding "not part of my content" and calling
 * stop() anyway took PROGRAM off the air over an action that was only ever supposed to touch
 * preview.
 *
 * Fix: reuse the same `restrictTimelineToPreview` flag (now passed as `previewOnlyCall`) to also
 * gate the teardown decision — if the currently-air timeline is ALSO currently routed to program,
 * a preview-scoped call must never be the one that tears it down.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { resolveActiveTimelineIdToFadeOut } = require('../../src/engine/scene-take-lbg-timeline-guard.js')

function hasContent(l) {
	return !!l?.source?.value
}

describe('WO-550: a preview-only call never tears down a timeline that is live on program', () => {
	it('reproduces the real bug: previewing an unrelated look on PRV while a timeline is live on PGM+PRV', () => {
		// Exactly the measured scenario: timeline routed to both channels (a real earlier take put
		// it there), this call's own channel (bus1=2) is among them, so isPlayingOnThisChannel alone
		// would flag it — previewOnlyCall must override that.
		const pbNow = { timelineId: 'tl-1', sendTo: { preview: true, program: true, screenIdx: 0 } }
		const result = resolveActiveTimelineIdToFadeOut(
			pbNow,
			[], // this preview's own incoming scene doesn't mention the timeline at all
			[], // ...nor does its incoming layers list
			2, // bus1 — the preview channel this call actually targets
			null, // no protectedTimelineId in play here (this isn't the WO-546 concurrent-take scenario)
			() => [1, 2], // the timeline's sendTo resolves to both channels
			hasContent,
			true, // previewOnlyCall
		)
		assert.equal(result, null, 'a preview-only call must never flag a program-live timeline as exiting')
	})

	it('without previewOnlyCall, the identical inputs DO flag it (pins the pre-fix behavior, still correct for a real take)', () => {
		const pbNow = { timelineId: 'tl-1', sendTo: { preview: true, program: true, screenIdx: 0 } }
		const result = resolveActiveTimelineIdToFadeOut(pbNow, [], [], 2, null, () => [1, 2], hasContent, false)
		assert.equal(result, 'tl-1', 'a real (non-preview-restricted) take still tears down an exiting timeline normally')
	})

	it('previewOnlyCall does NOT protect a timeline that is only on preview, not program', () => {
		// If the timeline was never on program in the first place, a preview-only call replacing it
		// on the preview bus is exactly the correct, harmless case — no PGM content at stake.
		const pbNow = { timelineId: 'tl-1', sendTo: { preview: true, program: false, screenIdx: 0 } }
		const result = resolveActiveTimelineIdToFadeOut(pbNow, [], [], 2, null, () => [2], hasContent, true)
		assert.equal(result, 'tl-1', 'preview-only content is fair game for a preview-only call to replace')
	})

	it('composes with WO-548: still wanted by this call’s own incoming scene wins regardless of previewOnlyCall', () => {
		const pbNow = { timelineId: 'tl-1', sendTo: { preview: true, program: true, screenIdx: 0 } }
		const incomingLayers = [{ layerNumber: 10, source: { type: 'timeline', value: 'tl-1' } }]
		const result = resolveActiveTimelineIdToFadeOut(pbNow, [], incomingLayers, 2, null, () => [1, 2], hasContent, false)
		assert.equal(result, null, 'reason 1 (WO-548) already suppresses it independently of previewOnlyCall')
	})

	it('composes with WO-546: protectedTimelineId and previewOnlyCall are independent, either alone suppresses', () => {
		const pbNow = { timelineId: 'tl-1', sendTo: { preview: true, program: true, screenIdx: 0 } }
		// protectedTimelineId alone, previewOnlyCall false:
		assert.equal(
			resolveActiveTimelineIdToFadeOut(pbNow, [], [], 2, 'tl-1', () => [1, 2], hasContent, false),
			null,
		)
		// previewOnlyCall alone, no protectedTimelineId:
		assert.equal(
			resolveActiveTimelineIdToFadeOut(pbNow, [], [], 2, null, () => [1, 2], hasContent, true),
			null,
		)
	})

	it('a genuinely different exiting timeline still fades out normally even from a preview-only call, if it is not on program', () => {
		const pbNow = { timelineId: 'tl-OLD', sendTo: { preview: true, program: false, screenIdx: 0 } }
		const diffExit = [{ source: { type: 'timeline', value: 'tl-OLD' } }]
		const result = resolveActiveTimelineIdToFadeOut(pbNow, diffExit, [], 2, null, () => [2], hasContent, true)
		assert.equal(result, 'tl-OLD', 'preview-only replacement of preview-only content is unaffected')
	})
})

describe('WO-550: routes-scene-take.js wiring reuses restrictTimelineToPreview, no new flag needed', () => {
	const lbgSrc = fs.readFileSync(path.join(__dirname, '../../src/engine/scene-take-lbg.js'), 'utf8')

	it('runSceneTakeLbg passes restrictTimelineToPreview as the teardown guard’s previewOnlyCall too', () => {
		const start = lbgSrc.indexOf('resolveActiveTimelineIdToFadeOut(')
		assert.ok(start > 0)
		const call = lbgSrc.slice(start, lbgSrc.indexOf(')', lbgSrc.indexOf('restrictTimelineToPreview', start)) + 1)
		assert.match(call, /!!opts\.restrictTimelineToPreview/)
	})
})
