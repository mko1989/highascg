'use strict'

/**
 * WO-766 — playlist workflow (owner 25.10):
 *  - Manual Next no longer loops every item (WO-224 T224.6 reversed): only the item's own Loop does;
 *  - ↘ "fade down when done": the item plays once, `LOADBG ch-l EMPTY MIX n AUTO` fades it at its end
 *    (n = half the channel rate unless the layer sets playlistFadeFrames), on PRV too; an auto list moves on after it;
 *  - the inspector's Next / row pick work when the look is not on program (preview step / start item).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { planPlaylistEdit } = require('../../src/engine/playlist-edit')
const { defaultFadeFrames, fadeOutFrames, scheduleFadeEndAdvance } = require('../../src/engine/playlist-fade-out')

function mockSelf(fps = 50) {
	const calls = []
	return {
		calls,
		self: {
			config: { screen_count: 1 },
			variables: { channel_1_framerate: String(fps), channel_2_framerate: String(fps) },
			log: () => {},
			amcp: {
				loadbg: async (ch, layer, clip, opts) => { calls.push({ cmd: 'LOADBG', ch, layer, clip, opts }) },
				play: async (ch, layer) => { calls.push({ cmd: 'PLAY', ch, layer }) },
				cgAdd: async () => {},
			},
		},
	}
}

const list = (over = {}) => ({
	layerNumber: 11,
	sourceMode: 'list',
	playlistAdvance: 'manual',
	playlistLoop: false,
	playlist: [
		{ id: 'a', type: 'media', value: 'kategoria/01.mp4' },
		{ id: 'b', type: 'media', value: 'kategoria/02.mp4', fadeOut: true },
		{ id: 'c', type: 'media', value: 'kategoria/03.mp4' },
	],
	...over,
})
const tick = () => new Promise((r) => setTimeout(r, 20))
const fades = (calls) => calls.filter((c) => c.cmd === 'LOADBG' && c.clip === 'EMPTY')

test('planner: ↘ and Loop exclude each other; a still cannot fade; fade frames 0 = default', () => {
	const L = { playlist: [{ value: 'a.mp4', loop: true }, { value: 'b.png', type: 'image' }] }
	assert.deepEqual(planPlaylistEdit(L, 'item', { index: 0, fadeOut: true }).patch.playlist[0], { value: 'a.mp4', loop: false, fadeOut: true })
	assert.match(planPlaylistEdit(L, 'item', { index: 1, fadeOut: true }).error, /length/)
	const faded = { playlist: [{ value: 'a.mp4', fadeOut: true }] }
	assert.deepEqual(planPlaylistEdit(faded, 'item', { index: 0, loop: true }).patch.playlist[0], { value: 'a.mp4', loop: true })
	assert.deepEqual(planPlaylistEdit(faded, 'settings', { fadeFrames: 0 }).patch, { playlistFadeFrames: null })
	assert.deepEqual(planPlaylistEdit(faded, 'settings', { fadeFrames: 999 }).patch, { playlistFadeFrames: 250 })
})

test('fade length: half the channel rate (50 → 25, 25 → 13), the layer value wins', () => {
	assert.equal(defaultFadeFrames(50), 25)
	assert.equal(defaultFadeFrames(25), 13)
	assert.equal(fadeOutFrames(mockSelf(50).self, 1, {}), 25)
	assert.equal(fadeOutFrames(mockSelf(50).self, 1, { playlistFadeFrames: 40 }), 40)
})

test('manual Next onto a plain clip: no LOOP, nothing armed after it', async () => {
	const { triggerPlaylistAdvance } = require('../../src/engine/scene-take-lbg-playlist')
	const { self, calls } = mockSelf()
	const layer = list()
	triggerPlaylistAdvance(self, 1, 11, { id: 'look', layers: [layer] }, layer, 2)
	await tick()
	const loads = calls.filter((c) => c.cmd === 'LOADBG')
	assert.equal(loads.length, 1, 'only the item itself — a manual list never preloads the next one')
	assert.equal(loads[0].opts.loop, false)
	assert.equal(Object.keys(self.playlistImageTimers || {}).length, 0)
})

test('manual Next onto a ↘ clip: PLAY then EMPTY MIX 25 AUTO', async () => {
	const { triggerPlaylistAdvance } = require('../../src/engine/scene-take-lbg-playlist')
	const { self, calls } = mockSelf()
	const layer = list()
	triggerPlaylistAdvance(self, 1, 11, { id: 'look', layers: [layer] }, layer, 1)
	await tick()
	assert.deepEqual(calls.map((c) => c.cmd), ['LOADBG', 'PLAY', 'LOADBG'])
	assert.equal(calls[0].opts.loop, false)
	assert.deepEqual(fades(calls)[0].opts, { auto: true, transition: 'MIX', duration: 25 })
})

test('take: a ↘ start item queues its fade on program and on a PRV recall; an auto list does not preload past it', async () => {
	const { setupLayerPlaylists } = require('../../src/engine/scene-take-lbg-playlist')
	const layer = list({ playlistAdvance: 'auto' })
	for (const ch of [1, 2]) {
		const { self, calls } = mockSelf()
		self.playlistStartIndices = { 'look-1-11': 1 }
		setupLayerPlaylists(self, ch, { id: 'look-1', layers: [layer] }, [{ layer, pLayer: 11 }])
		await tick()
		assert.equal(calls.length, 1, `ch${ch}: only the fade`)
		assert.equal(fades(calls).length, 1)
	}
})

test('auto after a ↘ item: one advance timer per item, by the remaining time', async () => {
	const self = {}
	let fired = 0
	assert.equal(scheduleFadeEndAdvance(self, '1:look-11', 1, 6.99, 7.0, () => fired++), true)
	assert.equal(scheduleFadeEndAdvance(self, '1:look-11', 1, 7.0, 7.0, () => fired++), false, 'stale OSC after the fade never re-arms')
	await new Promise((r) => setTimeout(r, 150))
	assert.equal(fired, 1)
})

test('take job: Manual Next with plain items loads without LOOP (was WO-224 T224.6)', async () => {
	const { buildTakeJobs } = require('../../src/engine/scene-take-lbg-jobs')
	const layer = list()
	const incoming = { id: 'look-3', layers: [layer] }
	const result = await buildTakeJobs({
		incomingSorted: incoming.layers,
		currentMap: new Map(),
		channel: 2,
		incoming,
		self: { config: { screen_count: 1 }, log: () => {} },
		amcp: {},
		phys: (n, bank) => n + (bank === 'b' ? 100 : 0),
		inactiveBank: 'b',
		activeBank: 'a',
		shouldRunBankCrossfade: false,
		forceCut: false,
		isMergeTransition: false,
		globalT: { type: 'CUT' },
		framerate: 50,
		skipLayerVisualEquality: false,
	})
	assert.equal(result.takeJobs[0].loadOpts.loop, false)
})

test('inspector: a pick while not on program sets the start item; Next falls back to the preview step', async () => {
	const { handlePick } = require('../../src/api/routes-playlist-edit')
	const ctx = { config: {}, log: () => {} }
	const r = await handlePick({ sceneId: 'look-x', layerNumber: 11, index: 4 }, ctx)
	assert.equal(r.status, 200)
	assert.equal(JSON.parse(r.body).startIndex, 4)
	assert.equal(ctx.playlistStartIndices['look-x-11'], 4)
	const src = fs.readFileSync(path.join(__dirname, '../../src/api/routes-playlist-edit.js'), 'utf8')
	assert.doesNotMatch(src, /This look is not on program/, 'Next is never refused off program any more')
	assert.match(src, /action: 'step_preview', sceneId, layerNumber, direction: 'next'/)
	const router = fs.readFileSync(path.join(__dirname, '../../src/api/router.js'), 'utf8')
	assert.match(router, /'\/api\/playlist\/edit\/pick'/)
})

test('describe rows carry ↘ (never on a still) and the default fade length', async () => {
	const { describeRows } = require('../../src/api/routes-playlist-edit')
	const rows = describeRows([{ value: 'a.mp4', fadeOut: true }, { value: 'b.png', type: 'image', fadeOut: true }], {})
	assert.deepEqual(rows.map((r) => r.fadeOut), [true, false])
})
