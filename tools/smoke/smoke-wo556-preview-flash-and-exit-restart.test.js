'use strict'

/**
 * WO-556 — two bugs found in WO-555's own live QA, same morning (03.09.2026).
 *
 * Owner: *"first click to prv of another look while timeline look is playying blinks that look on
 * the pgm channel. when switching back to a normal look, the timeline restarts during the
 * transition."*
 *
 * **Bug A (flash):** WO-555's `resolveTimelineIdToReleaseFromPreview` fix (scene-take-lbg.js)
 * called `self.timelineEngine.setSendTo({preview:false, program:true, ...}, releaseId)` to let go
 * of a stale preview claim — but without `{ skipAmcpApply: true }`. `TimelineEngine.setSendTo`'s
 * routing-change handler, when NOT told to skip, fires an unprotected `_applyAt(force:true)`
 * against the timeline's NEW channel set (now program-only) — the exact WO-553 flash class: a raw,
 * instant OPACITY/FILL/VOLUME write to program's timeline layers, as a side effect of a PREVIEW
 * click on a completely different look. The STOP of the dropped (preview) channel is a SEPARATE
 * code path in `setSendTo`, not gated by this flag, so clearing PRV's stale layers is unaffected by
 * this fix — only the redundant, unprotected program-side reapply is skipped.
 *
 * **Bug B (restart):** `routes-scene-take.js`'s pgm/prv `previewExchangePromise` call — which puts
 * the OLD (just-replaced) look onto the preview bus for operator reference — passes
 * `incomingScene: previousPgmScene`. When switching AWAY from a timeline-containing look,
 * `previousPgmScene` IS that look, so `buildTakeJobs` reaches `startSceneTimelineLayer` for the
 * SAME timeline that is concurrently mid exit-fade (or already stopped) via `pgmTakePromise`'s own
 * `activeTimelineIdToFadeOut` handling. That function unconditionally calls
 * `eng.play(tlId, 0, {restart:true})` — restarting the timeline's transport back to position 0 in
 * the middle of what should be a smooth crossfade-out. The call's own preview routing was already
 * correct (untouched since the earlier take put the timeline on both buses); the play() call was
 * the only consequential, and harmful, thing it did.
 *
 * Fix: WO-554's existing `deferTimelinePlay` mechanism (already threaded end-to-end) now also
 * covers the `previewExchangePromise` call site — its timeline handling becomes routing-only.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { TimelineEngine } = require('../../src/engine/timeline-engine')
const { startSceneTimelineLayer } = require('../../src/engine/timeline-take.js')

function makeEngine() {
	const sentLines = []
	const noop = () => Promise.resolve()
	const self = {
		config: { screen_count: 1 },
		log: () => {},
		amcp: {
			raw: noop,
			stop: noop,
			pause: noop,
			resume: noop,
			call: noop,
			mixerFill: noop,
			mixerOpacity: noop,
			mixerVolume: noop,
			mixerCommit: noop,
			batchSendChunked: (lines) => {
				sentLines.push(...(lines || []))
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
	return { self, eng, sentLines }
}

describe('WO-556 Bug A: releasing a preview claim must not flash program', () => {
	it('setSendTo({preview:false, program:true}, {skipAmcpApply:true}) sends no unprotected reapply lines', async () => {
		const { self, eng, sentLines } = makeEngine()
		// Establish: timeline live on both buses (an earlier real take).
		await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, {
			fadeDur: 0,
			screenIdx: 0,
			startAtCurrentPosition: false,
		})
		sentLines.length = 0 // only care about what the release call itself sends
		eng.setSendTo({ preview: false, program: true, screenIdx: 0 }, 'tl1', { skipAmcpApply: true })
		// No PLAY/LOAD/MIXER OPACITY line should be freshly written to program as a side effect.
		assert.equal(sentLines.length, 0, `skipAmcpApply must suppress the reapply, got: ${JSON.stringify(sentLines)}`)
	})

	it('regression check: WITHOUT skipAmcpApply, the same release call DOES write an unprotected reapply', async () => {
		const { self, eng, sentLines } = makeEngine()
		await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, {
			fadeDur: 0,
			screenIdx: 0,
			startAtCurrentPosition: false,
		})
		sentLines.length = 0
		eng.setSendTo({ preview: false, program: true, screenIdx: 0 }, 'tl1') // no opts — the pre-fix call shape
		assert.ok(sentLines.length > 0, 'documents the pre-WO-556 unprotected flash reapply')
	})

	it('the STOP of the dropped preview channel still happens either way (not gated by skipAmcpApply)', async () => {
		const { self, eng } = makeEngine()
		const stopped = []
		self.amcp.stop = (ch, layer) => {
			stopped.push(`${ch}-${layer}`)
			return Promise.resolve()
		}
		await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, {
			fadeDur: 0,
			screenIdx: 0,
			startAtCurrentPosition: false,
		})
		stopped.length = 0
		eng.setSendTo({ preview: false, program: true, screenIdx: 0 }, 'tl1', { skipAmcpApply: true })
		assert.ok(stopped.some((s) => s.startsWith('2-')), `preview channel (dropped) should still be stopped, got: ${JSON.stringify(stopped)}`)
		assert.ok(!stopped.some((s) => s.startsWith('1-')), `program channel (kept) must not be stopped, got: ${JSON.stringify(stopped)}`)
	})
})

describe('WO-556 Bug B: the outgoing look\'s timeline must never be restarted by the preview-exchange call', () => {
	it('deferPlay:true + restrictToPreview:true (already on program): routes correctly, sends no PLAY', async () => {
		const { self, eng, sentLines } = makeEngine()
		// The timeline is already live on both buses (the earlier real take).
		await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, {
			fadeDur: 0,
			screenIdx: 0,
			startAtCurrentPosition: false,
		})
		sentLines.length = 0
		// Now simulate the previewExchangePromise call: restrictToPreview + deferPlay, as
		// routes-scene-take.js now sends it for previousPgmScene's timeline.
		const fadeIn = await startSceneTimelineLayer(self, self.amcp, 2, { source: { value: 'tl1' } }, {
			fadeDur: 0,
			screenIdx: 0,
			startAtCurrentPosition: false,
			restrictToPreview: true,
			deferPlay: true,
		})
		assert.deepEqual(fadeIn, [])
		assert.equal(sentLines.filter((l) => /^PLAY\s/.test(String(l))).length, 0, 'must not restart the exiting timeline')
		// Program claim preserved (WO-555 Fix C), preview claim added — routing itself is correct.
		assert.deepEqual(eng._sendToFor('tl1'), { preview: true, program: true, screenIdx: 0 })
	})

	it('regression check: WITHOUT deferPlay, the identical call DOES restart it (the reported bug)', async () => {
		const { self, eng, sentLines } = makeEngine()
		await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, {
			fadeDur: 0,
			screenIdx: 0,
			startAtCurrentPosition: false,
		})
		sentLines.length = 0
		await startSceneTimelineLayer(self, self.amcp, 2, { source: { value: 'tl1' } }, {
			fadeDur: 0,
			screenIdx: 0,
			startAtCurrentPosition: false,
			restrictToPreview: true,
			// deferPlay intentionally omitted — reproduces the pre-fix previewExchangePromise call
		})
		assert.ok(sentLines.some((l) => /^PLAY\s/.test(String(l))), 'documents the pre-WO-556 restart-during-transition bug')
	})
})

describe('WO-556: wired end-to-end', () => {
	it('scene-take-lbg.js passes skipAmcpApply:true on the preview-release setSendTo call', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/engine/scene-take-lbg.js'), 'utf8')
		assert.match(src, /preview: false, program: true, screenIdx: pbNow\.sendTo\?\.screenIdx \},\s*\n\s*releaseId,\s*\n\s*\{ skipAmcpApply: true \}/)
	})

	it('routes-scene-take.js sets deferTimelinePlay:true on both the staging call and the preview-exchange call', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/api/routes-scene-take.js'), 'utf8')
		const occurrences = src.match(/deferTimelinePlay:\s*true/g) || []
		assert.equal(occurrences.length, 2, 'staging (WO-554) + preview-exchange (WO-556) call sites')
	})
})
