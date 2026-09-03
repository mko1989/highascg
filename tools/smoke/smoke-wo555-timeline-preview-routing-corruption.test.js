'use strict'

/**
 * WO-555 — previewing a timeline look could take PROGRAM off the air, and PRV never let go of an
 * old timeline once the operator moved on to a different look.
 *
 * Owner todos02.09.26, live QA after WO-554:
 *   1) "the preview is blocked on the timeline look after playing it. so the pgm and prv show the
 *      same thing until i specificaly click empty space to clear the prv. clicking other looks
 *      doesnt have an effect."
 *   2) "when the timeline look is playing and i click it to prv it, it changes to another random
 *      look on pgm!!!! very bad."
 *
 * Two independent bugs, one shared engine-level cause.
 *
 * **Bug A (report 2, the dangerous one):** `startSceneTimelineLayer` (timeline-take.js) always
 * computed `program: !opts.restrictToPreview` — so previewing a look whose OWN timeline is already
 * the one live on program (`restrictToPreview: true`) forced that timeline's `sendTo.program` to
 * `false`. `TimelineEngine.setSendTo` (timeline-playback-runtime.js) reacts to any routing change
 * on the current air timeline by STOPping every physical layer on the OLD channel list — which
 * unconditionally included program, since the old routing had it. A preview action directly
 * stopped PROGRAM's physical layers; since the timeline sits above both look banks (WO-553), that
 * revealed whatever content was still sitting underneath — "changes to another random look on
 * pgm".
 *
 * **Bug B (report 1):** `resolveActiveTimelineIdToFadeOut`'s WO-550 guard correctly protects a
 * program-live timeline from a preview-scoped call's teardown by doing nothing — but "nothing"
 * also means the timeline's PREVIEW claim is never released when the operator previews a
 * DIFFERENT, timeline-free look. `startSceneTimelineLayer` only runs for a timeline that IS part
 * of the incoming scene, so a look with no timeline layer at all never touches the old one's
 * routing — it keeps rendering on preview forever, until the operator manually clears PRV (which
 * uses a blunt whole-channel `CLEAR`, wiping the timeline band along with everything else).
 *
 * Fix, three parts:
 * - `TimelineEngine.setSendTo`: the routing-change STOP now only targets channels being REMOVED
 *   (in the old channel set, absent from the new one) — a channel wanted by both old and new
 *   routing is never stopped. This alone makes it SAFE to change routing without silently killing
 *   still-wanted output, which the other two fixes both depend on.
 * - `startSceneTimelineLayer`: a preview-restricted call now preserves whatever `program` claim
 *   already exists instead of forcibly overwriting it to `false` — it can only ADD a preview
 *   claim, never remove an existing program one.
 * - `resolveTimelineIdToReleaseFromPreview` (new, scene-take-lbg-timeline-guard.js): when a
 *   preview-scoped call's own incoming content does not want a timeline that is currently on BOTH
 *   buses, release just its PREVIEW claim (`setSendTo({preview:false, program:true})`) — safe only
 *   because of the first fix above.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { TimelineEngine } = require('../../src/engine/timeline-engine')
const { startSceneTimelineLayer } = require('../../src/engine/timeline-take.js')
const { resolveTimelineIdToReleaseFromPreview } = require('../../src/engine/scene-take-lbg-timeline-guard.js')

function hasContent(l) {
	return !!l?.source?.value
}

function makeEngine() {
	const stopped = [] // {ch, layer}
	const noop = () => Promise.resolve()
	const self = {
		config: { screen_count: 1 },
		log: () => {},
		amcp: {
			raw: noop,
			pause: noop,
			resume: noop,
			call: noop,
			mixerFill: noop,
			mixerOpacity: noop,
			mixerVolume: noop,
			mixerCommit: noop,
			batchSendChunked: () => Promise.resolve(),
			stop: (ch, layer) => {
				stopped.push(`${ch}-${layer}`)
				return Promise.resolve()
			},
		},
	}
	const eng = new TimelineEngine(self)
	self.timelineEngine = eng
	eng.create({
		id: 'tl1',
		duration: 60000,
		fps: 25,
		layers: [{ id: 'l1', name: 'L1', clips: [{ id: 'c1', startTime: 0, duration: 60000, source: { value: 'a.mov' } }] }],
	})
	return { self, eng, stopped }
}

describe('WO-555 Bug A: TimelineEngine.setSendTo only stops REMOVED channels', () => {
	it('program 2, preview 1 both live; dropping program to false does not stop channel 1 (preview)', async () => {
		const { eng, stopped } = makeEngine()
		await startSceneTimelineLayer({ timelineEngine: eng, log: () => {} }, eng.self?.amcp || eng.self.amcp, 2, { source: { value: 'tl1' } }, {
			fadeDur: 0,
			screenIdx: 0,
			startAtCurrentPosition: false,
			// unrestricted: claims program only (WO-559) — programCh(1)=1 (default map fallback)
		})
		stopped.length = 0 // only care about what happens on the NEXT routing change
		eng.setSendTo({ preview: true, program: false, screenIdx: 0 }, 'tl1')
		// Channel 2 (preview, per the default map fallback (i+1)*2) must never appear in the stop list.
		assert.ok(!stopped.some((s) => s.startsWith('2-')), `preview channel must not be stopped, got: ${JSON.stringify(stopped)}`)
		// Channel 1 (program, being removed) is the one that should be stopped.
		assert.ok(stopped.some((s) => s.startsWith('1-')), `program channel (being removed) should be stopped, got: ${JSON.stringify(stopped)}`)
	})

	it('a channel present in both old and new routing is never stopped, even when something else changes', async () => {
		const { eng, stopped } = makeEngine()
		eng.play('tl1', 0, { restart: true }) // no sendTo set yet -> default {preview:true, program:false, screenIdx:0}
		stopped.length = 0
		// Add program (preview stays true) — channel 2 (preview) must survive untouched.
		eng.setSendTo({ preview: true, program: true, screenIdx: 0 }, 'tl1')
		assert.ok(!stopped.some((s) => s.startsWith('2-')), `channel present before and after must not be stopped, got: ${JSON.stringify(stopped)}`)
	})

	it('regression check: without the fix, a partial routing change stops the persisting channel too', () => {
		// Direct unit check of the diffing logic itself (independent of the live engine), so this
		// documents the exact defect even if the engine's default channel numbers ever change.
		const oldCh = [1, 2]
		const newCh = [2]
		const removedChCorrect = oldCh.filter((c) => !newCh.includes(c))
		assert.deepEqual(removedChCorrect, [1], 'only channel 1 should be considered removed')
		assert.notDeepEqual(oldCh, removedChCorrect, 'the old (pre-fix) behavior of stopping all of oldCh would have also stopped channel 2')
	})
})

describe('WO-555 Bug A: startSceneTimelineLayer preserves an existing program claim', () => {
	it('restrictToPreview:true on a timeline already routed to program keeps program true', async () => {
		const { self, eng } = makeEngine()
		// First call: unrestricted, establishes program:true (the real earlier take).
		await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, {
			fadeDur: 0,
			screenIdx: 0,
			startAtCurrentPosition: false,
		})
		assert.equal(eng._sendToFor('tl1').program, true)
		// Second call: the operator previews the SAME look, restrictToPreview:true.
		await startSceneTimelineLayer(self, self.amcp, 2, { source: { value: 'tl1' } }, {
			fadeDur: 0,
			screenIdx: 0,
			startAtCurrentPosition: false,
			restrictToPreview: true,
		})
		assert.equal(eng._sendToFor('tl1').program, true, 'a preview action must never revoke an existing program claim')
	})

	it('restrictToPreview:true on a timeline NOT yet on program still routes program:false (WO-549 unchanged)', async () => {
		const { self, eng } = makeEngine()
		await startSceneTimelineLayer(self, self.amcp, 2, { source: { value: 'tl1' } }, {
			fadeDur: 0,
			screenIdx: 0,
			startAtCurrentPosition: false,
			restrictToPreview: true,
		})
		assert.equal(eng._sendToFor('tl1').program, false, 'a genuinely new preview-only claim must not fabricate a program claim')
	})
})

describe('WO-555 Bug B: resolveTimelineIdToReleaseFromPreview', () => {
	it('releases a left-behind timeline that is on both buses, for a preview-only call whose incoming content ignores it', () => {
		const pbNow = { timelineId: 'tl-1', sendTo: { preview: true, program: true, screenIdx: 0 } }
		const result = resolveTimelineIdToReleaseFromPreview(pbNow, [], hasContent, true)
		assert.equal(result, 'tl-1')
	})

	it('does nothing for a real (non-preview-restricted) take — the normal fade-out path owns that case', () => {
		const pbNow = { timelineId: 'tl-1', sendTo: { preview: true, program: true, screenIdx: 0 } }
		assert.equal(resolveTimelineIdToReleaseFromPreview(pbNow, [], hasContent, false), null)
	})

	it('does nothing when the timeline is not on program (nothing special to protect)', () => {
		const pbNow = { timelineId: 'tl-1', sendTo: { preview: true, program: false, screenIdx: 0 } }
		assert.equal(resolveTimelineIdToReleaseFromPreview(pbNow, [], hasContent, true), null)
	})

	it('does nothing when this call\'s own incoming scene still wants the timeline', () => {
		const pbNow = { timelineId: 'tl-1', sendTo: { preview: true, program: true, screenIdx: 0 } }
		const incomingLayers = [{ layerNumber: 10, source: { type: 'timeline', value: 'tl-1' } }]
		assert.equal(resolveTimelineIdToReleaseFromPreview(pbNow, incomingLayers, hasContent, true), null)
	})
})

describe('WO-555: wired end-to-end', () => {
	it('timeline-playback-runtime.js only stops removed channels', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/engine/timeline-playback-runtime.js'), 'utf8')
		assert.match(src, /const removedCh = oldCh\.filter\(\(c\) => !newCh\.includes\(c\)\)/)
		assert.match(src, /for \(const ch of removedCh\)/)
	})

	it('timeline-take.js preserves an existing program claim under restrictToPreview', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/engine/timeline-take.js'), 'utf8')
		assert.match(src, /opts\.restrictToPreview \? !!eng\._sendToFor\(tlId\)\?\.program : true/)
	})

	it('scene-take-lbg.js calls resolveTimelineIdToReleaseFromPreview and releases via setSendTo', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/engine/scene-take-lbg.js'), 'utf8')
		assert.match(src, /resolveTimelineIdToReleaseFromPreview/)
		assert.match(src, /preview: false, program: true, screenIdx: pbNow\.sendTo\?\.screenIdx \}[\s\S]{0,40}releaseId/)
	})
})
