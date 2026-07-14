'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

/**
 * WO-211: Playlist-loop LOOP-token leak fixes + stall watchdog.
 *
 * T211.1: Multi-item auto playlist with loop:true → item 1 staged without LOOP token.
 *         List looping is handled by advance machinery, not per-item LOOP.
 * T211.3: Smoke tests for LOOP token placement.
 * T211.5: Stall watchdog for frozen media.
 * T211.6: Pure function shouldForceAdvance for testable force-advance logic.
 */

test('T211.1: 3-item auto playlist with loop:true → item 1 has NO LOOP token', async () => {
	const { buildTakeJobs } = require('../../src/engine/scene-take-lbg-jobs')

	const self = {
		config: { screen_count: 1 },
		log: (level, msg) => {}, // silence logs
	}
	const phys = (sceneLayerNum, bank) => sceneLayerNum + (bank === 'b' ? 100 : 0)

	// 3-item auto playlist with loop:true (converted from looping single media)
	const incoming = {
		id: 'test-playlist',
		layers: [
			{
				layerNumber: 10,
				sourceMode: 'list',
				playlist: [
					{ type: 'media', value: 'item1.mov' },
					{ type: 'media', value: 'item2.mov' },
					{ type: 'media', value: 'item3.mov' },
				],
				playlistAdvance: 'auto',
				playlistLoop: true,
				loop: true, // <<< this is the trap: loop is true from conversion
			},
		],
	}

	const currentMap = new Map()

	const result = await buildTakeJobs({
		incomingSorted: incoming.layers,
		currentMap,
		channel: 2,
		incoming,
		self,
		amcp: {},
		phys,
		inactiveBank: 'b',
		activeBank: 'a',
		shouldRunBankCrossfade: false,
		forceCut: false,
		isMergeTransition: false,
		globalT: { type: 'CUT' },
		framerate: 25,
		skipLayerVisualEquality: false,
	})

	assert.ok(result && result.takeJobs, 'buildTakeJobs succeeded')
	assert.strictEqual(result.takeJobs.length, 1, 'one take job for one layer')

	const job = result.takeJobs[0]
	assert.ok(job.loadOpts, 'loadOpts present')
	assert.strictEqual(job.loadOpts.loop, false, 'loadOpts.loop is false (multi-item list, no per-item LOOP)')
})

test('T211.1: single-item non-image playlist (playlistLoop unset) → LOOP present', async () => {
	const { buildTakeJobs } = require('../../src/engine/scene-take-lbg-jobs')

	const self = {
		config: { screen_count: 1 },
		log: (level, msg) => {}, // silence logs
	}
	const phys = (sceneLayerNum, bank) => sceneLayerNum + (bank === 'b' ? 100 : 0)

	// Single-item video playlist with no explicit playlistLoop (defaults to true looping)
	const incoming = {
		id: 'test-single-video-loop',
		layers: [
			{
				layerNumber: 10,
				sourceMode: 'list',
				playlist: [{ type: 'media', value: 'video.mov' }],
				playlistAdvance: 'auto',
				// playlistLoop: unset (defaults to true)
			},
		],
	}

	const currentMap = new Map()

	const result = await buildTakeJobs({
		incomingSorted: incoming.layers,
		currentMap,
		channel: 2,
		incoming,
		self,
		amcp: {},
		phys,
		inactiveBank: 'b',
		activeBank: 'a',
		shouldRunBankCrossfade: false,
		forceCut: false,
		isMergeTransition: false,
		globalT: { type: 'CUT' },
		framerate: 25,
		skipLayerVisualEquality: false,
	})

	assert.ok(result && result.takeJobs, 'buildTakeJobs succeeded')
	assert.strictEqual(result.takeJobs.length, 1, 'one take job for one layer')

	const job = result.takeJobs[0]
	assert.ok(job.loadOpts, 'loadOpts present')
	assert.strictEqual(job.loadOpts.loop, true, 'loadOpts.loop is true (single-item non-image, playlistLoop defaults true)')
})

