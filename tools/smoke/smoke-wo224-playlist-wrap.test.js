'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('module')

/**
 * WO-224: Playlist loop doesn't wrap; manual-advance mode has no Next trigger.
 *
 * T224.1: Failing sim first — drive handlePlaylistOscUpdate through a full wrap cycle.
 * Test a 3-item auto playlist (playlistLoop=true): item0 → item1 → item2 → item0 (WRAP).
 * Verify preload calls at each step, especially the wrap-back-to-item0.
 * Also test a 2-item variant.
 */

test('T224.1: 3-item auto playlist with playlistLoop=true wraps and preloads item0', async () => {
	// Clear any cached modules to ensure clean state
	delete require.cache[require.resolve('../../src/state/live-scene-state')]
	delete require.cache[require.resolve('../../src/engine/scene-take-lbg-playlist')]

	// Prepare to mock live-scene-state
	const sceneId = 'test-scene-3-item'
	const layerNumber = 10
	const playlist = [
		{ type: 'media', value: 'item0.mov', label: 'Item 0' },
		{ type: 'media', value: 'item1.mov', label: 'Item 1' },
		{ type: 'media', value: 'item2.mov', label: 'Item 2' },
	]

	let liveEntry = {
		sceneId,
		scene: {
			id: sceneId,
			layers: [
				{
					layerNumber,
					sourceMode: 'list',
					playlist,
					playlistAdvance: 'auto',
					playlistLoop: true,
					playlistTransition: { type: 'MIX', duration: 12 },
				},
			],
		},
	}

	// Mock resolveSceneClipForAmcp helper
	const mockSceneHelpers = {
		resolveSceneClipForAmcp: (value) => `resolved:${value}`,
	}

	// Stub live-scene-state module in cache
	require.cache[require.resolve('../../src/state/live-scene-state')] = {
		exports: { getAll: () => ({ '1': liveEntry }) },
	}

	// Stub the helper module in cache
	require.cache[require.resolve('../../src/engine/scene-take-lbg-helpers')] = {
		exports: mockSceneHelpers,
	}

	// Now require the module under test
	const { handlePlaylistOscUpdate } = require('../../src/engine/scene-take-lbg-playlist')

	// Track AMCP calls
	const amcpCalls = []

	const self = {
		config: { screen_count: 1 },
		log: (level, msg) => {
			console.log(`[${level}] ${msg}`)
		},
		programLayerBankByChannel: { '1': 'a' },
		playlistActiveIndices: {},
		playlistOscPrevPlayingPath: {},
		oscState: null,
		amcp: {
			loadbg: async (channel, pLayer, clip, opts) => {
				amcpCalls.push({ cmd: 'loadbg', channel, pLayer, clip, opts })
			},
			play: async (channel, pLayer) => {
				amcpCalls.push({ cmd: 'play', channel, pLayer })
			},
		},
	}

	// Initialize state as if setupLayerPlaylists was called and we've been through a few items
	/* todos27: runtime playlist state is channel-scoped (PGM/PRV of one look must not share). */
	const pKey = `1:${sceneId}-${layerNumber}`
	self.playlistActiveIndices[pKey] = 1  // Start at item1 (as if item1 just started playing)
	self.playlistOscPrevPlayingPath[pKey] = 'item1.mov'

	// Simulate item2 starts
	console.log('\n=== Step 1: item2 starts ===')
	let snapshot = {
		channels: {
			'1': {
				layers: {
					[layerNumber]: {
						file: {
							name: 'item2.mov',
							path: 'item2.mov',
							elapsed: 0.5,
							duration: 5.0,
						},
					},
				},
			},
		},
	}
	amcpCalls.length = 0
	handlePlaylistOscUpdate(self, snapshot)
	console.log(`AMCP calls after item2 start:`, amcpCalls.length)
	console.log(`Call details:`, JSON.stringify(amcpCalls, null, 2))
	assert.strictEqual(amcpCalls.length, 1, 'should preload item3... but wrap to item0')
	assert.deepStrictEqual(amcpCalls[0], {
		cmd: 'loadbg',
		channel: 1,
		pLayer: layerNumber,
		clip: 'resolved:item0.mov',
		opts: { auto: true, loop: false, transition: 'MIX', duration: 12 },
	}, 'should wrap to item0 after item2 (next would be 3 % 3 = 0)')
	assert.strictEqual(self.playlistActiveIndices[pKey], 2, 'activeIndex should be 2')

	// Simulate item0 starts again (lap 2) — THE CRITICAL WRAP TEST
	console.log('\n=== Step 2: item0 starts again (lap 2, CRITICAL WRAP TEST) ===')
	snapshot.channels['1'].layers[layerNumber].file.name = 'item0.mov'
	snapshot.channels['1'].layers[layerNumber].file.path = 'item0.mov'
	snapshot.channels['1'].layers[layerNumber].file.elapsed = 0.5
	amcpCalls.length = 0
	handlePlaylistOscUpdate(self, snapshot)
	console.log(`AMCP calls after item0 starts again:`, amcpCalls.length)
	console.log(`Call details:`, JSON.stringify(amcpCalls, null, 2))
	assert.strictEqual(amcpCalls.length, 1, 'CRITICAL: should preload item1 again on lap 2 (not stop or skip)')
	assert.deepStrictEqual(amcpCalls[0], {
		cmd: 'loadbg',
		channel: 1,
		pLayer: layerNumber,
		clip: 'resolved:item1.mov',
		opts: { auto: true, loop: false, transition: 'MIX', duration: 12 },
	}, 'item1 should be preloaded again on lap 2')
	assert.strictEqual(self.playlistActiveIndices[pKey], 0, 'activeIndex should wrap to 0')

	// Verify lap 3 also works
	console.log('\n=== Step 3: item1 starts on lap 3 (verify lap 3 works) ===')
	snapshot.channels['1'].layers[layerNumber].file.name = 'item1.mov'
	snapshot.channels['1'].layers[layerNumber].file.path = 'item1.mov'
	amcpCalls.length = 0
	handlePlaylistOscUpdate(self, snapshot)
	console.log(`AMCP calls after item1 starts on lap 3:`, amcpCalls.length)
	console.log(`Call details:`, JSON.stringify(amcpCalls, null, 2))
	assert.strictEqual(amcpCalls.length, 1, 'should preload item2 on lap 3')
	assert.strictEqual(amcpCalls[0].clip, 'resolved:item2.mov', 'should preload item2')
})

