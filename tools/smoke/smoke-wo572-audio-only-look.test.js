'use strict'

/**
 * WO-572 Part C — audio-only looks: a look flagged `audioOnlyLook: true` plays on a fixed layer
 * (AUDIO_ONLY_LOOK_LAYER = 200) that the normal look take/diff/exit machinery never touches.
 *
 * Four independently-testable pieces:
 *  1. look-layer-ranges.js: layer 200 is excluded from isLookPhysicalLayer (so the normal
 *     look-clear sweep already leaves it alone by construction).
 *  2. audio-only-look.js: single-clip take, playlist advance (duration timer, not OSC), preview
 *     shows item 0 statically with no advance, and stop cancels a pending advance + clears Caspar.
 *  3. routes-scene-take-audio-only.js: take/stop update a SEPARATE live map (liveAudioOnlyLooksByChannel)
 *     and broadcast on 'scene.liveAudioOnly' — never liveSceneState / 'scene.live'.
 *  4. routes-scene-take.js: handleSceneTake branches to the audio-only path BEFORE the normal
 *     10-99 layer-numbering validation, so an audio-only scene's layer numbering is never rejected.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { isLookPhysicalLayer, AUDIO_ONLY_LOOK_LAYER } = require('../../src/engine/look-layer-ranges')
const {
	isAudioOnlyLook,
	resolveAudioOnlyLookLayer,
	takeAudioOnlyLook,
	stopAudioOnlyLook,
} = require('../../src/engine/audio-only-look')

function mockAmcp() {
	const log = []
	return {
		log,
		async play(ch, layer, clip, opts) {
			log.push({ cmd: 'PLAY', ch, layer, clip, opts })
		},
		async stop(ch, layer) {
			log.push({ cmd: 'STOP', ch, layer })
		},
		async clear(ch, layer) {
			log.push({ cmd: 'CLEAR', ch, layer })
		},
	}
}

test('AUDIO_ONLY_LOOK_LAYER (200) is excluded from the normal look-clear band', () => {
	assert.equal(AUDIO_ONLY_LOOK_LAYER, 200)
	assert.equal(isLookPhysicalLayer(200), false, 'layer 200 must never be swept by the normal look-clear machinery')
	assert.equal(isLookPhysicalLayer(199), true, 'sanity: bank B look ceiling is still 199')
	assert.equal(isLookPhysicalLayer(210), false, 'sanity: 210 is the timeline band, also excluded')
})

test('isAudioOnlyLook / resolveAudioOnlyLookLayer', () => {
	assert.equal(isAudioOnlyLook({ audioOnlyLook: true }), true)
	assert.equal(isAudioOnlyLook({ audioOnlyLook: false }), false)
	assert.equal(isAudioOnlyLook({}), false)
	assert.equal(isAudioOnlyLook(null), false)

	const scene = { audioOnlyLook: true, layers: [{ source: { type: 'media', value: 'a.wav' } }, { source: { type: 'media', value: 'ignored.wav' } }] }
	assert.equal(resolveAudioOnlyLookLayer(scene)?.source?.value, 'a.wav', 'only the first layer plays')
	assert.equal(resolveAudioOnlyLookLayer({ layers: [] }), null)
})

test('takeAudioOnlyLook: single clip plays once on the fixed layer with its loop flag', async () => {
	const amcp = mockAmcp()
	const scene = { id: 's1', layers: [{ source: { type: 'media', value: 'bed.wav' }, loop: true }] }
	await takeAudioOnlyLook({ amcp, channel: 5, scene, self: {} })
	assert.deepEqual(
		amcp.log.map((l) => ({ cmd: l.cmd, ch: l.ch, layer: l.layer })),
		[{ cmd: 'PLAY', ch: 5, layer: 200 }],
	)
	assert.equal(amcp.log[0].opts.loop, true)
	// resolveSceneClipForAmcp resolves through Caspar's CLS-id lookup (uppercased, extension
	// stripped) — same as every other engine caller (scene-take-lbg-jobs.js etc.), not a bug here.
	assert.match(amcp.log[0].clip, /bed/i)
})

test('takeAudioOnlyLook: no source on the first layer stops instead of PLAYing garbage', async () => {
	const amcp = mockAmcp()
	await takeAudioOnlyLook({ amcp, channel: 5, scene: { layers: [{ source: {} }] }, self: {} })
	assert.deepEqual(
		amcp.log.map((l) => l.cmd),
		['STOP', 'CLEAR'],
	)
})

test('takeAudioOnlyLook: playlist advances by its own duration timer, not the OSC-driven engine', async () => {
	const amcp = mockAmcp()
	const scene = {
		id: 's2',
		layers: [
			{
				sourceMode: 'list',
				playlist: [
					{ value: 'one.wav', duration: 0.02 },
					{ value: 'two.wav', duration: 0.02 },
				],
			},
		],
	}
	try {
		await takeAudioOnlyLook({ amcp, channel: 7, scene, self: {} })
		assert.equal(amcp.log.length, 1, 'item 0 plays immediately')
		assert.match(amcp.log[0].clip, /one/i)

		// A playlist advance loops forever by design (real on-air use: play until explicitly
		// stopped or replaced) — the try/finally below is load-bearing, not decoration: without it,
		// a failed assertion here would skip stopAudioOnlyLook and leave this recursive setTimeout
		// chain running forever, hanging the whole `node --test` process (this bit the author).
		await new Promise((r) => setTimeout(r, 100))
		assert.ok(amcp.log.length >= 2, 'advanced to item 1 after its duration elapsed')
		assert.match(amcp.log[1].clip, /two/i)
		assert.equal(amcp.log[1].ch, 7)
		assert.equal(amcp.log[1].layer, 200)
	} finally {
		await stopAudioOnlyLook({ amcp, channel: 7 })
	}
})

test('takeAudioOnlyLook: preview shows item 0 only — no advance timer even after the duration elapses', async () => {
	const amcp = mockAmcp()
	const scene = {
		id: 's3',
		layers: [{ sourceMode: 'list', playlist: [{ value: 'a.wav', duration: 0.01 }, { value: 'b.wav', duration: 0.01 }] }],
	}
	await takeAudioOnlyLook({ amcp, channel: 9, scene, self: {}, preview: true })
	await new Promise((r) => setTimeout(r, 50))
	assert.equal(amcp.log.length, 1, 'preview never auto-advances (matches normal look playlists: staged, static)')
})

test('stopAudioOnlyLook cancels a pending advance timer — no further PLAY after stop', async () => {
	const amcp = mockAmcp()
	const scene = {
		id: 's4',
		layers: [{ sourceMode: 'list', playlist: [{ value: 'x.wav', duration: 0.02 }, { value: 'y.wav', duration: 0.02 }] }],
	}
	await takeAudioOnlyLook({ amcp, channel: 11, scene, self: {} })
	await stopAudioOnlyLook({ amcp, channel: 11 })
	const countAfterStop = amcp.log.length
	await new Promise((r) => setTimeout(r, 60))
	assert.equal(amcp.log.length, countAfterStop, 'no further PLAY happened — the advance timer was actually cancelled')
	assert.deepEqual(amcp.log.slice(-2).map((l) => l.cmd), ['STOP', 'CLEAR'])
})

test('routes-scene-take-audio-only: take/stop touch a SEPARATE live map, never liveSceneState', async () => {
	process.env.NODE_TEST_CONTEXT = process.env.NODE_TEST_CONTEXT || `wo572-${process.pid}`
	const liveSceneState = require('../../src/state/live-scene-state')
	const liveAudioOnlyLookState = require('../../src/state/live-audio-only-look-state')
	const { handleAudioOnlyLookTake, handleAudioOnlyLookStop } = require('../../src/api/routes-scene-take-audio-only')

	const amcp = mockAmcp()
	const broadcasts = []
	const ctx = {
		amcp,
		config: { screen_count: 1, screen_1_mode: '1920x1080p25' }, // PGM-only: no preview bus configured
		_wsBroadcast: (type, payload) => broadcasts.push({ type, payload }),
	}
	const scene = { id: 'audio-look-1', audioOnlyLook: true, layers: [{ source: { type: 'media', value: 'jingle.wav' } }] }

	const beforeSceneLive = liveSceneState.getAll()
	const res = await handleAudioOnlyLookTake({}, ctx, 1, scene)
	assert.equal(res.status, 200)
	assert.deepEqual(liveSceneState.getAll(), beforeSceneLive, 'normal scene.live must be completely untouched')
	assert.equal(liveAudioOnlyLookState.getChannel(1)?.sceneId, 'audio-look-1')
	assert.ok(broadcasts.some((b) => b.payload?.path === 'scene.liveAudioOnly'), 'broadcasts on its own path')
	assert.ok(!broadcasts.some((b) => b.payload?.path === 'scene.live'), 'never broadcasts on scene.live')

	const stopRes = await handleAudioOnlyLookStop(JSON.stringify({ channel: 1 }), ctx)
	assert.equal(stopRes.status, 200)
	assert.equal(liveAudioOnlyLookState.getChannel(1), null)
	assert.deepEqual(amcp.log.slice(-2).map((l) => l.cmd), ['STOP', 'CLEAR'])
})

test('routes-scene-take-audio-only: preview requested but the channel has no preview bus -> 400, no AMCP sent', async () => {
	const { handleAudioOnlyLookTake } = require('../../src/api/routes-scene-take-audio-only')
	const amcp = mockAmcp()
	const ctx = { amcp, config: { screen_count: 1, screen_1_mode: '1920x1080p25' }, _wsBroadcast: () => {} }
	const scene = { id: 'audio-look-2', audioOnlyLook: true, layers: [{ source: { type: 'media', value: 'x.wav' } }] }
	// channel 99 is not this config's PGM (1) or PRV (2) — resolvePreviewChannel finds no bus for it.
	const res = await handleAudioOnlyLookTake({ target: 'preview' }, ctx, 99, scene)
	assert.equal(res.status, 400)
	assert.equal(amcp.log.length, 0, 'must not touch AMCP when rejecting the request')
})

test('handleSceneTake branches to the audio-only path BEFORE the 10-99 layer-numbering guard', async () => {
	const { handleSceneTake } = require('../../src/api/routes-scene-take')
	const liveAudioOnlyLookState = require('../../src/state/live-audio-only-look-state')
	const amcp = mockAmcp()
	const ctx = { amcp, config: { screen_count: 1, screen_1_mode: '1920x1080p25' }, _wsBroadcast: () => {} }
	// layerNumber 1 is WAY outside LOOK_LAYER_MIN..LOOK_LAYER_MAX (10-99) — a normal look with
	// this layer numbering would get the 400 "outside the look layer range" rejection.
	const body = {
		channel: 1,
		incomingScene: {
			id: 'audio-look-3',
			audioOnlyLook: true,
			layers: [{ layerNumber: 1, source: { type: 'media', value: 'ok.wav' } }],
		},
	}
	const res = await handleSceneTake(body, ctx)
	assert.equal(res.status, 200, `must not hit the layer-numbering guard, got: ${JSON.stringify(res.body)}`)
	assert.equal(liveAudioOnlyLookState.getChannel(1)?.sceneId, 'audio-look-3')
	await require('../../src/engine/audio-only-look').stopAudioOnlyLook({ amcp, channel: 1 })
	await liveAudioOnlyLookState.clearChannel(1)
})
