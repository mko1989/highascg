'use strict'

/**
 * WO-956 — owner 05.11: "i can have different looks but on the first layer i have the same loop running, and changing
 * between looks shouldnt restart the loop" + "different clips [must] also be able to start relative to the clip playing
 * on that layer".
 *  - A PGM take leaves an unchanged "relative" layer playing (no job; the WO-218 SWAP carries it over the bank flip):
 *    measured before, every take reloaded and re-seeked it (0 / +1 frame normally, −13 frames once).
 *  - "Start from beginning", a changed layer, another trim, a playlist, PRV staging (no keepRelativeLayers) still take.
 *  - A different clip starts at the on-air playhead, placed inside its own in / out (looped, or from its in point).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildTakeJobs } = require('../../src/engine/scene-take-lbg-jobs')
const { relativeLayerKeepsPlaying } = require('../../src/engine/scene-transition')
const { fitRelativeSeekToIncomingClip } = require('../../src/engine/scene-play-seek')

const bg = (patch = {}) => ({
	layerNumber: 10,
	source: { type: 'media', value: 'loop.mp4' },
	loop: true,
	startBehaviour: 'relativeToPrevious',
	fill: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
	opacity: 1,
	...patch,
})

async function takeOf(incomingLayer, onAirLayer, opts = {}) {
	const incoming = { id: 'B', layers: [incomingLayer] }
	return buildTakeJobs({
		incomingSorted: incoming.layers,
		currentMap: new Map([[10, onAirLayer]]),
		channel: 2,
		incoming,
		self: { config: { screen_count: 1 }, log: () => {} },
		amcp: {},
		phys: (n, bank) => n + (bank === 'b' ? 100 : 0),
		inactiveBank: 'b',
		activeBank: 'a',
		shouldRunBankCrossfade: true,
		forceCut: false,
		globalT: { type: 'MIX', duration: 25 },
		framerate: 50,
		skipLayerVisualEquality: true,
		...opts,
	})
}

test('PGM take: the unchanged relative loop keeps playing and follows the bank flip', async () => {
	const r = await takeOf(bg(), bg(), { keepRelativeLayers: true })
	assert.equal(r.takeJobs.length, 0, 'no LOADBG / PLAY for it')
	assert.deepEqual(
		r.skippedVisuallyEqualLayers.map((s) => [s.layerNumber, s.physicalLayerNow]),
		[[10, 10]],
		'listed for the WO-218 SWAP 2-10 → 2-110'
	)
})

test('everything else still takes', async () => {
	const cases = [
		['start from beginning', bg({ startBehaviour: 'beginning' }), bg(), true],
		['another clip', bg({ source: { type: 'media', value: 'other.mp4' } }), bg(), true],
		['moved', bg({ fill: { x: 0.5, y: 0, scaleX: 0.5, scaleY: 0.5 } }), bg(), true],
		['another trim out', bg({ trimOutMs: 3940 }), bg(), true],
		['a playlist', bg({ sourceMode: 'list', playlist: [{ value: 'loop.mp4' }] }), bg(), true],
		['PRV staging / replication (no keepRelativeLayers)', bg(), bg(), false],
	]
	for (const [what, inc, cur, keepOpt] of cases) {
		const r = await takeOf(inc, cur, keepOpt ? { keepRelativeLayers: true } : {})
		assert.equal(r.takeJobs.length, 1, what)
	}
	assert.equal(relativeLayerKeepsPlaying(null, bg()), false, 'nothing on air')
	assert.equal(relativeLayerKeepsPlaying(bg({ trimInMs: 200 }), bg({ trimInMs: 200 })), true, 'same trim')
})

test('a different clip starts at the on-air playhead, inside its own in / out', () => {
	const ms = (len) => () => len
	const clipB = bg({ source: { type: 'media', value: 'b.mp4' } })
	assert.equal(fitRelativeSeekToIncomingClip(264, {}, clipB, 50, ms(10000)), 264, 'inside its 500 frames: unchanged')
	assert.equal(fitRelativeSeekToIncomingClip(420, {}, clipB, 50, ms(6000)), 120, 'past its 300 frames: wraps')
	assert.equal(fitRelativeSeekToIncomingClip(420, {}, bg({ loop: false }), 50, ms(6000)), 0, 'one-shot: from its start')
	assert.equal(
		fitRelativeSeekToIncomingClip(420, {}, bg({ trimInMs: 1000, trimOutMs: 5000 }), 50, ms(6000)),
		220,
		'trim 50…250: 50 + (420 − 50) % 200 = 220'
	)
	assert.equal(
		fitRelativeSeekToIncomingClip(900, {}, clipB, 50, () => null),
		900,
		'unknown length: unchanged'
	)
})
