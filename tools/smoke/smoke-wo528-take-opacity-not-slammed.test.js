'use strict'

/**
 * WO-528 — a timeline Take mixed instead of cut, and a timeline inside a look flashed.
 *
 * Owner 14.08: *"everything is set to plain mix. from timeline editor hitting take shows the
 * timelines content correctly but with a cut on the screen instead of mix. when trying to play
 * timeline from a look it flashes the timeline on the screen and gets back to the look that was
 * previously on screen."*
 *
 * Found on the wire, not in the source — `log/caspar_2026-08-14.log`, one take:
 *
 *     PLAY   1-211 "…/forest_jester-dv.mov" LOOP
 *     MIXER  1-211 FILL …
 *     MIXER  1-211 OPACITY 1 0          <- instant FULL, straight after PLAY
 *     …
 *     MIXER  1-210 OPACITY 1 25 linear  <- the take's fade-in, ramping 1 -> 1
 *
 * The orchestrator presets every timeline layer to `OPACITY 0 0`, PLAYs, then fades in. But the
 * engine's own per-clip property write lands BETWEEN the preset and the fade at the clip's full
 * base value, so the fade ramps 1 -> 1. Invisible: a CUT, with the correct content. WO-139 T139.2
 * only carved out the KEYFRAME case (`scheduleLeadTween`); a plain clip has no opacity keyframes
 * and fell straight through to the generic emitter, which was not take-aware.
 *
 * The trap this test exists to guard: CUT takes must KEEP the instant write. There is no fade on
 * that path, the preset is 1, and this write is what gives a clip its own base opacity —
 * suppressing it is exactly the invisible-CUT regression WO-139 T139.1 had to patch.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const schedule = require('../../src/engine/timeline-playback-amcp-schedule.js')

/**
 * Minimal `this` for `_applyKeyedMixerProp`: the real method, real keyframe helpers, a recording
 * AMCP double. Nothing about the decision under test is stubbed.
 */
function harness() {
	const calls = []
	const ctx = {
		self: {
			amcp: {
				mixerOpacity: async (ch, layer, val, dur) => {
					calls.push(`OPACITY ${ch}-${layer} ${val} ${dur}`)
				},
				mixerVolume: async (ch, layer, val, dur) => {
					calls.push(`VOLUME ${ch}-${layer} ${val} ${dur}`)
				},
				batchSendChunked: async (lines) => {
					for (const l of lines) calls.push(l)
				},
			},
		},
		_lastKfValues: new Map(),
		_lastKfSegment: new Map(),
		_interpProp: schedule._interpProp,
	}
	// Bind the real implementations onto the harness.
	ctx._applyKeyedMixerProp = schedule._applyKeyedMixerProp.bind(ctx)
	return { ctx, calls }
}

/** A plain clip: no opacity keyframes at all — the case WO-139 never covered. */
const PLAIN_CLIP = { id: 'c1', startTime: 0, keyframes: [], opacity: 1 }

function applyOpacity(ctx, clip, extra) {
	// force=true, playing=false — exactly how a take enters (`_applyAt(id, pos, true, …)`).
	return ctx._applyKeyedMixerProp(1, 211, clip, 'opacity', 0, clip.opacity ?? 1, false, true, 25, extra)
}

test('WO-528: a MIX take does NOT write an instant opacity — the fade owns the layer', () => {
	const { ctx, calls } = harness()
	applyOpacity(ctx, PLAIN_CLIP, { takeFade: true })
	assert.deepEqual(calls, [], `the orchestrator's fade must be the only opacity writer, got ${JSON.stringify(calls)}`)
})

test('WO-528: the value is still RECORDED, so the next tick does not clobber the fade mid-ramp', () => {
	const { ctx, calls } = harness()
	applyOpacity(ctx, PLAIN_CLIP, { takeFade: true })
	assert.equal(ctx._lastKfValues.get('1-211-opacity'), 1, 'the fade ends here, so this IS where the layer lands')

	// The tick right after the take: same value, so `valueChanged` is false and nothing is emitted.
	ctx._applyKeyedMixerProp(1, 211, PLAIN_CLIP, 'opacity', 16, 1, true, false, 25, {})
	assert.deepEqual(calls, [], 'a follow-up tick must not slam opacity to full while Caspar is tweening')
})

test('WO-528 REGRESSION GUARD: a CUT take still writes its opacity (WO-139 T139.1)', () => {
	const { ctx, calls } = harness()
	// forceCut => takeFade false. Without this write a clip with a non-full base opacity would sit
	// at the preset value of 1, and WO-139's stale-0 case would make the take invisible outright.
	applyOpacity(ctx, { ...PLAIN_CLIP, opacity: 0.5 }, { takeFade: false })
	assert.deepEqual(calls, ['OPACITY 1-211 0.5 0'], 'the CUT path is unchanged')
})

test('WO-528: ordinary playback (no take at all) is unchanged', () => {
	const { ctx, calls } = harness()
	applyOpacity(ctx, PLAIN_CLIP, {})
	assert.deepEqual(calls, ['OPACITY 1-211 1 0'])
})

test('WO-528: VOLUME is never suppressed — only opacity is the orchestrator’s to own', () => {
	const { ctx, calls } = harness()
	ctx._applyKeyedMixerProp(1, 211, PLAIN_CLIP, 'volume', 0, 1, false, true, 25, { isVolume: true, takeFade: true })
	assert.deepEqual(calls, ['VOLUME 1-211 1 0'], 'muting a take would be a different bug')
})

test('WO-528: both take paths declare takeFade, and CUT is excluded', () => {
	const fs = require('node:fs')
	const path = require('node:path')
	const root = path.join(__dirname, '../..')
	const takeSrc = fs.readFileSync(path.join(root, 'src/engine/timeline-take.js'), 'utf8')
	// Take button: MIX suppresses, CUT does not.
	assert.match(takeSrc, /playForTake\(tlId, pos, \{ takeFade: !forceCut \}\)/, 'the Take path passes it, CUT excluded')
	// Timeline as a layer inside a look — reached only on the fade branch, which presets to 0.
	assert.match(takeSrc, /eng\.play\(tlId, startPos, \{ takeFade: true \}\)/, 'the look path passes it too')
	// The cut branch of startSceneTimelineLayer must stay a plain play (no preset, so no suppression).
	assert.match(takeSrc, /if \(!\(opts\.fadeDur > 0\)\) \{\n\t\teng\.play\(tlId, startPos\)/, 'the cut branch is untouched')
})
