'use strict'

/**
 * WO-554 — a timeline look plays twice in a row, and PRV sometimes gets stuck after.
 *
 * Owner todos02.09.26 (fresh report after WO-546..553 landed):
 *   1) "when playing a timeline look it looks on pgm as it is played 2 times one after another.
 *      very bad look."
 *   2) "in some instances the prv channel seems to be 'blocked' after playing the timeline look
 *      until i clear the prv channel by clicking on empty space."
 *
 * Mechanism (confirmed here, not yet confirmed against a live wire capture — see the WO): the
 * pgm/prv take path in `routes-scene-take.js` runs TWO `runSceneTakeLbg` calls for the SAME
 * `incomingScene` whenever it contains a timeline layer — the "stage on preview" call (line ~256,
 * `restrictTimelineToPreview: true`, awaited FIRST) and, moments later, the real `pgmTakePromise`
 * (unrestricted). WO-549 restricted the staging call's *routing* (`program: false`) so it stopped
 * silently claiming program — but both calls still independently reach `startSceneTimelineLayer`
 * (scene-take-lbg-jobs.js) and both unconditionally call `eng.play(tlId, ..., { restart: true })`.
 * `TimelineEngine.play()` (timeline-playback-runtime.js) does not skip the transport re-apply when
 * `prevAir === id` and `restart: true` — it always calls `_applyAt(id, pos, true, ...)`, and
 * `_channels()` (timeline-playback-amcp-send.js) resolves to whatever channels are in the
 * engine's CURRENT `sendTo` state at that instant, not the physical `channel` argument the caller
 * passed in. Net effect for one take: the staging call plays the timeline with `sendTo =
 * {preview:true, program:false}` → one `PLAY` line to the PREVIEW channel; the real take then
 * plays the SAME timeline with `sendTo = {preview:true, program:true}` → two more `PLAY` lines,
 * one to preview (again) and one to program. The PREVIEW channel gets restarted TWICE for one
 * take — a real duplicate PLAY, milliseconds apart, on the channel the operator watches as PRV —
 * plausibly the stuck/"blocked" PRV render in report (2). Program gets exactly one `PLAY` line in
 * this reproduction; whether report (1)'s visible double-play on PGM specifically is this same
 * mechanism (perceived through PRV/PGM proximity or a switcher-bus config where the two channels
 * are not this cleanly separated) or a second, distinct duplicate (e.g. the concurrent
 * `previewExchangePromise` racing `pgmTakePromise` when the OUTGOING look also carried this
 * timeline) is NOT yet confirmed against a live AMCP capture — see the WO's open item.
 *
 * Fix: `startSceneTimelineLayer` accepts `deferPlay` and, when set, returns right after the
 * (harmless, `skipAmcpApply`) `setSendTo` routing call — never touching `eng.play()`. Threaded
 * through `buildTakeJobs` → `runSceneTakeLbg` as `deferTimelinePlay`, set ONLY on the staging call
 * in routes-scene-take.js (not on the standalone preview-only path, which has no following take,
 * and not on the previous-look preview-exchange call, which plays a different scene). The real
 * `pgmTakePromise` call is never deferred, so playback is never lost — it always runs moments
 * later for the identical tlId (buildTakeJobs processes every timeline layer unconditionally,
 * never skips one as "unchanged"), and now sends the ONLY `PLAY` line each channel gets.
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
	self.timelineEngine = eng // startSceneTimelineLayer reads the engine off self, not a closure
	eng.create({
		id: 'tl1',
		duration: 60000,
		fps: 25,
		layers: [{ id: 'l1', name: 'L1', clips: [{ id: 'c1', startTime: 0, duration: 60000, source: { value: 'a.mov' } }] }],
	})
	return { self, eng, sentLines }
}

/** PLAY lines, keyed by the channel number they target (`PLAY <ch>-<layer> ...`). */
function playLinesByChannel(sentLines) {
	const byChannel = new Map()
	for (const l of sentLines) {
		const m = /^PLAY\s+(\d+)-\d+/.exec(String(l))
		if (!m) continue
		const ch = m[1]
		byChannel.set(ch, (byChannel.get(ch) || 0) + 1)
	}
	return byChannel
}

