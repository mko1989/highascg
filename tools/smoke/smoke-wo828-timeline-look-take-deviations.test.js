'use strict'

/**
 * WO-828 — timeline-inside-a-look take deviations (D1, D2, D3, D5, D7 + the preset race found live).
 * D4 is pinned in smoke-wo541-timeline-only-look-crossfade.test.js (test 2 + the mixed-look test);
 * the D1/D5 join is also pinned in smoke-wo556-preview-flash-and-exit-restart.test.js (Bug B).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { TimelineEngine } = require('../../src/engine/timeline-engine')
const { startSceneTimelineLayer } = require('../../src/engine/timeline-take.js')
const { programChannelToScreenIdx } = require('../../src/engine/scene-transition.js')
const { releaseOrStopOutgoingTimeline } = require('../../src/engine/scene-take-lbg-timeline-guard.js')

const SRC = (rel) => fs.readFileSync(path.join(__dirname, '../../src', rel), 'utf8')

function makeEngine({ duration = 60000, loopAlways = false } = {}) {
	const sentLines = []
	const stopped = []
	const raws = []
	const noop = () => Promise.resolve()
	const self = {
		config: { screen_count: 1 },
		log: () => {},
		amcp: {
			raw: (l) => {
				raws.push(l)
				return Promise.resolve()
			},
			stop: (ch, layer) => {
				stopped.push(`${ch}-${layer}`)
				return Promise.resolve()
			},
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
	const clip = { id: 'c1', startTime: 0, duration, source: { value: 'a.mov' } }
	if (loopAlways) clip.loopAlways = true
	eng.create({ id: 'tl1', duration, fps: 25, layers: [{ id: 'l1', name: 'L1', clips: [clip] }] })
	return { self, eng, sentLines, stopped, raws }
}

/** Pretend the air timeline has been playing for `ms`. */
function advance(eng, ms) {
	const cell = eng._pbFor('tl1')
	cell._p0 = ms
	cell._t0 = Date.now()
}

const ch1 = (lines) => lines.filter((l) => /^(PLAY|STOP|LOAD|LOADBG|MIXER|CALL) 1[-\s]/.test(String(l)))

describe('WO-828 D7: a preview channel maps to its own screen', () => {
	it('two screens: ch1/ch2 → screen 0, ch3/ch4 → screen 1 (ch4 used to fall back to 0)', () => {
		const cfg = { casparServer: { screen_count: 2 } }
		assert.deepEqual([1, 2, 3, 4].map((c) => programChannelToScreenIdx(cfg, c)), [0, 0, 1, 1])
	})
	it('one screen: PRV ch2 → 0; an unknown channel still falls back to 0', () => {
		const cfg = { casparServer: { screen_count: 1 } }
		assert.equal(programChannelToScreenIdx(cfg, 2), 0)
		assert.equal(programChannelToScreenIdx(cfg, 99), 0)
	})
})

