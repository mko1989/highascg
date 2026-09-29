'use strict'

/**
 * WO-581 smoke — a playlist look taken to PGM starts on the item the operator set (PRV step or
 * the Playlists panel), never item 0:
 *  - /api/playlist/state lists a PRV-only recall as NOT live (+ previewChannel), so the panel's
 *    item pick is a set_start, not a `goto` onto the PRV bus; a PGM recall still wins as live
 *  - set_start restages the pick on PRV (schedule-free, program untouched)
 *  - buildTakeJobs loads the start item itself (auto + manual)
 *  - setupLayerPlaylists arms the chain from the start item — no delayed hop from item 0
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const LAYER = {
	layerNumber: 10,
	sourceMode: 'list',
	playlistAdvance: 'auto',
	playlistLoop: true,
	playlistTransition: { type: 'CUT', duration: 0 },
	playlist: [
		{ type: 'media', value: 'a.mov' },
		{ type: 'media', value: 'b.mov' },
		{ type: 'image', value: 'c.png', duration: 7 },
	],
}
const SCENE = { id: 'sc-581', name: 'Look 581', layers: [LAYER] }

function mockModule(rel, exportsObj) {
	const key = require.resolve(rel)
	require(rel)
	require.cache[key].exports = exportsObj
}

function makeCtx(calls) {
	return {
		config: {},
		playlistStartIndices: {},
		playlistActiveIndices: {},
		playlistImageTimers: {},
		amcp: {
			loadbg: async (ch, layer, clip, opts) => calls.push({ cmd: 'LOADBG', ch, layer, clip, opts }),
			play: async (ch, layer) => calls.push({ cmd: 'PLAY', ch, layer }),
			cgAdd: async () => {},
		},
		log: () => {},
	}
}

function loadRoutes(liveByChannel) {
	mockModule('../../src/engine/project-scenes-load', { loadProjectScenes: () => ({ scenes: [SCENE] }) })
	mockModule('../../src/state/live-scene-state', {
		getAll: () => liveByChannel,
		getChannel: (ch) => liveByChannel[ch] || null,
	})
	const clearKey = require.resolve('../../src/engine/caspar-channel-clear')
	require('../../src/engine/caspar-channel-clear')
	require.cache[clearKey].exports = {
		...require.cache[clearKey].exports,
		isPreviewCasparChannel: (_cfg, ch) => Number(ch) === 2,
	}
	delete require.cache[require.resolve('../../src/api/routes-playlist')]
	return require('../../src/api/routes-playlist')
}

test('WO-581: a PRV-only recall lists as not live; set_start restages PRV only', async () => {
	const { handleStateGet, handlePost } = loadRoutes({ 2: { sceneId: SCENE.id, scene: SCENE } })
	const calls = []
	const ctx = makeCtx(calls)

	let list = JSON.parse(handleStateGet(ctx).body).playlists
	assert.equal(list.length, 1)
	assert.equal(list[0].live, false, 'a preview recall is not live (playlists run on PGM only)')
	assert.equal(list[0].channel, null)
	assert.equal(list[0].previewChannel, 2)

	const res = await handlePost('/api/playlist/control', { action: 'set_start', sceneId: SCENE.id, layerNumber: 10, index: 1 }, ctx)
	assert.equal(res.status, 200)
	const body = JSON.parse(res.body)
	assert.equal(body.startIndex, 1)
	assert.deepEqual(body.previewChannels, [2])
	assert.equal(ctx.playlistStartIndices[`${SCENE.id}-10`], 1)
	assert.ok(calls.length > 0 && calls.every((c) => c.ch === 2), 'restaged on PRV ch2 only')
	assert.match(calls.find((c) => c.cmd === 'LOADBG').clip, /b/i)
	assert.equal(Object.keys(ctx.playlistImageTimers).length, 0, 'no timers on PRV')

	list = JSON.parse(handleStateGet(ctx).body).playlists
	assert.equal(list[0].activeIndex, 1, 'panel shows the set item')
})

test('WO-581: the same look on PGM and PRV lists live on the PGM channel', () => {
	const { handleStateGet } = loadRoutes({
		2: { sceneId: SCENE.id, scene: SCENE },
		1: { sceneId: SCENE.id, scene: SCENE },
	})
	const list = JSON.parse(handleStateGet(makeCtx([])).body).playlists
	assert.equal(list.length, 1)
	assert.equal(list[0].live, true)
	assert.equal(list[0].channel, 1)
})

async function takeClip(layer, startIdx) {
	const { buildTakeJobs } = require('../../src/engine/scene-take-lbg-jobs')
	const incoming = { id: SCENE.id, layers: [layer] }
	const self = { config: { screen_count: 1 }, log: () => {}, playlistStartIndices: { [`${SCENE.id}-10`]: startIdx } }
	const result = await buildTakeJobs({
		incomingSorted: incoming.layers,
		currentMap: new Map(),
		channel: 1,
		incoming,
		self,
		amcp: {},
		phys: (n, bank) => n + (bank === 'b' ? 100 : 0),
		inactiveBank: 'b',
		activeBank: 'a',
		shouldRunBankCrossfade: false,
		forceCut: false,
		isMergeTransition: false,
		globalT: { type: 'CUT' },
		framerate: 25,
		skipLayerVisualEquality: false,
	})
	return result.takeJobs[0].clip
}

test('WO-581: the take job loads the start item (auto and manual), out-of-range falls back to 0', async () => {
	assert.match(await takeClip(LAYER, 1), /b/i)
	assert.match(await takeClip({ ...LAYER, playlistAdvance: 'manual' }, 2), /c/i)
	assert.match(await takeClip(LAYER, 9), /a/i)
})

test('WO-581: setupLayerPlaylists arms from the start item with no delayed hop', async () => {
	const { setupLayerPlaylists } = require('../../src/engine/scene-take-lbg-playlist')
	const pKey = `1:${SCENE.id}-10`

	// video start item → preload the item AFTER it, index parked on the start item
	let calls = []
	let ctx = makeCtx(calls)
	ctx.playlistStartIndices[`${SCENE.id}-10`] = 1
	setupLayerPlaylists(ctx, 1, SCENE, [{ layer: LAYER, pLayer: 10 }])
	await new Promise((r) => setTimeout(r, 500))
	assert.equal(ctx.playlistActiveIndices[pKey], 1)
	assert.equal(calls.length, 1, 'one AUTO preload — no post-take LOADBG/PLAY hop')
	assert.equal(calls[0].opts.auto, true)
	assert.match(calls[0].clip, /c/i)

	// timeless start item → its duration timer armed, nothing loaded
	calls = []
	ctx = makeCtx(calls)
	ctx.playlistStartIndices[`${SCENE.id}-10`] = 2
	setupLayerPlaylists(ctx, 1, SCENE, [{ layer: LAYER, pLayer: 10 }])
	assert.equal(ctx.playlistActiveIndices[pKey], 2)
	assert.ok(ctx.playlistImageTimers[pKey], 'timer armed for the start item')
	clearTimeout(ctx.playlistImageTimers[pKey])
	assert.equal(calls.length, 0)

	// manual → index parked on the start item so Next goes to start+1
	ctx = makeCtx([])
	ctx.playlistStartIndices[`${SCENE.id}-10`] = 2
	setupLayerPlaylists(ctx, 1, SCENE, [{ layer: { ...LAYER, playlistAdvance: 'manual' }, pLayer: 10 }])
	assert.equal(ctx.playlistActiveIndices[pKey], 2)
})
