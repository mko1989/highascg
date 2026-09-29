'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

/**
 * Per-item loop tick (playlist workflow): "play clip 1, then go to clip 2 and loop it".
 * A looped item is loaded with LOOP and holds the list — no AUTO preload of the item after it,
 * no timeless timer — until the operator presses Next.
 */

function mockSelf() {
	const calls = []
	return {
		calls,
		self: {
			config: {},
			log: () => {},
			amcp: {
				loadbg: async (ch, layer, clip, opts) => { calls.push({ cmd: 'LOADBG', ch, layer, clip, opts }) },
				play: async (ch, layer) => { calls.push({ cmd: 'PLAY', ch, layer }) },
				cgAdd: async () => {},
			},
		},
	}
}

const layer = {
	layerNumber: 10,
	sourceMode: 'list',
	playlistAdvance: 'auto',
	playlist: [
		{ id: 'a', type: 'media', value: 'intro.mov' },
		{ id: 'b', type: 'media', value: 'loop.mov', loop: true },
		{ id: 'c', type: 'media', value: 'outro.mov' },
	],
}
const scene = { id: 'look-1', layers: [layer] }

test('take of clip 1 preloads the looped clip 2 with AUTO + LOOP', () => {
	const { setupLayerPlaylists } = require('../../src/engine/scene-take-lbg-playlist')
	const { self, calls } = mockSelf()
	setupLayerPlaylists(self, 1, scene, [{ layer, pLayer: 10 }])
	assert.equal(calls.length, 1)
	assert.equal(calls[0].cmd, 'LOADBG')
	assert.match(calls[0].clip, /loop/i)
	assert.equal(calls[0].opts.auto, true)
	assert.equal(calls[0].opts.loop, true)
})

test('advancing onto a looped item stages it with LOOP and arms nothing after it', async () => {
	const { triggerPlaylistAdvance } = require('../../src/engine/scene-take-lbg-playlist')
	const { self, calls } = mockSelf()
	triggerPlaylistAdvance(self, 1, 10, scene, layer, 1)
	await new Promise((r) => setTimeout(r, 20))
	const loads = calls.filter((c) => c.cmd === 'LOADBG')
	assert.equal(loads.length, 1, 'only the looped item itself — no preload of outro')
	assert.equal(loads[0].opts.loop, true)
	assert.equal(Object.keys(self.playlistImageTimers || {}).length, 0)
})

test('a looped timeless item never arms its duration timer', async () => {
	const { triggerPlaylistAdvance } = require('../../src/engine/scene-take-lbg-playlist')
	const { self } = mockSelf()
	const gfx = { ...layer, playlist: [{ id: 'a', type: 'image', value: 'still.png', loop: true, duration: 1 }, layer.playlist[2]] }
	triggerPlaylistAdvance(self, 1, 10, { ...scene, layers: [gfx] }, gfx, 0)
	await new Promise((r) => setTimeout(r, 20))
	assert.equal(Object.keys(self.playlistImageTimers || {}).length, 0)
})

test('take job loads a looped first item with LOOP on a multi-item auto list', async () => {
	const { buildTakeJobs } = require('../../src/engine/scene-take-lbg-jobs')
	const first = { ...layer, playlist: [{ ...layer.playlist[0], loop: true }, layer.playlist[2]] }
	const incoming = { id: 'look-2', layers: [first] }
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
		framerate: 25,
		skipLayerVisualEquality: false,
	})
	assert.equal(result.takeJobs[0].loadOpts.loop, true)
})