test('T224.2/3: POST /api/playlist/next validates inputs and resolves layer', async () => {
	const { handlePost } = require('../../src/api/routes-playlist')

	// Mock liveSceneState
	const mockSceneId = 'test-manual-scene'
	const mockLayerNum = 10
	const mockScene = {
		id: mockSceneId,
		layers: [
			{
				layerNumber: mockLayerNum,
				sourceMode: 'list',
				playlist: [
					{ type: 'media', value: 'a.mov' },
					{ type: 'media', value: 'b.mov' },
				],
				playlistAdvance: 'manual',
				playlistLoop: true,
				playlistTransition: { type: 'MIX', duration: 12 },
			},
		],
	}

	const mockLiveState = {
		getChannel: (ch) => ch === 1 ? { sceneId: mockSceneId, scene: mockScene } : null,
	}

	delete require.cache[require.resolve('../../src/state/live-scene-state')]
	require.cache[require.resolve('../../src/state/live-scene-state')] = {
		exports: mockLiveState,
	}

	delete require.cache[require.resolve('../../src/api/routes-playlist')]
	const playlistRoutes = require('../../src/api/routes-playlist')

	// Test 1: Missing channel
	let res = await playlistRoutes.handlePost('/api/playlist/next', { layerNumber: 10 }, {})
	assert.strictEqual(res.status, 400, 'should reject missing channel')
	assert.match(res.body, /Invalid channel/, 'error message mentions channel')

	// Test 2: Missing layerNumber
	res = await playlistRoutes.handlePost('/api/playlist/next', { channel: 1 }, {})
	assert.strictEqual(res.status, 400, 'should reject missing layerNumber')
	assert.match(res.body, /invalid layerNumber/i, 'error message mentions layerNumber')

	// Test 3: Non-existent scene
	res = await playlistRoutes.handlePost('/api/playlist/next', { channel: 99, layerNumber: 10 }, {})
	assert.strictEqual(res.status, 400, 'should reject non-existent channel')
	assert.match(res.body, /No scene active/, 'error message about no scene')

	// Test 4: Valid request at index 0, advance to 1
	const ctx = {
		programLayerBankByChannel: { '1': 'a' },
		playlistActiveIndices: { [`${mockSceneId}-${mockLayerNum}`]: 0 },
		amcp: {
			loadbg: async () => {},
			play: async () => {},
		},
		log: () => {},
	}
	res = await playlistRoutes.handlePost('/api/playlist/next', { channel: 1, layerNumber: mockLayerNum }, ctx)
	assert.strictEqual(res.status, 200, 'should succeed with valid request')
	const body = JSON.parse(res.body)
	assert.strictEqual(body.ok, true, 'response should be ok')
	assert.strictEqual(body.currentIndex, 0, 'should report current index as 0')
	assert.strictEqual(body.nextIndex, 1, 'should report next index as 1')

	// Test 5: At end without loop should fail
	const noLoopScene = {
		id: mockSceneId,
		layers: [
			{
				layerNumber: mockLayerNum,
				sourceMode: 'list',
				playlist: [
					{ type: 'media', value: 'a.mov' },
					{ type: 'media', value: 'b.mov' },
				],
				playlistAdvance: 'manual',
				playlistLoop: false,  // No loop!
				playlistTransition: { type: 'MIX', duration: 12 },
			},
		],
	}

	const mockLiveStateNoLoop = {
		getChannel: (ch) => ch === 1 ? { sceneId: mockSceneId, scene: noLoopScene } : null,
	}

	delete require.cache[require.resolve('../../src/state/live-scene-state')]
	require.cache[require.resolve('../../src/state/live-scene-state')] = {
		exports: mockLiveStateNoLoop,
	}

	delete require.cache[require.resolve('../../src/api/routes-playlist')]
	const playlistRoutesNoLoop = require('../../src/api/routes-playlist')

	const ctxAtEnd = {
		programLayerBankByChannel: { '1': 'a' },
		playlistActiveIndices: { [`1:${mockSceneId}-${mockLayerNum}`]: 1 },  // At last item (channel-scoped key)
		amcp: { loadbg: async () => {}, play: async () => {} },
		log: () => {},
	}
	res = await playlistRoutesNoLoop.handlePost('/api/playlist/next', { channel: 1, layerNumber: mockLayerNum }, ctxAtEnd)
	assert.strictEqual(res.status, 400, 'should reject when at end without loop')
	assert.match(res.body, /end of playlist/i, 'error mentions end of playlist')
})