describe('WO-828 D1: joinChannels adds a channel to the running playback without touching the others', () => {
	it('joins PRV at the current position, sends nothing to program', async () => {
		const { self, eng, sentLines } = makeEngine()
		await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, { fadeDur: 0, screenIdx: 0 })
		advance(eng, 4000)
		eng.setSendTo({ preview: true, program: true, screenIdx: 0 }, 'tl1', { skipAmcpApply: true })
		sentLines.length = 0
		assert.equal(eng.joinChannels('tl1', [2]), true)
		assert.deepEqual(ch1(sentLines), [], JSON.stringify(sentLines))
		const play = sentLines.find((l) => /^PLAY 2-210 /.test(l))
		assert.ok(play, JSON.stringify(sentLines))
		assert.match(play, / SEEK (9[0-9]|1[0-9][0-9])\b/, `seeks to the playhead (~100 frames), not 0: ${play}`)
	})
	it('a preview call for a timeline ALREADY playing on that preview channel sends nothing (no PRV re-PLAY)', async () => {
		const { self, eng, sentLines } = makeEngine()
		await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, { fadeDur: 0, screenIdx: 0 })
		advance(eng, 4000)
		const prv = { fadeDur: 0, screenIdx: 0, restrictToPreview: true, deferPlay: true }
		await startSceneTimelineLayer(self, self.amcp, 2, { source: { value: 'tl1' } }, prv)
		assert.ok(sentLines.some((l) => /^PLAY 2-210 /.test(l)), 'first call joins')
		sentLines.length = 0
		await startSceneTimelineLayer(self, self.amcp, 2, { source: { value: 'tl1' } }, prv)
		assert.deepEqual(sentLines, [], 'second call: already on PRV')
	})
	it('refuses a timeline that is not on air, or a channel it is not routed to', async () => {
		const { self, eng } = makeEngine()
		assert.equal(eng.joinChannels('tl1', [2]), false)
		await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, { fadeDur: 0, screenIdx: 0 })
		assert.equal(eng.joinChannels('tl1', [2]), false, 'program-only routing: ch2 is not routed')
	})
})

describe('WO-828 D2: the loop wrap re-PLAYs in place — no STOP', () => {
	it('play(id, 0, {seamless}) on the air clip sends PLAY without STOP', async () => {
		const { self, eng, sentLines } = makeEngine()
		await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, { fadeDur: 0, screenIdx: 0 })
		sentLines.length = 0
		eng.play('tl1', 0, { seamless: true })
		assert.ok(!sentLines.includes('STOP 1-210'), JSON.stringify(sentLines))
		assert.ok(sentLines.some((l) => /^PLAY 1-210 /.test(l)), JSON.stringify(sentLines))
	})
	it('the loopAlways branch skips amcp.stop the same way', async () => {
		const { self, eng, stopped, raws } = makeEngine({ loopAlways: true })
		await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, { fadeDur: 0, screenIdx: 0 })
		stopped.length = 0
		raws.length = 0
		eng.play('tl1', 0, { seamless: true })
		assert.deepEqual(stopped, [])
		assert.ok(raws.some((l) => /^PLAY 1-210 .*LOOP/.test(l)), JSON.stringify(raws))
	})
	it('a plain restart still STOPs (seamless is opt-in)', async () => {
		const { self, eng, sentLines } = makeEngine()
		await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, { fadeDur: 0, screenIdx: 0 })
		sentLines.length = 0
		eng.play('tl1', 0, { restart: true })
		assert.ok(sentLines.includes('STOP 1-210'), JSON.stringify(sentLines))
	})
	it('_tick wraps with seamless', () => {
		assert.match(SRC('engine/timeline-playback-runtime.js'), /if \(cell\.loop\) \{\s*\n\s*this\.play\(airId, 0, \{ seamless: true \}\)/)
	})
})

describe('WO-828 D3: a retake of the on-air timeline look does not dip', () => {
	it('no OPACITY 0 0 preset, no STOP, restart at 0, no fade-in layers returned', async () => {
		const { self, eng, sentLines } = makeEngine()
		await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, { fadeDur: 25, screenIdx: 0 })
		advance(eng, 8000)
		sentLines.length = 0
		const fadeIn = await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, { fadeDur: 25, screenIdx: 0 })
		assert.deepEqual(fadeIn, [], 'nothing for the pipeline to fade up')
		assert.ok(!sentLines.some((l) => /OPACITY 0 0/.test(l)), JSON.stringify(sentLines))
		assert.ok(!sentLines.includes('STOP 1-210'), JSON.stringify(sentLines))
		assert.ok(sentLines.some((l) => /^PLAY 1-210 .* SEEK 0\b/.test(l)), `restarts at 0: ${JSON.stringify(sentLines)}`)
	})
	it('startAtCurrentPosition retake keeps running (no transport lines at all)', async () => {
		const { self, eng, sentLines } = makeEngine()
		await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, { fadeDur: 25, screenIdx: 0 })
		advance(eng, 8000)
		sentLines.length = 0
		await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, { fadeDur: 25, screenIdx: 0, startAtCurrentPosition: true })
		assert.deepEqual(ch1(sentLines), [], JSON.stringify(sentLines))
	})
})

