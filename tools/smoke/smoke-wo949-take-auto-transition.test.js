'use strict'

/**
 * WO-949 — a look's stored "auto" transition (duration 12 = half the screen's fps) is resolved when the server builds the
 * take. Box 05.11: a "MIX auto 25 fr" look on a 50 fps screen mixed over 12 frames (probe: green 169 → 12 in 12 frames;
 * Caspar: `MIXER 2-110 OPACITY 1 12 linear`).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildServerIncomingScene } = require('../../src/engine/scene-take-payload')

const look = (t, layerT) => ({
	id: 'l1',
	name: 'L',
	defaultTransition: t,
	layers: [{ layerNumber: 10, source: { type: 'media', value: 'a.mp4' }, ...(layerT ? { transition: layerT } : {}) }],
})
const map = (fps) => ({ programResolutions: [{ w: 1920, h: 1080, fps }] })

test('WO-949: auto (12) → half the screen fps; explicit durations and CUT untouched', async () => {
	const at50 = await buildServerIncomingScene(look({ type: 'MIX', duration: 12, tween: 'linear' }), {
		mainIdx: 0,
		channelMap: map(50),
	})
	assert.deepEqual(at50.defaultTransition, { type: 'MIX', duration: 25, tween: 'linear' })
	const at30 = await buildServerIncomingScene(look({ type: 'MIX', duration: 12, tween: 'linear' }), {
		mainIdx: 0,
		channelMap: map(30),
	})
	assert.equal(at30.defaultTransition.duration, 15)
	const explicit = await buildServerIncomingScene(look({ type: 'MIX', duration: 20, tween: 'linear' }), {
		mainIdx: 0,
		channelMap: map(50),
	})
	assert.equal(explicit.defaultTransition.duration, 20, 'a typed 20 stays 20')
	const cut = await buildServerIncomingScene(look({ type: 'CUT', duration: 0, tween: 'linear' }), {
		mainIdx: 0,
		channelMap: map(50),
	})
	assert.deepEqual(cut.defaultTransition, { type: 'CUT', duration: 0, tween: 'linear' })
	const none = await buildServerIncomingScene(look(undefined), { mainIdx: 0, channelMap: map(50) })
	assert.equal(none.defaultTransition.type, 'CUT', 'no stored transition is still a CUT')
})

test('WO-949: per-layer transitions resolve the same way; no fps known → 50', async () => {
	const s = await buildServerIncomingScene(look({ type: 'MIX', duration: 12 }, { type: 'PUSH', duration: 12 }), {
		mainIdx: 0,
		channelMap: {},
	})
	assert.equal(s.defaultTransition.duration, 25)
	assert.equal(s.layers[0].transition.duration, 25)
	const pgmOnly = await buildServerIncomingScene(look({ type: 'MIX', duration: 12 }), {
		mainIdx: 0,
		channelMap: map(50),
		pgmOnly: true,
	})
	assert.deepEqual(
		[pgmOnly.defaultTransition.type, pgmOnly.defaultTransition.duration],
		['MIX + ANIMATE', 25],
		'PGM-only keeps the resolved length'
	)
})
