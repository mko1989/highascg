'use strict'

/**
 * WO-570 — inspector media transport for a look layer: play/pause, trim in/out, scrub bar.
 *
 * Three independently-testable pieces:
 *  1. playback-tracker.js: recordPause/recordResume/recordSeek keep the `playback.matrix`
 *     position tracker (Date.now()-based) accurate across a live PAUSE/RESUME/SEEK, so a scrub
 *     bar built on it doesn't drift or jump on its next tick.
 *  2. scene-play-seek.js: a persisted `layer.trimInMs` starts a 'beginning' take there instead
 *     of frame 0.
 *  3. scene-take-lbg-jobs.js: a persisted `layer.trimOutMs` reaches the AMCP LOAD/PLAY as a
 *     LENGTH frame count, relative to wherever the take actually starts (not necessarily trimIn).
 */

const test = require('node:test')
const assert = require('node:assert/strict')

test('recordPause freezes elapsed time; recordResume rebases startedAt to resume exactly there', () => {
	const playbackTracker = require('../../src/state/playback-tracker')
	const ctx = { _playbackMatrix: {} }
	const before = Date.now()
	playbackTracker.recordPlay(ctx, 2, 10, 'clip.mov', { silent: true })
	ctx._playbackMatrix['2-10'].startedAt = before - 5000 // pretend 5s have already elapsed
	ctx._playbackMatrix['2-10'].durationMs = 60000

	playbackTracker.recordPause(ctx, 2, 10)
	const cell = ctx._playbackMatrix['2-10']
	assert.equal(cell.playing, false, 'paused')
	assert.ok(
		cell.pausedElapsedMs >= 4990 && cell.pausedElapsedMs <= 5050,
		`elapsed frozen near 5000ms, got ${cell.pausedElapsedMs}`
	)

	// Pausing again (already paused) must be a no-op — must not re-derive elapsed from a stale startedAt.
	const frozenElapsed = cell.pausedElapsedMs
	playbackTracker.recordPause(ctx, 2, 10)
	assert.equal(cell.pausedElapsedMs, frozenElapsed, 'pause while already paused does not touch the frozen value')

	playbackTracker.recordResume(ctx, 2, 10)
	assert.equal(cell.playing, true, 'resumed')
	assert.equal(cell.pausedElapsedMs, undefined, 'pausedElapsedMs cleared on resume')
	const elapsedAfterResume = Date.now() - cell.startedAt
	assert.ok(
		elapsedAfterResume >= 4990 && elapsedAfterResume <= 5100,
		`resume picks up near the frozen point, got ${elapsedAfterResume}`
	)
})

test('recordSeek rebases a playing cell (startedAt) and a paused cell (pausedElapsedMs) to the same position', () => {
	const playbackTracker = require('../../src/state/playback-tracker')

	const ctxPlaying = { _playbackMatrix: {} }
	playbackTracker.recordPlay(ctxPlaying, 3, 11, 'clip.mov', { silent: true })
	playbackTracker.recordSeek(ctxPlaying, 3, 11, 20000)
	const playingCell = ctxPlaying._playbackMatrix['3-11']
	const elapsed = Date.now() - playingCell.startedAt
	assert.ok(elapsed >= 19950 && elapsed <= 20100, `seek while playing lands near 20000ms, got ${elapsed}`)

	const ctxPaused = { _playbackMatrix: {} }
	playbackTracker.recordPlay(ctxPaused, 3, 11, 'clip.mov', { silent: true })
	playbackTracker.recordPause(ctxPaused, 3, 11)
	playbackTracker.recordSeek(ctxPaused, 3, 11, 7500)
	assert.equal(
		ctxPaused._playbackMatrix['3-11'].pausedElapsedMs,
		7500,
		'seek while paused sets the frozen position directly'
	)
	assert.equal(ctxPaused._playbackMatrix['3-11'].playing, false, 'seek does not change play state')
})

test('recordPause/recordResume/recordSeek are no-ops for an untracked channel-layer', () => {
	const playbackTracker = require('../../src/state/playback-tracker')
	const ctx = { _playbackMatrix: {} }
	// Nothing recorded for 9-99 — must not throw, must not fabricate a cell.
	playbackTracker.recordPause(ctx, 9, 99)
	playbackTracker.recordResume(ctx, 9, 99)
	playbackTracker.recordSeek(ctx, 9, 99, 1000)
	assert.equal(ctx._playbackMatrix['9-99'], undefined)
})

test('POST /api/seek sends CALL {ch-l} SEEK {frame} and rebases the playback tracker to positionMs', async () => {
	const { handlePost } = require('../../src/api/routes-amcp')
	const playbackTracker = require('../../src/state/playback-tracker')
	const calls = []
	const ctx = {
		_playbackMatrix: {},
		amcp: {
			call: async (channel, layer, fn, paramsStr) => {
				calls.push({ channel, layer, fn, paramsStr })
				return { ok: true }
			},
		},
	}
	playbackTracker.recordPlay(ctx, 4, 12, 'clip.mov', { silent: true })

	const res = await handlePost(
		'/api/seek',
		JSON.stringify({ channel: 4, layer: 12, frame: 250, positionMs: 10000 }),
		ctx
	)
	assert.equal(res.status, 200)
	assert.deepEqual(calls, [{ channel: 4, layer: 12, fn: 'SEEK', paramsStr: '250' }])
	const elapsed = Date.now() - ctx._playbackMatrix['4-12'].startedAt
	assert.ok(elapsed >= 9950 && elapsed <= 10100, `tracker rebased to ~10000ms, got ${elapsed}`)
})