describe('WO-828 race (live step 11a): preset before the routing change', () => {
	it('a timeline playing on PRV only, taken to PGM with a fade: the first program line is the 0 preset', async () => {
		const { self, eng, sentLines } = makeEngine()
		eng.setSendTo({ preview: true, program: false, screenIdx: 0 }, 'tl1', { skipAmcpApply: true })
		eng.play('tl1', 0)
		advance(eng, 3000)
		sentLines.length = 0
		// A regular 40 ms tick lands while the preset is in flight (the await the race lived in).
		const send = self.amcp.batchSendChunked
		self.amcp.batchSendChunked = (lines) => {
			const r = send(lines)
			if ((lines || []).some((l) => / OPACITY 0 0$/.test(l))) eng._tick()
			return r
		}
		const fadeIn = await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, { fadeDur: 25, screenIdx: 0 })
		const p = ch1(sentLines)
		assert.equal(p[0], 'MIXER 1-210 OPACITY 0 0', `preset first: ${JSON.stringify(p)}`)
		assert.ok(!p.includes('MIXER 1-210 OPACITY 1 0'), `no instant full-opacity write: ${JSON.stringify(p)}`)
		assert.deepEqual(fadeIn, [210], 'the pipeline fades 210 up')
	})
})

describe('WO-828 D5: the outgoing timeline keeps PRV, releases only program', () => {
	it('on both buses → released (program dropped, preview kept, no STOP on PRV)', async () => {
		const { self, eng, stopped } = makeEngine()
		await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, { fadeDur: 0, screenIdx: 0 })
		eng.setSendTo({ preview: true, program: true, screenIdx: 0 }, 'tl1', { skipAmcpApply: true })
		stopped.length = 0
		assert.equal(releaseOrStopOutgoingTimeline(eng, 'tl1', 1), 'released')
		assert.deepEqual(eng._sendToFor('tl1'), { preview: true, program: false, screenIdx: 0 })
		assert.equal(eng._airTimelineId, 'tl1', 'still playing')
		assert.ok(stopped.includes('1-210') && !stopped.includes('2-210'), JSON.stringify(stopped))
	})
	it('program only (no PRV join) → stopped, as before', async () => {
		const { self, eng } = makeEngine()
		await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, { fadeDur: 0, screenIdx: 0 })
		assert.equal(releaseOrStopOutgoingTimeline(eng, 'tl1', 1), 'stopped')
		assert.notEqual(eng.getPlayback()?.playing, true)
	})
	it('scene-take-lbg.js waits for the PGM→PRV exchange before release-or-stop (D7: never STOP mid-fade)', () => {
		const src = SRC('engine/scene-take-lbg.js')
		assert.match(
			src,
			/if \(fadeClockRef\.programPlayHook\) await Promise\.resolve\(fadeClockRef\.programPlayHook\)[^\n]*\n\s*releaseOrStopOutgoingTimeline\(self\.timelineEngine, activeTimelineIdToFadeOut, channel\)/,
		)
		assert.match(SRC('engine/scene-take-lbg-amcp-pipeline.js'), /fadeClockRef\.programPlayHook = onProgramPlayCommitted\(\)/)
	})
	it('teardown polls the incoming timeline reaching 1 on a timeline-only take (D4 hold)', () => {
		assert.match(SRC('engine/scene-take-lbg.js'), /timelineFadeInRefLayer: shouldRunBankCrossfade && takeJobs\.length === 0 \? timelineFadeInPhys\[0\] : null/)
		assert.match(SRC('engine/scene-take-lbg-teardown.js'), /waitForOpacitySettled\(amcp, channel, refLayer, refTarget, verifyBudgetMs\)/)
	})
})