test('T224.1: 2-item auto playlist with playlistLoop=true wraps correctly', async () => {
	// Clear any cached modules to ensure clean state
	delete require.cache[require.resolve('../../src/state/live-scene-state')]
	delete require.cache[require.resolve('../../src/engine/scene-take-lbg-playlist')]

	const sceneId = 'test-scene-2-item'
	const layerNumber = 10
	const playlist = [
		{ type: 'media', value: 'item0.mov', label: 'Item 0' },
		{ type: 'media', value: 'item1.mov', label: 'Item 1' },
	]

	let liveEntry = {
		sceneId,
		scene: {
			id: sceneId,
			layers: [
				{
					layerNumber,
					sourceMode: 'list',
					playlist,
					playlistAdvance: 'auto',
					playlistLoop: true,
					playlistTransition: { type: 'MIX', duration: 12 },
				},
			],
		},
	}

	const mockSceneHelpers = {
		resolveSceneClipForAmcp: (value) => `resolved:${value}`,
	}

	// Stub live-scene-state module in cache
	require.cache[require.resolve('../../src/state/live-scene-state')] = {
		exports: { getAll: () => ({ '1': liveEntry }) },
	}

	// Stub the helper module in cache
	require.cache[require.resolve('../../src/engine/scene-take-lbg-helpers')] = {
		exports: mockSceneHelpers,
	}

	const { handlePlaylistOscUpdate } = require('../../src/engine/scene-take-lbg-playlist')

	const amcpCalls = []

	const self = {
		config: { screen_count: 1 },
		log: (level, msg) => {
			console.log(`[${level}] ${msg}`)
		},
		programLayerBankByChannel: { '1': 'a' },
		playlistActiveIndices: {},
		playlistOscPrevPlayingPath: {},
		oscState: null,
		amcp: {
			loadbg: async (channel, pLayer, clip, opts) => {
				amcpCalls.push({ cmd: 'loadbg', channel, pLayer, clip, opts })
			},
			play: async (channel, pLayer) => {
				amcpCalls.push({ cmd: 'play', channel, pLayer })
			},
		},
	}

	// Initialize as if we're already at item1
	/* todos27: runtime playlist state is channel-scoped (PGM/PRV of one look must not share). */
	const pKey = `1:${sceneId}-${layerNumber}`
	self.playlistActiveIndices[pKey] = 1
	self.playlistOscPrevPlayingPath[pKey] = 'item1.mov'

	// item0 starts (wrap from item1 to item0)
	console.log('\n=== 2-item test: item0 starts (wrap from item1) ===')
	let snapshot = {
		channels: {
			'1': {
				layers: {
					[layerNumber]: {
						file: {
							name: 'item0.mov',
							path: 'item0.mov',
							elapsed: 0.5,
							duration: 5.0,
						},
					},
				},
			},
		},
	}
	amcpCalls.length = 0
	handlePlaylistOscUpdate(self, snapshot)
	console.log(`AMCP calls after item0 starts (wrap):`, amcpCalls.length)
	console.log(`Call details:`, JSON.stringify(amcpCalls, null, 2))
	assert.strictEqual(amcpCalls.length, 1, 'should preload item1 after wrap')
	assert.strictEqual(amcpCalls[0].clip, 'resolved:item1.mov', 'should preload item1')
	assert.strictEqual(self.playlistActiveIndices[pKey], 0, 'activeIndex should be 0')

	// item1 starts again (lap 2)
	console.log('=== 2-item test: item1 starts on lap 2 ===')
	snapshot.channels['1'].layers[layerNumber].file.name = 'item1.mov'
	snapshot.channels['1'].layers[layerNumber].file.path = 'item1.mov'
	amcpCalls.length = 0
	handlePlaylistOscUpdate(self, snapshot)
	console.log(`AMCP calls after item1 starts again:`, amcpCalls.length)
	assert.strictEqual(amcpCalls.length, 1, 'should preload item0 again on lap 2')
	assert.strictEqual(amcpCalls[0].clip, 'resolved:item0.mov', 'should wrap to item0 again')
	assert.strictEqual(self.playlistActiveIndices[pKey], 1, 'activeIndex should be 1 again')
})

