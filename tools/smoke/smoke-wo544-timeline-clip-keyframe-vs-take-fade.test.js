'use strict'

/**
 * WO-544 — a timeline clip with its OWN opacity keyframes fought the take's crossfade.
 *
 * Owner 02.09, live QA of WO-541: *"playing from look does not work correctly, it goes up in
 * opacity then down, then when i play another look the timeline shows up."*
 *
 * WO-541 fixed the case of a plain clip (no opacity keyframes) inside a timeline-only look. This
 * is the other half: a clip WITH its own opacity keyframes. `startSceneTimelineLayer`
 * (timeline-take.js) presets the layer to `OPACITY 0 0`, then calls `eng.play(tlId, startPos,
 * { takeFade: true, restart })` — deliberately `play()`, never `playForTake()`, because the CUT
 * branch has no orchestrator commit to receive an uncommitted DEFER lead tween (WO-537, the
 * WO-519 fail-dark class). But that means `take: true` — the flag that gates `scheduleLeadTween`,
 * the mechanism meant to fold a clip's own keyframe tween into the take's own batched commit — is
 * NEVER set on this path. `_applyKeyedMixerProp`'s `segChanged` branch (the one that actually
 * fires the clip's own keyframe segment as an instant-start + DEFER tween) was gated by nothing at
 * all — it wrote regardless of `takeFade`, immediately, via its own separate AMCP call —
 * completely uncoordinated with (and starting before) the take's own crossfade batch. Two
 * competing writers on the same layer, "last writer wins": exactly "goes up then down". The layer
 * then sits at whatever the clip's own curve last wrote — often not full opacity — until an
 * unrelated `MIXER CLEAR` (from some later take) resets it to 1 and reveals the still-running
 * content: "shows up when i play another look".
 *
 * Fix: `segChanged` now also honors `takeFade` (matching the steady-state branch's existing
 * WO-528 guard) — but deliberately does NOT record `_lastKfSegment`/`_lastKfValues`, so the very
 * next tick (`takeFade` is only ever passed on the initial play() apply, never again) issues the
 * tween properly instead of never issuing it at all.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const schedule = require('../../src/engine/timeline-playback-amcp-schedule.js')
// _interpProp/_lerp live on TimelineEngine.prototype (timeline-engine.js), not this mixin module —
// opacity/volume interpolation never touches _programResolutionForPlayback, so binding them plain is safe.
const { TimelineEngine } = require('../../src/engine/timeline-engine.js')

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
		_interpProp: TimelineEngine.prototype._interpProp,
		_lerp: TimelineEngine.prototype._lerp,
	}
	ctx._applyKeyedMixerProp = schedule._applyKeyedMixerProp.bind(ctx)
	return { ctx, calls }
}

/** A clip whose own opacity animates 0 -> 1 over the first second — a fade-in baked into the clip. */
const FADE_IN_CLIP = {
	id: 'c1',
	startTime: 0,
	opacity: 1,
	keyframes: [
		{ property: 'opacity', time: 0, value: 0 },
		{ property: 'opacity', time: 1000, value: 1 },
	],
}

/** Mid-span position: force=true, playing=true — exactly how the look path's initial play() apply enters. */
function applyAtLookPlayEntry(ctx, clip, extra) {
	return ctx._applyKeyedMixerProp(1, 210, clip, 'opacity', 300, 1, true, true, 25, extra)
}

test('WO-544: takeFade suppresses the clip’s own keyframe segment write, not just the steady-state one', () => {
	const { ctx, calls } = harness()
	applyAtLookPlayEntry(ctx, FADE_IN_CLIP, { takeFade: true })
	assert.deepEqual(calls, [], `the orchestrator's own crossfade must be the only opacity writer, got ${JSON.stringify(calls)}`)
})

