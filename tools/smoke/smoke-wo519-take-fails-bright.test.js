'use strict'

/**
 * WO-519 — a look→timeline take must never leave a layer playing invisibly.
 *
 * Owner 13.08: *"transitions between looks and timelines doesnt work correctly, either some of the
 * layers play or nothing at all. this already happend so there should be a wo about that."* — there
 * was: WO-139 (Looks → timeline Take smoothness), whose A139.2 operator QA on real PGM output was
 * never done.
 *
 * A MIX take presets every timeline layer to opacity 0 (WO-139 T139.1), then either the layer-level
 * fade or the clip's own keyframe tween brings it up. `collectClipOpacityFadeLayers` decides which
 * layers are EXCLUDED from the layer fade — and it tested only keyframe TIMES, never their values.
 * A clip whose opacity track never reaches a visible value (a fade-OUT, or a track that is 0 from
 * the take position on) was excluded exactly like a proper fade-in, so it stayed at 0 and played
 * invisibly. Some clips keyframed → "some of the layers play"; all keyframed → "nothing at all".
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { collectClipOpacityFadeLayers } = require('../../src/engine/timeline-take.js')

/** Engine double: one clip per layer, `_clipAt` returns it regardless of position. */
function engineWith(clips) {
	return { _clipAt: (layer) => clips[layer.__i] ?? null }
}
function timelineOf(clips) {
	return { layers: clips.map((_, i) => ({ __i: i })) }
}
const kf = (time, value) => ({ property: 'opacity', time, value })

test('WO-519: a clip that fades IN still owns its opacity (WO-139 behaviour preserved)', () => {
	const clips = [{ startTime: 0, keyframes: [kf(0, 0), kf(1, 1)] }]
	const set = collectClipOpacityFadeLayers(engineWith(clips), timelineOf(clips), 0)
	assert.equal(set.size, 1, 'it reaches a visible value, so the clip tween must own the layer')
})

test('WO-519: a fade-OUT taken at its START is still owned by the clip', () => {
	// 1 -> 0 taken at rel 0: the clip's own track opens at full, so it DOES light the layer up.
	// Rescuing this one would be wrong — it would fight the intended fade.
	const clips = [{ startTime: 0, keyframes: [kf(0, 1), kf(2, 0)] }]
	const set = collectClipOpacityFadeLayers(engineWith(clips), timelineOf(clips), 0)
	assert.equal(set.size, 1, 'the clip opens visible; leave its opacity alone')
})

test('WO-519: a fade-OUT taken PAST its last visible keyframe is rescued', () => {
	// Taking at rel 1.5 leaves only kf(2, 0) ahead: nothing remaining will raise the layer, and the
	// MIX preset already put it at 0. This is the invisible-layer case.
	const clips = [{ startTime: 0, keyframes: [kf(0, 1), kf(2, 0)] }]
	const set = collectClipOpacityFadeLayers(engineWith(clips), timelineOf(clips), 1.5)
	assert.equal(set.size, 0, 'THE BUG: preset to 0 with nothing ahead to raise it — plays invisibly')
})

test('WO-519: keyframes entirely at zero from the take position on are not excluded', () => {
	const clips = [{ startTime: 0, keyframes: [kf(0, 0), kf(3, 0)] }]
	const set = collectClipOpacityFadeLayers(engineWith(clips), timelineOf(clips), 0)
	assert.equal(set.size, 0, 'nothing here will ever light the layer up')
})

test('WO-519: only keyframes AT OR AFTER the take position count', () => {
	// Taking at rel=2: the visible keyframe at t=0 is already behind us and cannot raise anything.
	const clips = [{ startTime: 0, keyframes: [kf(0, 1), kf(1, 0), kf(5, 0)] }]
	const set = collectClipOpacityFadeLayers(engineWith(clips), timelineOf(clips), 2)
	assert.equal(set.size, 0, 'a past peak must not be mistaken for a future one')
})

test('WO-519: mixed layers — the keyframed-dark one is rescued, the fade-in one is left alone', () => {
	const clips = [
		{ startTime: 0, keyframes: [kf(0, 0), kf(1, 1)] }, // fade-in → clip owns it
		{ startTime: 0, keyframes: [kf(0, 0), kf(3, 0)] }, // dark throughout → must be rescued
		{ startTime: 0, keyframes: [] }, // no keyframes → never excluded
	]
	const set = collectClipOpacityFadeLayers(engineWith(clips), timelineOf(clips), 0)
	assert.equal(set.size, 1, `only the fade-in layer may be excluded, got ${set.size}`)
})

test('WO-519: a single keyframe is never excluded (unchanged — needs >= 2 to tween)', () => {
	const clips = [{ startTime: 0, keyframes: [kf(0, 1)] }]
	assert.equal(collectClipOpacityFadeLayers(engineWith(clips), timelineOf(clips), 0).size, 0)
})

test('WO-519: a clip with no keyframes at all is never excluded', () => {
	const clips = [{ startTime: 0, keyframes: [] }]
	assert.equal(collectClipOpacityFadeLayers(engineWith(clips), timelineOf(clips), 0).size, 0)
})
