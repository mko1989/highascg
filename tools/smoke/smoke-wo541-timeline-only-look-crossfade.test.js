'use strict'

/**
 * WO-541 — a look whose ONLY content is a timeline layer never lit up: it played invisibly.
 *
 * Owner report: a timeline dropped into a look on its own (no other media/CG layers) showed
 * nothing at all when taken with a plain MIX over other content already on air.
 *
 * Root cause, found by reading `runSceneTakeLbgAmcpPipeline` (`scene-take-lbg-amcp-pipeline.js`):
 * a timeline-type layer never becomes a takeJob — `buildTakeJobs` (`scene-take-lbg-jobs.js`)
 * `continue`s past the takeJobs loop for `layer.source.type === 'timeline'` and tracks its
 * physical layers separately in `timelineFadeInPhys`. On a plain (non-merge) MIX, `mergeMixerExtras`
 * is unconditionally `[]` (`buildMergeMixerExtrasForTake` returns early unless `isMergeTransition`).
 * So when a look's every layer is a timeline, `takeJobs.length === 0 && mergeMixerExtras.length
 * === 0`, and the pipeline's outer gate (`if (takeJobs.length > 0 || mergeMixerExtras.length > 0)`)
 * skipped the ENTIRE block — the only place `crossfadeLines` (and the timeline's own fade-in
 * ramp, folded in there) gets built. Meanwhile `startSceneTimelineLayer` had already preset those
 * physical layers to `MIXER ch-L OPACITY 0 0` before this ever ran. Preset to 0, never written
 * again: permanently invisible. The `takeJobs.length === 0` branch inside the block (comment:
 * "Timeline-only / exit-only crossfade") was already written to handle exactly this case — it
 * could just never be reached.
 *
 * Fix: widen the outer gate to also enter when `shouldRunBankCrossfade && timelineFadeInPhys.length
 * > 0`, so a timeline-only look reaches the pre-existing direct-send branch.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { runSceneTakeLbgAmcpPipeline } = require('../../src/engine/scene-take-lbg-amcp-pipeline.js')

function baseArgs(overrides) {
	return Object.assign(
		{
			self: { log: () => {} },
			channel: 1,
			incomingGb: null,
			incomingGbEnabled: false,
			sameGbTemplateType: false,
			incomingGbLayer: 998,
			gbWillFadeIn: false,
			takeJobs: [],
			mergeMixerExtras: [],
			currentSceneLayers: [],
			currentMap: new Map([[5, { layerNumber: 5, source: { type: 'media', value: 'outgoing-clip' } }]]),
			shouldRunBankCrossfade: true,
			isMergeTransition: false,
			fadeDur: 25,
			fadeTw: null,
			phys: (n, bank) => (bank === 'b' ? Number(n) + 100 : Number(n)),
			activeBank: 'a',
			inactiveBank: 'b',
			exitMedia: [],
			gbWillFadeOut: false,
			currentGbLayer: 998,
			framerate: 50,
			fadeWatcher: null,
			notifyProgramTransitionStarted: () => {},
			incoming: { layers: [{ layerNumber: 0, source: { type: 'timeline', value: 'tl-1' } }] },
			timelineFadeInPhys: [210, 211],
		},
		overrides,
	)
}

function amcpDouble() {
	const sent = []
	return {
		sent,
		amcp: {
			_context: {},
			batchSendChunked: async (lines) => {
				sent.push(...lines)
			},
			mixerCommit: async (ch) => {
				sent.push(`MIXER ${ch} COMMIT`)
			},
			mixerClear: async () => {},
			_send: async (line) => {
				sent.push(line)
				return {}
			},
		},
	}
}

describe('WO-541: a timeline-only look reaches its own crossfade', () => {
	it('takeJobs=[] + mergeMixerExtras=[] but a timeline needs fading in: the fade-in ramp IS sent', async () => {
		const { amcp, sent } = amcpDouble()
		let notified = 0
		const fadeClockRef = { start: null }
		await runSceneTakeLbgAmcpPipeline(
			amcp,
			fadeClockRef,
			baseArgs({ notifyProgramTransitionStarted: () => { notified++ } }),
		)

		assert.ok(
			sent.includes('MIXER 1-210 OPACITY 1 25'),
			`timeline layer 210's fade-in ramp was sent: ${JSON.stringify(sent)}`,
		)
		assert.ok(
			sent.includes('MIXER 1-211 OPACITY 1 25'),
			`timeline layer 211's fade-in ramp was sent: ${JSON.stringify(sent)}`,
		)
		assert.ok(fadeClockRef.start != null, 'fade clock started — teardown will wait for the mix window')
		assert.equal(notified, 1, 'program-transition-started notified exactly once')
	})

	it('the outgoing (previously live) layer still fades out in the same batch', async () => {
		const { amcp, sent } = amcpDouble()
		await runSceneTakeLbgAmcpPipeline(
			amcp,
			{ start: null },
			baseArgs({ exitMedia: [{ layerNumber: 5, source: { type: 'media', value: 'outgoing-clip' } }] }),
		)
		assert.ok(
			sent.includes('MIXER 1-5 OPACITY 0 25'),
			`outgoing layer 5 fades out alongside the incoming timeline: ${JSON.stringify(sent)}`,
		)
	})

	it('no bank crossfade requested (shouldRunBankCrossfade=false): stays a no-op here — the plain exit-fade path owns it', async () => {
		const { amcp, sent } = amcpDouble()
		await runSceneTakeLbgAmcpPipeline(
			amcp,
			{ start: null },
			baseArgs({ shouldRunBankCrossfade: false }),
		)
		assert.equal(sent.length, 0, `nothing sent from this pipeline when shouldRunBankCrossfade is false: ${JSON.stringify(sent)}`)
	})

	it('no timeline to fade in and no takeJobs/mergeMixerExtras: still a no-op (unrelated empty takes unaffected)', async () => {
		const { amcp, sent } = amcpDouble()
		await runSceneTakeLbgAmcpPipeline(
			amcp,
			{ start: null },
			baseArgs({ timelineFadeInPhys: [] }),
		)
		assert.equal(sent.length, 0, `nothing to do, nothing sent: ${JSON.stringify(sent)}`)
	})
})