test('T211.1: plain media layer with loop:true → LOOP present', async () => {
	const { buildTakeJobs } = require('../../src/engine/scene-take-lbg-jobs')

	const self = {
		config: { screen_count: 1 },
		log: (level, msg) => {}, // silence logs
	}
	const phys = (sceneLayerNum, bank) => sceneLayerNum + (bank === 'b' ? 100 : 0)

	// Plain media layer (not a playlist) with loop:true
	const incoming = {
		id: 'test-plain-loop',
		layers: [
			{
				layerNumber: 10,
				source: { type: 'media', value: 'looping-video.mov' },
				loop: true,
			},
		],
	}

	const currentMap = new Map()

	const result = await buildTakeJobs({
		incomingSorted: incoming.layers,
		currentMap,
		channel: 2,
		incoming,
		self,
		amcp: {},
		phys,
		inactiveBank: 'b',
		activeBank: 'a',
		shouldRunBankCrossfade: false,
		forceCut: false,
		isMergeTransition: false,
		globalT: { type: 'CUT' },
		framerate: 25,
		skipLayerVisualEquality: false,
	})

	assert.ok(result && result.takeJobs, 'buildTakeJobs succeeded')
	assert.strictEqual(result.takeJobs.length, 1, 'one take job for one layer')

	const job = result.takeJobs[0]
	assert.ok(job.loadOpts, 'loadOpts present')
	assert.strictEqual(job.loadOpts.loop, true, 'loadOpts.loop is true (plain media with loop:true)')
})

test('T211.6: shouldForceAdvance() — fires near-end frozen >2s not-yet-fired', () => {
	const { shouldForceAdvance } = require('../../src/engine/scene-take-lbg-playlist')

	const result = shouldForceAdvance({
		elapsed: 4.9,      // within 0.5s of duration
		duration: 5.0,
		lastElapsed: 4.9,  // no progress
		msSinceProgress: 2500, // >2000ms frozen
		alreadyFired: false,
	})

	assert.strictEqual(result, true, 'should force-advance: near-end, frozen >2s, not yet fired')
})

test('T211.6: shouldForceAdvance() — does NOT fire when progressing', () => {
	const { shouldForceAdvance } = require('../../src/engine/scene-take-lbg-playlist')

	const result = shouldForceAdvance({
		elapsed: 4.0,
		duration: 5.0,
		lastElapsed: 3.5,  // progressing
		msSinceProgress: 500, // <2000ms
		alreadyFired: false,
	})

	assert.strictEqual(result, false, 'should NOT force-advance: playback progressing')
})

test('T211.6: shouldForceAdvance() — does NOT fire when far from end', () => {
	const { shouldForceAdvance } = require('../../src/engine/scene-take-lbg-playlist')

	const result = shouldForceAdvance({
		elapsed: 2.0,      // far from end
		duration: 5.0,
		lastElapsed: 2.0,  // no progress
		msSinceProgress: 3000, // >2000ms
		alreadyFired: false,
	})

	assert.strictEqual(result, false, 'should NOT force-advance: not near end')
})

test('T211.6: shouldForceAdvance() — does NOT fire when already fired', () => {
	const { shouldForceAdvance } = require('../../src/engine/scene-take-lbg-playlist')

	const result = shouldForceAdvance({
		elapsed: 4.9,      // within 0.5s of duration
		duration: 5.0,
		lastElapsed: 4.9,  // no progress
		msSinceProgress: 2500, // >2000ms
		alreadyFired: true, // <<< already fired
	})

	assert.strictEqual(result, false, 'should NOT fire again: already fired for this file')
})

test('T211.6: shouldForceAdvance() — does NOT fire when duration is 0', () => {
	const { shouldForceAdvance } = require('../../src/engine/scene-take-lbg-playlist')

	const result = shouldForceAdvance({
		elapsed: 0,
		duration: 0, // unknown duration
		lastElapsed: 0,
		msSinceProgress: 3000,
		alreadyFired: false,
	})

	assert.strictEqual(result, false, 'should NOT fire: duration unknown (0)')
})