/* Owner 27.07: a PNG dropped between two movies must get its timer and advance. */
test('image between videos: OSC promotion arms the duration timer and it advances', async () => {
	delete require.cache[require.resolve('../../src/state/live-scene-state')]
	require.cache[require.resolve('../../src/state/live-scene-state')] = {
		exports: { getChannel: (ch) => (ch === 1 ? { scene: { id: 'sc-img', layers: [] } } : null), getAll: () => ({}) },
	}
	delete require.cache[require.resolve('../../src/engine/scene-take-lbg-playlist')]
	const eng = require('../../src/engine/scene-take-lbg-playlist')
	const calls = []
	const scene = { id: 'sc-img', layers: [] }
	const layer = {
		layerNumber: 10,
		sourceMode: 'list',
		playlistAdvance: 'auto',
		playlistLoop: true,
		playlist: [
			{ value: 'v1.mov', type: 'media' },
			{ value: 'pic.png', type: 'image', duration: 0.02 },
			{ value: 'v2.mov', type: 'media' },
		],
	}
	scene.layers.push(layer)
	require.cache[require.resolve('../../src/state/live-scene-state')].exports.getChannel = () => ({ scene })
	const self = {
		config: {},
		playlistActiveIndices: { '1:sc-img-10': 1 },
		playlistImageTimers: {},
		playlistOscPrevPlayingPath: {},
		amcp: {
			loadbg: async (...a) => calls.push(['loadbg', ...a]),
			play: async (...a) => calls.push(['play', ...a]),
			cgAdd: async (...a) => calls.push(['cgAdd', ...a]),
		},
		log: () => {},
	}
	// The png just got AUTO-promoted (OSC path) — arm branch requires timer absent + timeless.
	eng.__test_schedulePlaylistImageTimer?.(self, 1, 10, scene, layer, 1)
	if (!eng.__test_schedulePlaylistImageTimer) {
		// no test export — reach it via the public trigger (stages item 1 then arms its timer)
		eng.triggerPlaylistAdvance(self, 1, 10, scene, layer, 1)
	}
	await new Promise((r) => setTimeout(r, 120))
	const played = calls.filter((c) => c[0] === 'loadbg' || c[0] === 'play')
	assert.ok(self.playlistActiveIndices['1:sc-img-10'] === 2 || played.some((c) => String(c[3] ?? c[2]).includes('v2')),
		`png timer must advance to v2 (calls: ${JSON.stringify(calls)})`)
})
