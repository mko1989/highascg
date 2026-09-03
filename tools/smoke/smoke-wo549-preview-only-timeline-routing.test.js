'use strict'

/**
 * WO-549 — putting the OLD look on the preview bus silently re-took its timeline onto program.
 *
 * Owner 02.09, after WO-546/548 fixed the timeline going dark: *"playing the timeline from inside
 * a look works correctly. but going back to another look results in retaking the timeline look
 * instead of playing the new look."*
 *
 * `startSceneTimelineLayer` (timeline-take.js) always calls `eng.setSendTo({ preview: true,
 * program: true, screenIdx })` — by design, for the normal case of a real take, where a timeline
 * genuinely belongs on both the program and preview bus of its screen. `routes-scene-take.js`'s
 * pgm/prv preview-exchange call runs CONCURRENTLY with the real PGM take (WO-546: deliberately,
 * serializing it reintroduces WO-150 B150.1) and puts the PREVIOUS look on the preview bus alone —
 * but if that previous look itself contained a timeline, the same unconditional both-channels
 * claim routed it to program too, silently overriding whatever the real PGM take (bringing up a
 * DIFFERENT, timeline-free look) was concurrently trying to put there. The staging call and the
 * standalone preview-only take path have the identical structural issue for the same reason: both
 * only ever want the preview bus.
 *
 * Fix: `startSceneTimelineLayer` accepts `restrictToPreview` and, when set, routes with
 * `program: false`. Threaded through `buildTakeJobs` → `runSceneTakeLbg` as
 * `restrictTimelineToPreview`, set by all three PRV-only call sites in `routes-scene-take.js` — and
 * deliberately NOT set on the real PGM take, which still needs (and gets) the normal both-channel
 * routing.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { TimelineEngine } = require('../../src/engine/timeline-engine')
const { startSceneTimelineLayer } = require('../../src/engine/timeline-take.js')

const noop = () => Promise.resolve()
function makeEngine() {
	const self = {
		config: { screen_count: 1 },
		log: () => {},
		amcp: {
			raw: noop, stop: noop, pause: noop, resume: noop, call: noop,
			mixerFill: noop, mixerOpacity: noop, mixerVolume: noop, mixerCommit: noop, batchSendChunked: noop,
		},
	}
	const eng = new TimelineEngine(self)
	self.timelineEngine = eng // startSceneTimelineLayer reads the engine off self, not a closure
	eng.create({
		id: 'tl1',
		duration: 60000,
		fps: 25,
		layers: [{ id: 'l1', name: 'L1', clips: [{ id: 'c1', startTime: 0, duration: 60000, source: { value: 'a.mov' } }] }],
	})
	return { self, eng }
}

describe('WO-549: startSceneTimelineLayer routing', () => {
	it('restrictToPreview: true routes preview-only (program: false)', async () => {
		const { self, eng } = makeEngine()
		await startSceneTimelineLayer(self, self.amcp, 2, { source: { value: 'tl1' } }, {
			fadeDur: 0,
			screenIdx: 0,
			startAtCurrentPosition: false,
			restrictToPreview: true,
		})
		assert.deepEqual(eng._sendToFor('tl1'), { preview: true, program: false, screenIdx: 0 })
		eng.stop('tl1', { skipAmcp: true })
	})

	it('without restrictToPreview (absent, undefined, or false): program only (WO-559)', async () => {
		/* WO-559 revised this: an unrestricted (real take) call used to always claim BOTH channels
		 * ("both channels claimed", the original assertion here) — now it only claims program,
		 * matching how a normal look's own content never auto-claims preview. See timeline-take.js. */
		for (const opts of [{}, { restrictToPreview: false }]) {
			const { self, eng } = makeEngine()
			await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, {
				fadeDur: 0,
				screenIdx: 0,
				startAtCurrentPosition: false,
				...opts,
			})
			assert.deepEqual(
				eng._sendToFor('tl1'),
				{ preview: false, program: true, screenIdx: 0 },
				`opts=${JSON.stringify(opts)} must claim program only, leaving preview to the flip-flop`,
			)
			eng.stop('tl1', { skipAmcp: true })
		}
	})

	it('restrictToPreview applies on the MIX branch (fadeDur > 0) too, not just the CUT branch', async () => {
		const { self, eng } = makeEngine()
		await startSceneTimelineLayer(self, self.amcp, 2, { source: { value: 'tl1' } }, {
			fadeDur: 25,
			screenIdx: 0,
			startAtCurrentPosition: false,
			restrictToPreview: true,
		})
		assert.deepEqual(eng._sendToFor('tl1'), { preview: true, program: false, screenIdx: 0 })
		eng.stop('tl1', { skipAmcp: true })
	})
})

describe('WO-549: wiring through buildTakeJobs / runSceneTakeLbg', () => {
	const jobsSrc = fs.readFileSync(path.join(__dirname, '../../src/engine/scene-take-lbg-jobs.js'), 'utf8')
	const lbgSrc = fs.readFileSync(path.join(__dirname, '../../src/engine/scene-take-lbg.js'), 'utf8')

	it('buildTakeJobs threads restrictTimelineToPreview into startSceneTimelineLayer’s opts', () => {
		assert.match(jobsSrc, /restrictTimelineToPreview = false/)
		assert.match(jobsSrc, /restrictToPreview: restrictTimelineToPreview/)
	})

	it('runSceneTakeLbg forwards opts.restrictTimelineToPreview into buildTakeJobs', () => {
		assert.match(lbgSrc, /restrictTimelineToPreview: !!opts\.restrictTimelineToPreview/)
	})
})

describe('WO-549: routes-scene-take.js sets it on every PRV-only call site, never on the real PGM take', () => {
	const src = fs.readFileSync(path.join(__dirname, '../../src/api/routes-scene-take.js'), 'utf8')

	it('the standalone preview-only take path sets it', () => {
		const start = src.indexOf("ctx.log('info', `[scene-take] preview-only path")
		assert.ok(start > 0, 'found the preview-only path')
		const nearby = src.slice(start, start + 900)
		assert.match(nearby, /restrictTimelineToPreview: true/)
	})

	it('the staging call sets it', () => {
		const blockStart = src.indexOf('if (stageOnPreview) {')
		assert.ok(blockStart > 0, 'found the staging block')
		const start = src.indexOf('currentScene: prvCurrent', blockStart)
		assert.ok(start > blockStart, 'found the staging call’s own runSceneTakeLbg options')
		const nearby = src.slice(start, start + 400)
		assert.match(nearby, /restrictTimelineToPreview: true/)
	})

	it('the preview-exchange call sets it', () => {
		const start = src.indexOf('incomingScene: previousPgmScene')
		assert.ok(start > 0, 'found the preview-exchange call')
		const nearby = src.slice(start, start + 400)
		assert.match(nearby, /restrictTimelineToPreview: true/)
	})

	it('the real PGM take does NOT set it — it still needs the normal both-channel routing', () => {
		const start = src.indexOf('const pgmTakePromise = runSceneTakeLbg')
		assert.ok(start > 0, 'found the PGM take call')
		const nearby = src.slice(start, start + 300)
		assert.doesNotMatch(nearby, /restrictTimelineToPreview/)
	})
})
