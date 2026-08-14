'use strict'

/**
 * WO-537 — a timeline dropped into a look resumed from wherever it was left, not from 0.
 *
 * Owner 14.08 (`todos14.08.26` line 1): *"hitting take from timeline editor now works correctly, but
 * playing the same timeline from a look (i can drop a timeline from sources browser into looks) does
 * not work properly."*
 *
 * That split is the diagnosis. The two entry points call different things:
 *
 *   Take button        -> `playForTake` — documented "Never resume shortcut"
 *   timeline in a look -> `startSceneTimelineLayer` -> `eng.play(tlId, startPos)`
 *
 * and `play()` has a resume shortcut that DISCARDS `fromMs` when the timeline is paused. That is
 * deliberate for an operator pressing Play (pinned by smoke-timeline-pause-resume: "resume must
 * ignore stale client fromMs") and wrong for a take. Both look callers pass
 * `startAtCurrentPosition: false` — they are demanding 0 — and were silently ignored whenever the
 * operator had scrubbed that timeline in its own editor, which is always.
 *
 * `startSceneTimelineLayer` cannot simply switch to `playForTake`: that implies `take: true`, whose
 * DEFER lead tweens need an orchestrator `MIXER COMMIT`, and the CUT branch (`fadeDur <= 0`) has
 * none — the WO-519 fail-dark class. Hence an explicit `restart` opt on `play()` instead.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { TimelineEngine } = require('../../src/engine/timeline-engine')

const noop = () => Promise.resolve()
const amcpDouble = () => ({
	raw: noop, stop: noop, pause: noop, resume: noop, call: noop,
	mixerFill: noop, mixerOpacity: noop, mixerVolume: noop, mixerCommit: noop, batchSendChunked: noop,
})

function pausedAt(ms) {
	const eng = new TimelineEngine({ config: { screen_count: 1 }, log: () => {}, amcp: amcpDouble() })
	const tl = eng.create({
		id: 'tl1',
		duration: 60000,
		fps: 25,
		layers: [{ id: 'l1', name: 'L1', clips: [{ id: 'c1', startTime: 0, duration: 60000, source: { value: 'a.mov' } }] }],
	})
	eng.setSendTo({ preview: true, program: false, screenIdx: 0 })
	eng.play(tl.id, ms)
	eng.pause(tl.id)
	return { eng, tl }
}

describe('WO-537: play(fromMs) honours an explicit restart', () => {
	it('the bug: a plain play() after a pause keeps the paused position', () => {
		const { eng, tl } = pausedAt(12000)
		const paused = eng.getPlayback().position
		assert.ok(paused > 11000, 'sanity: really paused mid-timeline')
		eng.play(tl.id, 0)
		assert.equal(eng.getPlayback().position, paused, 'the documented resume behaviour, unchanged')
		eng.stop(tl.id, { skipAmcp: true })
	})

	it('restart: true starts where the caller asked', () => {
		const { eng, tl } = pausedAt(12000)
		eng.play(tl.id, 0, { restart: true })
		assert.ok(eng.getPlayback().position < 500, `expected ~0, got ${eng.getPlayback().position}`)
		eng.stop(tl.id, { skipAmcp: true })
	})

	it('restart: true is opt-in — absent or false still resumes', () => {
		for (const opts of [undefined, {}, { restart: false }, { takeFade: true }]) {
			const { eng, tl } = pausedAt(12000)
			const paused = eng.getPlayback().position
			eng.play(tl.id, 0, opts)
			assert.equal(eng.getPlayback().position, paused, `opts=${JSON.stringify(opts)} must not restart`)
			eng.stop(tl.id, { skipAmcp: true })
		}
	})

	it('a non-paused play is unaffected either way', () => {
		const { eng, tl } = pausedAt(12000)
		eng.stop(tl.id, { skipAmcp: true })
		eng.play(tl.id, 5000, { restart: true })
		assert.ok(Math.abs(eng.getPlayback().position - 5000) < 500)
		eng.stop(tl.id, { skipAmcp: true })
	})
})

describe('WO-537: the look path asks for it', () => {
	const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

	it('startSceneTimelineLayer derives restart from startAtCurrentPosition, on both branches', () => {
		const src = read('src/engine/timeline-take.js')
		assert.match(src, /const restart = !opts\.startAtCurrentPosition/)
		assert.match(src, /eng\.play\(tlId, startPos, \{ restart \}\)/, 'the CUT branch')
		assert.match(src, /eng\.play\(tlId, startPos, \{ takeFade: true, restart \}\)/, 'the MIX branch')
	})

	it('and both look callers really do ask for position 0', () => {
		for (const rel of ['src/engine/scene-take-lbg-jobs.js', 'src/engine/scene-take-pgm-only.js']) {
			assert.match(read(rel), /startAtCurrentPosition: false/, `${rel} demands a restart`)
		}
	})
})
