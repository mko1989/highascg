'use strict'

/**
 * WO-553 (part 2) — "switching between timeline look and normal look results in a cut."
 *
 * `buildTakeJobs` (`scene-take-lbg-jobs.js`) has always had a carve-out for this exact scenario,
 * documented right at the call site:
 *
 *     // Bank B (+100) stacks above bank A — only pre-hide when incoming is the top layer.
 *     // An outgoing timeline (band 210+) sits above BOTH look banks, so the incoming bank-B look is
 *     // then genuinely BELOW the real top: stage it at full opacity (revealed as the timeline fades)
 *     // rather than fading it in, which would double-ramp with the timeline fade-out into a dip.
 *     const incomingIsAboveOutgoing =
 *         shouldRunBankCrossfade && inactiveBank === 'b' && activeBank === 'a' && !outgoingTopIsTimeline
 *
 * `outgoingTopIsTimeline` is a real parameter with real logic behind it — but `buildTakeJobs` has
 * exactly one caller (`scene-take-lbg.js`), and that caller never passed it. It was permanently
 * `false`, so the carve-out this comment describes never fired: whenever a timeline was exiting a
 * look and the incoming look landed on bank B (the common case — the very next take after any
 * take), the incoming layer was wrongly treated as the topmost layer and told to fade IN (0→1)
 * while the real top layer — the timeline band, via `mergeMixerExtras` in `scene-take-lbg.js` —
 * faded OUT (1→0) at the same time. Two opposite ramps stacked on top of each other read as a
 * dip, or (depending on timing) a visible cut instead of a smooth reveal-through-the-fade.
 *
 * Fixed by wiring `outgoingTopIsTimeline: !!activeTimelineIdToFadeOut` into the `buildTakeJobs`
 * call. This test exercises `buildTakeJobs` directly (the smallest unit that owns the decision).
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

function baseOpts(overrides) {
	const incomingLayer = { layerNumber: 0, source: { type: 'media', value: 'new-look-clip.mov' } }
	const outgoingLayer = { layerNumber: 0, source: { type: 'timeline', value: 'tl-1' } }
	return Object.assign(
		{
			incomingSorted: [incomingLayer],
			currentMap: new Map([[0, outgoingLayer]]),
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
		},
		overrides,
	)
}

describe('WO-553: buildTakeJobs does not double-ramp an incoming layer against an exiting timeline', () => {
	it('outgoingTopIsTimeline: true — incoming layer is staged at full opacity, revealed by the timeline fade (no ramp)', async () => {
		const { takeJobs } = await buildTakeJobs(baseOpts({ outgoingTopIsTimeline: true }))
		assert.equal(takeJobs.length, 1)
		const job = takeJobs[0]
		assert.equal(job.incomingIsAboveOutgoing, false, 'the timeline, not bank B, is the real top layer')
		assert.equal(job.prePlayOpacityZeroLine, null, 'must not be preset to 0 (that implies a fade-in ramp follows)')
		assert.match(job.prePlayOpacityFullLine || '', /OPACITY 1 0$/, 'staged at full opacity, non-ramping, before PLAY')
	})

	it('outgoingTopIsTimeline: false (or omitted) — the old, wrong double-ramp behavior', async () => {
		for (const opts of [{ outgoingTopIsTimeline: false }, {}]) {
			const { takeJobs } = await buildTakeJobs(baseOpts(opts))
			const job = takeJobs[0]
			assert.equal(job.incomingIsAboveOutgoing, true, `opts=${JSON.stringify(opts)}`)
			assert.ok(job.prePlayOpacityZeroLine, `opts=${JSON.stringify(opts)}: incoming layer ramps in`)
			assert.equal(job.prePlayOpacityFullLine, null, `opts=${JSON.stringify(opts)}`)
		}
	})

	it('outgoingTopIsTimeline is irrelevant when the incoming look is not landing on bank B', async () => {
		const { takeJobs } = await buildTakeJobs(
			baseOpts({ outgoingTopIsTimeline: true, inactiveBank: 'a', activeBank: 'b' }),
		)
		assert.equal(takeJobs[0].incomingIsAboveOutgoing, false)
	})
})

describe('WO-553: scene-take-lbg.js wires outgoingTopIsTimeline from activeTimelineIdToFadeOut', () => {
	const src = fs.readFileSync(path.join(__dirname, '../../src/engine/scene-take-lbg.js'), 'utf8')

	it('the buildTakeJobs call passes it', () => {
		assert.match(src, /outgoingTopIsTimeline:\s*!!activeTimelineIdToFadeOut/)
	})
})