test('POST /api/seek rejects a missing/invalid frame without touching AMCP', async () => {
	const { handlePost } = require('../../src/api/routes-amcp')
	let called = false
	const ctx = {
		amcp: {
			call: async () => {
				called = true
			},
		},
	}
	const res = await handlePost('/api/seek', JSON.stringify({ channel: 1, layer: 10 }), ctx)
	assert.equal(res.status, 400)
	assert.equal(called, false)
})

test('resolvePlaySeekFramesForSceneLayer: trimInMs starts a beginning take there instead of frame 0', () => {
	const { resolvePlaySeekFramesForSceneLayer } = require('../../src/engine/scene-play-seek')
	const ctx = {}
	const phys = (n) => n

	const untrimmed = resolvePlaySeekFramesForSceneLayer({ layerNumber: 10, startBehaviour: 'beginning' }, ctx, {
		channel: 1,
		layerNumber: 10,
		fps: 25,
		forceCut: true,
		phys,
		activeBank: 'a',
		incoming: {},
	})
	assert.equal(untrimmed, 0, 'no trimInMs set — unchanged frame-0 behaviour')

	const trimmed = resolvePlaySeekFramesForSceneLayer(
		{ layerNumber: 10, startBehaviour: 'beginning', trimInMs: 2000 },
		ctx,
		{ channel: 1, layerNumber: 10, fps: 25, forceCut: true, phys, activeBank: 'a', incoming: {} }
	)
	assert.equal(trimmed, 50, '2000ms @ 25fps = frame 50')
})

test('buildTakeJobs: trimOutMs reaches loadOpts.length relative to the resolved start frame', async () => {
	const { buildTakeJobs } = require('../../src/engine/scene-take-lbg-jobs')
	const self = { config: { screen_count: 1 }, log: () => {} }
	const phys = (n, bank) => n + (bank === 'b' ? 100 : 0)

	async function take(layerPatch) {
		const incoming = {
			id: 'test-trim',
			layers: [
				{ layerNumber: 10, source: { type: 'media', value: 'clip.mov' }, startBehaviour: 'beginning', ...layerPatch },
			],
		}
		const result = await buildTakeJobs({
			incomingSorted: incoming.layers,
			currentMap: new Map(),
			channel: 2,
			incoming,
			self,
			amcp: {},
			phys,
			inactiveBank: 'b',
			activeBank: 'a',
			shouldRunBankCrossfade: false,
			forceCut: true,
			isMergeTransition: false,
			globalT: { type: 'CUT' },
			framerate: 25,
			skipLayerVisualEquality: false,
		})
		return result.takeJobs[0]
	}

	const noTrim = await take({})
	assert.equal(noTrim.loadOpts.length, undefined, 'no trimOutMs — LENGTH stays unset (dead-code baseline preserved)')

	const trimOutOnly = await take({ trimOutMs: 4000 })
	assert.equal(trimOutOnly.loadOpts.seek, 0, 'sanity: starts at 0 (beginning, no trimIn)')
	assert.equal(trimOutOnly.loadOpts.length, 100, '4000ms @ 25fps from frame 0 = 100 frames')

	const trimInAndOut = await take({ trimInMs: 1000, trimOutMs: 4000 })
	assert.equal(trimInAndOut.loadOpts.seek, 25, 'sanity: starts at trimIn frame 25')
	assert.equal(
		trimInAndOut.loadOpts.length,
		75,
		'LENGTH is relative to the actual start (100 - 25), not the raw trimOut frame'
	)

	const degenerate = await take({ trimInMs: 5000, trimOutMs: 4000 })
	assert.equal(
		degenerate.loadOpts.length,
		undefined,
		'trimOut at/before the resolved start yields no LENGTH rather than a negative one'
	)
})

test('buildIncomingScenePayload (client take-wire builder) carries trimInMs/trimOutMs — the actual bug the owner hit', () => {
	// WO-570 follow-up: patchLayer() set trimInMs/trimOutMs on the live client-side layer object
	// fine, and the server-side engine (tested above) honors them fine — but the row this function
	// builds is an explicit field WHITELIST for the wire payload, and it silently dropped both new
	// fields, so the server never saw them on any take regardless of what the inspector showed.
	// scenes-shared.js is an ES module coupled to the `sceneState` singleton (getCanvasForScreen
	// etc.), so — matching this repo's existing precedent for this exact function
	// (smoke-wo531-authoring-canvas-follows-target.test.js greps source rather than invoking it) —
	// this pins the row literal directly instead of fighting that coupling in a unit test.
	const fs = require('fs')
	const path = require('path')
	const src = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'components', 'scenes-shared.js'), 'utf8')
	const rowStart = src.indexOf('const row = {')
	const rowEnd = src.indexOf('\n\t\t}', rowStart)
	assert.ok(rowStart > 0 && rowEnd > rowStart, 'buildIncomingScenePayload row literal must exist at the expected shape')
	const row = src.slice(rowStart, rowEnd)
	assert.match(row, /trimInMs/, 'the take-wire row must carry trimInMs')
	assert.match(row, /trimOutMs/, 'the take-wire row must carry trimOutMs')
})
