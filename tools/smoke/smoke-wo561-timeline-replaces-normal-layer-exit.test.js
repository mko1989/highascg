'use strict'

/**
 * WO-561 — the previous look's own content kept playing, hidden under an incoming timeline, until
 * a LATER take revealed it again.
 *
 * Owner: *"when timeline is playing there is still the previous look playing under it which then
 * surfaces with another take."*
 *
 * `diffScenes` (`scene-transition.js`) compares purely by `layerNumber`. A normal (media/etc.)
 * layer previously occupying a slot, now replaced by an incoming TIMELINE layer at the SAME
 * `layerNumber`, has different `source` but the same slot — `diffScenes` classifies that as an
 * "update", never an "exit" (only a layer number present in the outgoing scene but ABSENT from the
 * incoming one is ever classified as "exit"). `buildTakeJobs` (`scene-take-lbg-jobs.js`) already
 * has the correct fix for exactly this class of situation on its NORMAL (non-timeline) path:
 * whenever an incoming layer's `diffs` show a change, it re-derives a genuine exit candidate from
 * whatever was previously on that slot (`extraExitCandidates.push(cur)`, guarded to skip a
 * timeline-typed `cur` — that's WO-548's "still wanted" retake case, handled elsewhere). The
 * TIMELINE branch of the very same loop, though, `continue`s immediately after starting the
 * timeline — long before ever reaching that check — so an incoming timeline replacing a normal
 * layer at the same slot left the old layer's physical content on air, unstopped and unfaded,
 * simply painted over by the timeline's own physical band (WO-553: layers 210+, always above both
 * look banks). The old content only became visible again once a LATER take tore the timeline back
 * down, revealing whatever had quietly kept playing underneath the whole time.
 *
 * Fix: the timeline branch now performs the identical check before its `continue` — if the current
 * scene had real (non-timeline) content on this exact layer slot, it goes into
 * `extraExitCandidates` too, so the existing exit-fade + teardown pipeline
 * (`sendExitAndTimelineFadeLines` → `exitMedia`, wired in `scene-take-lbg.js`) picks it up and
 * properly fades and clears it like any other genuinely-exiting layer.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { buildTakeJobs } = require('../../src/engine/scene-take-lbg-jobs.js')

function baseSelf() {
	return {
		config: { screen_count: 1 },
		log: () => {},
	}
}

describe('WO-561: an incoming timeline layer surfaces the normal layer it replaces as an exit candidate', () => {
	it('a normal layer previously at this slot is added to extraExitCandidates', async () => {
		const outgoingLayer = { layerNumber: 10, source: { type: 'media', value: 'old-look-clip.mov' } }
		const incomingLayer = { layerNumber: 10, source: { type: 'timeline', value: 'tl-1' } }
		const { extraExitCandidates, takeJobs } = await buildTakeJobs({
			incomingSorted: [incomingLayer],
			currentMap: new Map([[10, outgoingLayer]]),
			channel: 1,
			incoming: { layers: [incomingLayer] },
			self: baseSelf(), // no timelineEngine — the timeline itself is not exercised, only the exit-candidate logic
			amcp: {},
			phys: (n, bank) => (bank === 'b' ? Number(n) + 100 : Number(n)),
			inactiveBank: 'b',
			activeBank: 'a',
			shouldRunBankCrossfade: true,
			forceCut: false,
			isMergeTransition: false,
			globalT: { type: 'MIX', duration: 25, tween: null },
			framerate: 50,
		})
		assert.equal(takeJobs.length, 0, 'the incoming timeline layer never produces a normal takeJob')
		assert.deepEqual(extraExitCandidates, [outgoingLayer], 'the replaced normal layer must surface as an exit candidate')
	})

	it('a timeline continuing at the same slot (retake / same timeline) is NOT treated as exiting (WO-548)', async () => {
		const outgoingLayer = { layerNumber: 10, source: { type: 'timeline', value: 'tl-1' } }
		const incomingLayer = { layerNumber: 10, source: { type: 'timeline', value: 'tl-1' } }
		const { extraExitCandidates } = await buildTakeJobs({
			incomingSorted: [incomingLayer],
			currentMap: new Map([[10, outgoingLayer]]),
			channel: 1,
			incoming: { layers: [incomingLayer] },
			self: baseSelf(),
			amcp: {},
			phys: (n, bank) => (bank === 'b' ? Number(n) + 100 : Number(n)),
			inactiveBank: 'b',
			activeBank: 'a',
			shouldRunBankCrossfade: true,
			forceCut: false,
			isMergeTransition: false,
			globalT: { type: 'MIX', duration: 25, tween: null },
			framerate: 50,
		})
		assert.deepEqual(extraExitCandidates, [], 'a timeline occupying its own old slot must never be surfaced as exiting itself')
	})

	it('an empty slot (no previous content) produces no exit candidate', async () => {
		const incomingLayer = { layerNumber: 10, source: { type: 'timeline', value: 'tl-1' } }
		const { extraExitCandidates } = await buildTakeJobs({
			incomingSorted: [incomingLayer],
			currentMap: new Map(),
			channel: 1,
			incoming: { layers: [incomingLayer] },
			self: baseSelf(),
			amcp: {},
			phys: (n, bank) => (bank === 'b' ? Number(n) + 100 : Number(n)),
			inactiveBank: 'b',
			activeBank: 'a',
			shouldRunBankCrossfade: true,
			forceCut: false,
			isMergeTransition: false,
			globalT: { type: 'MIX', duration: 25, tween: null },
			framerate: 50,
		})
		assert.deepEqual(extraExitCandidates, [])
	})

	it('regression check: without the fix, the replaced normal layer is silently dropped', () => {
		// Direct check of the pre-fix code shape: the timeline branch `continue`d immediately,
		// before ever consulting currentMap for this layer slot.
		const src = fs.readFileSync(path.join(__dirname, '../../src/engine/scene-take-lbg-jobs.js'), 'utf8')
		const timelineBranch = src.slice(src.indexOf("layer.source.type === 'timeline'"), src.indexOf("let clipRaw = clipPath(layer)"))
		assert.match(timelineBranch, /currentMap\.get\(layer\.layerNumber\)/, 'the timeline branch must consult currentMap before continuing')
	})
})
