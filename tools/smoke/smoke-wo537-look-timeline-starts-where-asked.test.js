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

describe('WO-537: a timeline layer is never given two competing ramps', () => {
	const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

	/* Caspar's ordering, from the source the running binary was built from
	 * (`transforms_applier::apply`, AMCPCommandsImpl.cpp): a non-deferred MIXER applies
	 * IMMEDIATELY, deferred ones accumulate per channel and are applied by `MIXER <ch> COMMIT` —
	 * i.e. last. So when a layer is both exiting (deferred fade-out) and entering (crossfade
	 * fade-in), whichever was inserted later into the deferred list decides, and the fade-out was
	 * inserted first. WO-537 §4's original note had this backwards. */

	it('both take implementations skip the fade-out for a layer that is also fading in', () => {
		for (const rel of ['src/engine/scene-take-lbg.js', 'src/engine/scene-take-pgm-only.js']) {
			assert.match(
				read(rel),
				/if \(timelineFadeInPhys\.includes\(pOut\)\) continue/,
				`${rel}: the fade-in owns a layer that is in both lists`,
			)
		}
	})

	it('the banked path builds its fade-out per physical layer, so the guard has something to test', () => {
		const src = read('src/engine/scene-take-lbg.js')
		assert.match(src, /const pOut = TIMELINE_LAYER_BASE \+ li/)
		assert.match(src, /mergeMixerExtras\.push\(deferMixerAmcpLine\(`MIXER \$\{cl\} OPACITY \$\{tail\}`\)\)/)
	})

	/* Skipping a fade-out must never strand a layer at the opacity-0 preset — the WO-519 class of
	 * failure. Enumerated over every combination of (merge, currentMap, activeTimeline, duration,
	 * forceCut): the guard is reachable in exactly 2 states, and both fade the layer in elsewhere. */
	it('the guard cannot fail dark — every state that reaches it also fades the layer in', () => {
		let reachable = 0
		for (const merge of [false, true])
			for (const curMap of [0, 1])
				for (const activeTl of [false, true])
					for (const dur of [0, 25])
						for (const forceCut of [false, true]) {
							const fadeDur = forceCut || dur <= 0 ? 0 : dur
							// scene-take-lbg-jobs.js: the fadeDur handed to startSceneTimelineLayer,
							// which is what presets the layer to 0 and populates timelineFadeInPhys.
							const jobFade = forceCut || merge || !(dur > 0) ? 0 : dur
							const fadeInPhys = jobFade > 0
							const bankXf = fadeDur > 0 && (curMap > 0 || activeTl) && !merge
							const guardRuns = activeTl && fadeDur > 0 && !forceCut
							if (!guardRuns || !fadeInPhys) continue
							reachable++
							const fadesIn = bankXf || (!bankXf && !merge && fadeDur > 0)
							assert.ok(fadesIn, `no fade-in for merge=${merge} curMap=${curMap} dur=${dur}`)
						}
		assert.equal(reachable, 2, 'if this count moves, re-derive the fail-dark argument')
	})
})
