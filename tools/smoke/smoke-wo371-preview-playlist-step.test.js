'use strict'

/**
 * WO-371 smoke — ⏮/⏭ step a NOT-live playlist's preview render:
 *  - step_preview moves the sticky start index (wrapping both directions)
 *  - when the look is staged on a PREVIEW channel, the item is re-staged there (preview channel only)
 *  - WO-968 (owner 05.11 reversed option C → option B): the PRV list then RUNS ON from the stepped item —
 *    a manual list still arms nothing, an auto list arms its chain on the PRV channel (was: "sits still")
 *  - a look not staged anywhere still steps its start index, with zero AMCP
 *  - client panel enables ⏮/⏭ for non-live playlists, ▶ stays live-only
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const SCENE = {
	id: 'sc-prv',
	name: 'PRV scene',
	layers: [
		{
			layerNumber: 10,
			sourceMode: 'list',
			playlist: [
				{ type: 'media', value: 'a.mov' },
				{ type: 'media', value: 'b.mov' },
				{ type: 'media', value: 'c.mov' },
			],
			playlistAdvance: 'manual',
			playlistLoop: true,
			playlistTransition: { type: 'CUT', duration: 0 },
		},
	],
}

function mockModule(rel, exportsObj) {
	const key = require.resolve(rel)
	require(rel) // ensure a cache entry exists before replacing it
	require.cache[key].exports = exportsObj
}

function makeCtx(amcpCalls) {
	return {
		config: {},
		playlistStartIndices: {},
		playlistActiveIndices: {},
		playlistImageTimers: {},
		amcp: {
			loadbg: async (...a) => amcpCalls.push(['loadbg', ...a]),
			play: async (...a) => amcpCalls.push(['play', ...a]),
			cgAdd: async (...a) => amcpCalls.push(['cgAdd', ...a]),
		},
		log: () => {},
	}
}

test('WO-371: step_preview wraps the start index and stages on the preview channel only', async () => {
	mockModule('../../src/engine/project-scenes-load', { loadProjectScenes: () => ({ scenes: [SCENE] }) })
	mockModule('../../src/state/live-scene-state', {
		getAll: () => ({ 7: { sceneId: SCENE.id, scene: SCENE } }),
		getChannel: () => null,
	})
	const clear = require('../../src/engine/caspar-channel-clear')
	require.cache[require.resolve('../../src/engine/caspar-channel-clear')].exports = {
		...clear,
		isPreviewCasparChannel: (_cfg, ch) => Number(ch) === 7,
	}
	delete require.cache[require.resolve('../../src/api/routes-playlist')]
	const { handlePost } = require('../../src/api/routes-playlist')

	const amcpCalls = []
	const ctx = makeCtx(amcpCalls)

	// next from default 0 → 1, staged on preview channel 7
	let res = await handlePost('/api/playlist/control', { action: 'step_preview', sceneId: SCENE.id, layerNumber: 10, direction: 'next' }, ctx)
	assert.equal(res.status, 200)
	let body = JSON.parse(res.body)
	assert.equal(body.startIndex, 1)
	assert.deepEqual(body.previewChannels, [7])
	assert.ok(amcpCalls.some((c) => c[0] === 'loadbg' && c[1] === 7 && /b/i.test(String(c[3]))), `staged item 1 on ch7 (${JSON.stringify(amcpCalls)})`)
	assert.equal(Object.keys(ctx.playlistImageTimers).length, 0, 'a MANUAL list arms no timer on PRV (manual advance honoured, WO-968)')
	assert.ok(amcpCalls.every((c) => c[1] === 7), 'every AMCP line went to preview ch7')

	// prev twice wraps 1 → 0 → 2
	await handlePost('/api/playlist/control', { action: 'step_preview', sceneId: SCENE.id, layerNumber: 10, direction: 'prev' }, ctx)
	res = await handlePost('/api/playlist/control', { action: 'step_preview', sceneId: SCENE.id, layerNumber: 10, direction: 'prev' }, ctx)
	body = JSON.parse(res.body)
	assert.equal(body.startIndex, 2, 'prev wraps to the last item')

	// unknown look → 400
	res = await handlePost('/api/playlist/control', { action: 'step_preview', sceneId: 'nope', layerNumber: 10, direction: 'next' }, ctx)
	assert.equal(res.status, 400)
})

test('WO-371: stepping a look staged nowhere moves the index with zero AMCP', async () => {
	mockModule('../../src/engine/project-scenes-load', { loadProjectScenes: () => ({ scenes: [SCENE] }) })
	mockModule('../../src/state/live-scene-state', { getAll: () => ({}), getChannel: () => null })
	delete require.cache[require.resolve('../../src/api/routes-playlist')]
	const { handlePost } = require('../../src/api/routes-playlist')

	const amcpCalls = []
	const ctx = makeCtx(amcpCalls)
	const res = await handlePost('/api/playlist/control', { action: 'step_preview', sceneId: SCENE.id, layerNumber: 10, direction: 'next' }, ctx)
	assert.equal(JSON.parse(res.body).startIndex, 1)
	assert.equal(amcpCalls.length, 0, 'no AMCP anywhere — in particular never to a program channel')
})

test('WO-968: stepping an AUTO list on PRV runs it on from the stepped item — on the PRV channel only', async () => {
	const AUTO = { ...SCENE, layers: [{ ...SCENE.layers[0], playlistAdvance: 'auto', playlist: [{ type: 'media', value: 'a.mov' }, { type: 'image', value: 'b.png', duration: 30 }, { type: 'media', value: 'c.mov' }] }] }
	mockModule('../../src/engine/project-scenes-load', { loadProjectScenes: () => ({ scenes: [AUTO] }) })
	mockModule('../../src/state/live-scene-state', { getAll: () => ({ 7: { sceneId: AUTO.id, scene: AUTO } }), getChannel: (ch) => (Number(ch) === 7 ? { sceneId: AUTO.id, scene: AUTO } : null) })
	delete require.cache[require.resolve('../../src/api/routes-playlist')]
	const { handlePost } = require('../../src/api/routes-playlist')
	const amcpCalls = []
	const ctx = makeCtx(amcpCalls)
	const res = await handlePost('/api/playlist/control', { action: 'step_preview', sceneId: AUTO.id, layerNumber: 10, direction: 'next' }, ctx)
	assert.equal(JSON.parse(res.body).startIndex, 1)
	const key = `7:${AUTO.id}-10`
	assert.ok(ctx.playlistImageTimers[key], 'the still stepped onto arms ITS duration timer, keyed to the PRV channel')
	assert.deepEqual(Object.keys(ctx.playlistImageTimers), [key], 'no other channel got a timer')
	assert.equal(ctx.playlistActiveIndices[key], 1)
	assert.ok(amcpCalls.length > 0 && amcpCalls.every((c) => c[1] === 7), 'never a program channel')
	clearTimeout(ctx.playlistImageTimers[key])
})

test('WO-371: source pins — the PRV restage path and the client enable-condition', () => {
	const routes = read('src/api/routes-playlist.js')
	const stepBlock = routes.slice(routes.indexOf("action === 'step_preview'"))
	const block = stepBlock.slice(0, stepBlock.indexOf('\n\t}'))
	/* WO-581: the PRV restage moved into restagePreviewChannels (shared with set_start) —
	 * step_preview must call it, and the helper carries the pins. */
	assert.match(block, /restagePreviewChannels\(/, 'step_preview restages via the shared PRV helper')
	assert.doesNotMatch(block, /triggerPlaylistAdvance\(|stagePlaylistItem\(/, 'step_preview reaches a channel only through the PRV-only helper')
	const helperFn = routes.slice(routes.indexOf('async function restagePreviewChannels'))
	const helper = helperFn.slice(0, helperFn.indexOf('\n}'))
	/* WO-968 (owner 05.11, option B): was "PRV restage must never arm the advance chain" — PRV now plays on. */
	assert.match(helper, /triggerPlaylistAdvance\(/, 'PRV restage stages the item AND runs the PRV list on from it')
	assert.match(helper, /isPreviewCasparChannel/, 'only preview channels are restaged')

	const engine = read('src/engine/scene-take-lbg-playlist.js')
	const stageFn = engine.slice(engine.indexOf('function stagePlaylistItem'), engine.indexOf('function triggerPlaylistAdvance'))
	assert.doesNotMatch(stageFn, /schedulePlaylistImageTimer|queueNextPlaylistItem/, 'stagePlaylistItem schedules nothing')

	const panel = read('client/components/playlist-control-panel.js')
	assert.match(panel, /b\.disabled = id === 'plp-play' \? !p\?\.live : !p/, '⏮/⏭ enabled for non-live, ▶ live-only')
	assert.match(panel, /action: 'step_preview'/, 'panel steps non-live playlists through the preview')
})