describe('WO-554: startSceneTimelineLayer deferPlay', () => {
	it('deferPlay: true routes preview but never calls eng.play() (no PLAY sent, not marked air)', async () => {
		const { self, eng, sentLines } = makeEngine()
		const fadeIn = await startSceneTimelineLayer(self, self.amcp, 2, { source: { value: 'tl1' } }, {
			fadeDur: 0,
			screenIdx: 0,
			startAtCurrentPosition: false,
			restrictToPreview: true,
			deferPlay: true,
		})
		assert.deepEqual(fadeIn, [])
		// Routing still lands (cheap, skipAmcpApply — the real take's own setSendTo will confirm it).
		assert.deepEqual(eng._sendToFor('tl1'), { preview: true, program: false, screenIdx: 0 })
		// But playback was never triggered.
		assert.notEqual(eng._airTimelineId, 'tl1')
		assert.equal(playLinesByChannel(sentLines).size, 0, 'deferPlay must not send any PLAY line')
	})

	it('staging (deferPlay) + real take (no deferPlay): program gets exactly ONE PLAY line, preview gets none (WO-559)', async () => {
		const { self, eng, sentLines } = makeEngine()
		// Staging call — WO-549's restrictToPreview + WO-554's deferTimelinePlay, as routes-scene-take.js sends it.
		await startSceneTimelineLayer(self, self.amcp, 2, { source: { value: 'tl1' } }, {
			fadeDur: 0,
			screenIdx: 0,
			startAtCurrentPosition: false,
			restrictToPreview: true,
			deferPlay: true,
		})
		// Real, unrestricted PGM take for the identical incoming scene, moments later.
		await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, {
			fadeDur: 0,
			screenIdx: 0,
			startAtCurrentPosition: false,
		})
		assert.equal(eng._airTimelineId, 'tl1')
		/* WO-559: the real take no longer also claims preview — a timeline look must leave preview
		 * free for the pgm/prv flip-flop to put the OUTGOING look there, exactly like a normal look's
		 * own content never auto-claims preview. So only program ends up routed, and only program
		 * gets a PLAY line — there is nothing left for the timeline to play on preview at all. */
		assert.deepEqual(eng._sendToFor('tl1'), { preview: false, program: true, screenIdx: 0 })
		const byChannel = playLinesByChannel(sentLines)
		assert.equal(byChannel.size, 1, 'only program gets a PLAY line; preview is left for the flip-flop')
		for (const [ch, count] of byChannel) {
			assert.equal(count, 1, `channel ${ch} must receive exactly one PLAY line, got ${count}`)
		}
	})

	it('regression check: WITHOUT deferPlay, the staging call still flashes preview needlessly (WO-554, revised by WO-559)', async () => {
		/* WO-559 changed what the real take claims (program only, never preview — see
		 * timeline-take.js), which structurally closes the ORIGINAL WO-554 mechanism this test
		 * documented (the real take could no longer duplicate a PLAY onto preview even without
		 * deferPlay, since it never routes there at all anymore). deferPlay still earns its keep:
		 * without it, the staging call plays the timeline onto preview once — the real take's own
		 * `preview:false` transition immediately STOPs it again a moment later (WO-555's differential
		 * stop) — a pointless flash-then-clear that deferPlay skips entirely by never playing there
		 * in the first place. */
		const { self, eng, sentLines } = makeEngine()
		await startSceneTimelineLayer(self, self.amcp, 2, { source: { value: 'tl1' } }, {
			fadeDur: 0,
			screenIdx: 0,
			startAtCurrentPosition: false,
			restrictToPreview: true,
			// deferPlay intentionally omitted — reproduces the pre-fix staging call
		})
		await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, {
			fadeDur: 0,
			screenIdx: 0,
			startAtCurrentPosition: false,
		})
		const byChannel = playLinesByChannel(sentLines)
		const counts = [...byChannel.values()].sort((a, b) => a - b)
		assert.deepEqual(counts, [1, 1], 'preview gets one pointless PLAY (from staging) alongside program\'s real one')
	})

	it('deferPlay absent/false: unchanged single-call behavior (program only, WO-559)', async () => {
		for (const opts of [{}, { deferPlay: false }]) {
			const { self, eng, sentLines } = makeEngine()
			await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, {
				fadeDur: 0,
				screenIdx: 0,
				startAtCurrentPosition: false,
				...opts,
			})
			assert.equal(eng._airTimelineId, 'tl1')
			const byChannel = playLinesByChannel(sentLines)
			// WO-559: a single unrestricted call now only ever claims and plays program — preview is
			// left for the pgm/prv flip-flop to route the outgoing look there instead.
			assert.equal(byChannel.size, 1)
			for (const count of byChannel.values()) assert.equal(count, 1)
			eng.stop('tl1', { skipAmcp: true })
		}
	})
})

describe('WO-554: deferTimelinePlay wired end-to-end', () => {
	it('routes-scene-take.js sets deferTimelinePlay:true on the pgm/prv staging call', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/api/routes-scene-take.js'), 'utf8')
		// WO-556 added a second, legitimate call site (the previewExchangePromise call) for the same
		// reason in reverse — see smoke-wo556-preview-flash-and-exit-restart.test.js. This pin only
		// checks the staging call (this file's own subject) still sets it, not an exact total count.
		const occurrences = src.match(/deferTimelinePlay:\s*true/g) || []
		assert.ok(occurrences.length >= 1, 'at least the staging call site should defer timeline play')
	})

	it('scene-take-lbg-jobs.js threads deferTimelinePlay into startSceneTimelineLayer as deferPlay', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/engine/scene-take-lbg-jobs.js'), 'utf8')
		assert.match(src, /deferTimelinePlay\s*=\s*false/)
		assert.match(src, /deferPlay:\s*deferTimelinePlay/)
	})

	it('scene-take-lbg.js forwards opts.deferTimelinePlay into buildTakeJobs', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/engine/scene-take-lbg.js'), 'utf8')
		assert.match(src, /deferTimelinePlay:\s*!!opts\.deferTimelinePlay/)
	})

	it('timeline-take.js short-circuits before eng.play() when opts.deferPlay is set', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/engine/timeline-take.js'), 'utf8')
		assert.match(src, /if \(opts\.deferPlay\) return \[\]/)
	})
})
