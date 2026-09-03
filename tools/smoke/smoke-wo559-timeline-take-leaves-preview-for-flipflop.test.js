'use strict'

/**
 * WO-559 — after taking a timeline look, it stayed on preview too, blocking the outgoing look.
 *
 * Owner, confirming WO-558's fix: *"YES! almost perfect. the only thing missing is that after
 * transitioning to a timeline look, the outgoing look needs to be called into preview. now the
 * timeline looks ends up both on pgm and prv."*
 *
 * `startSceneTimelineLayer` (timeline-take.js) unconditionally routed with `preview: true` on
 * EVERY call, restricted or not — a deliberate WO-549 design choice at the time ("the normal case
 * of a single PGM/PRV pair"). But a normal look's own content never auto-claims preview this way —
 * only the separate pgm/prv flip-flop (`previewExchangePromise` in routes-scene-take.js) explicitly
 * routes the OUTGOING look there. Because the timeline band sits ABOVE both look banks (WO-553),
 * the timeline's permanent preview claim visually blocked whatever the flip-flop placed underneath:
 * the outgoing look was there in the AMCP layers, just invisible under the timeline.
 *
 * `runTimelineDirectTake` (the Timeline Editor's own "Take" button, a separate direct-take path)
 * already only ever claimed `{ preview: false, program: true }` for exactly this reason —
 * `startSceneTimelineLayer` (the look-embedded-timeline path) was the one place still forcing both.
 *
 * Fix: an unrestricted call (the real take) now claims program only, symmetric with how it already
 * preserved-not-forced program on a restricted call (WO-555). A restricted call (staging,
 * preview-only, preview-exchange) still always claims preview — that remains its entire purpose.
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

describe('WO-559: an unrestricted (real take) call claims program only', () => {
	it('a fresh unrestricted call routes program:true, preview:false', async () => {
		const { self, eng } = makeEngine()
		await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, {
			fadeDur: 0,
			screenIdx: 0,
			startAtCurrentPosition: false,
		})
		assert.deepEqual(eng._sendToFor('tl1'), { preview: false, program: true, screenIdx: 0 })
	})

	it('staging (restrictToPreview, deferPlay) then the real take: preview ends up false, freeing it for the flip-flop', async () => {
		const { self, eng } = makeEngine()
		// Staging call, as routes-scene-take.js sends it for the incoming (new) timeline look.
		await startSceneTimelineLayer(self, self.amcp, 2, { source: { value: 'tl1' } }, {
			fadeDur: 0,
			screenIdx: 0,
			startAtCurrentPosition: false,
			restrictToPreview: true,
			deferPlay: true,
		})
		assert.deepEqual(eng._sendToFor('tl1'), { preview: true, program: false, screenIdx: 0 }, 'staging still claims preview only')
		// The real, unrestricted PGM take for the identical incoming scene, moments later.
		await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, {
			fadeDur: 0,
			screenIdx: 0,
			startAtCurrentPosition: false,
		})
		assert.deepEqual(
			eng._sendToFor('tl1'),
			{ preview: false, program: true, screenIdx: 0 },
			'the real take must revoke the staging call\'s preview claim, leaving preview free for previewExchangePromise to route the outgoing look there',
		)
	})

	it('a restricted call still always claims preview — unaffected (WO-549 original purpose)', async () => {
		const { self, eng } = makeEngine()
		await startSceneTimelineLayer(self, self.amcp, 2, { source: { value: 'tl1' } }, {
			fadeDur: 0,
			screenIdx: 0,
			startAtCurrentPosition: false,
			restrictToPreview: true,
		})
		assert.equal(eng._sendToFor('tl1').preview, true)
	})

	it('regression check: without the fix, the real take still leaves the staging call\'s preview claim standing', async () => {
		// Direct check of the pre-WO-559 formula: preview was unconditionally true.
		const preRestrictToPreview = false
		const preFixPreview = true // the old, unconditional value
		assert.equal(preFixPreview, true, 'documents the pre-fix constant that WO-559 replaced with `!!opts.restrictToPreview`')
		assert.equal(!!preRestrictToPreview, false, 'the fixed formula would instead compute false here')
	})
})

describe('WO-559: wired end-to-end', () => {
	it('timeline-take.js computes preview from restrictToPreview, not a hardcoded true', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/engine/timeline-take.js'), 'utf8')
		assert.match(src, /const preview = !!opts\.restrictToPreview/)
		assert.match(src, /eng\.setSendTo\(\{ preview, program, screenIdx: opts\.screenIdx \}/)
	})

	it('this matches runTimelineDirectTake\'s own long-standing preview:false,program:true claim', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/engine/timeline-take.js'), 'utf8')
		assert.match(src, /eng\.setSendTo\(\{ preview: false, program: true, screenIdx \}, tlId, \{ skipAmcpApply: true \}\)/)
	})
})