test('WO-544: suppression does NOT record segment/value state — so the very next tick still fires it', () => {
	const { ctx } = harness()
	applyAtLookPlayEntry(ctx, FADE_IN_CLIP, { takeFade: true })
	assert.equal(ctx._lastKfSegment.size, 0, 'nothing recorded on the suppressed call')
	assert.equal(ctx._lastKfValues.size, 0, 'nothing recorded on the suppressed call')

	// The next real tick: no takeFade (never passed again after the initial play() apply) — collectLines,
	// matching the real production call shape (_syncAmcpLayers always passes it).
	const lines = []
	const sent = ctx._applyKeyedMixerProp(1, 210, FADE_IN_CLIP, 'opacity', 320, 1, true, false, 25, { collectLines: lines })
	assert.equal(sent, true, 'the tween is now issued')
	assert.ok(
		lines.some((l) => /^MIXER 1-210 OPACITY .* DEFER$/.test(l)),
		`a real DEFER tween landed on the follow-up tick: ${JSON.stringify(lines)}`,
	)
})

test('WO-544: without takeFade, the segment write is unchanged (ordinary playback, no take involved)', () => {
	const { ctx } = harness()
	const lines = []
	const sent = ctx._applyKeyedMixerProp(1, 210, FADE_IN_CLIP, 'opacity', 300, 1, true, true, 25, { collectLines: lines })
	assert.equal(sent, true)
	// localMs=300 is already inside the 0-1000 span, so the instant start rides the CURRENT
	// interpolated value (0.3), not a jump back to the segment's literal t0 value — that is the
	// existing (unchanged) `localMs > t0 + 2 ? localMs : t0` behavior, not part of this fix.
	assert.ok(lines.includes('MIXER 1-210 OPACITY 0.3 0'), `instant start-of-segment write present: ${JSON.stringify(lines)}`)
	assert.ok(lines.some((l) => /^MIXER 1-210 OPACITY 1 \d+ .*DEFER$/.test(l)), `DEFER tween to the segment end present: ${JSON.stringify(lines)}`)
})

test('WO-544: a CUT-branch call (no takeFade) still gets the clip’s own keyframe write — no regression on the cut path', () => {
	const { ctx } = harness()
	// startSceneTimelineLayer's cut branch calls eng.play(tlId, startPos, { restart }) — no takeFade key at all.
	const lines = []
	const sent = ctx._applyKeyedMixerProp(1, 210, FADE_IN_CLIP, 'opacity', 300, 1, true, true, 25, { restart: true, collectLines: lines })
	assert.equal(sent, true, 'CUT takes must still receive the clip’s own opacity — WO-139 T139.1’s invisible-CUT class')
	assert.ok(lines.length > 0)
})

test('WO-544: the Take-button path (scheduleLeadTween, take:true) is untouched — still its own early-return branch', () => {
	const { ctx, calls } = harness()
	const sent = ctx._applyKeyedMixerProp(1, 210, FADE_IN_CLIP, 'opacity', 300, 1, true, true, 25, {
		scheduleLeadTween: true,
		takeFade: true,
	})
	assert.equal(sent, true)
	assert.ok(
		calls.some((l) => /DEFER/.test(l)),
		`playForTake's lead-tween mechanism still fires its own batched DEFER: ${JSON.stringify(calls)}`,
	)
})

test('WO-544: VOLUME keyframes are never suppressed by takeFade (only opacity is the orchestrator’s to own)', () => {
	const { ctx, calls } = harness()
	const VOL_CLIP = {
		id: 'c2',
		startTime: 0,
		keyframes: [
			{ property: 'volume', time: 0, value: 0 },
			{ property: 'volume', time: 1000, value: 1 },
		],
	}
	const sent = ctx._applyKeyedMixerProp(1, 210, VOL_CLIP, 'volume', 300, 1, true, true, 25, {
		isVolume: true,
		takeFade: true,
	})
	assert.equal(sent, true, 'volume keyframes are unaffected by an opacity-only orchestrator guard')
	assert.ok(calls.length > 0)
})
