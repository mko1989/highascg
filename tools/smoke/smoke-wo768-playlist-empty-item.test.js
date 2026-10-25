'use strict'

/**
 * WO-768 — the empty playlist item (owner 25.10: "play a clip from the list, then manually transition to nothing on
 * that layer then play next clip so on"):
 *  - planner `add_empty {at?}`; the layer's `source` is never an empty item;
 *  - staging plays `EMPTY` with the playlist transition (Next → nothing, Next → the next clip);
 *  - auto lists: an empty item holds for its duration; a clip before one ends into it; stale OSC file fields after the
 *    swap never match back to the clip;
 *  - a take onto an empty item loads bare EMPTY; EMPTY is never a missing / project / replicated file.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

/* the OSC pass reads the live looks through live-scene-state — stub it (lazy require, so the cache swap is seen) */
const liveStatePath = require.resolve('../../src/state/live-scene-state')
const live = {}
require.cache[liveStatePath] = {
	id: liveStatePath,
	filename: liveStatePath,
	loaded: true,
	exports: { getAll: () => ({ ...live }), getChannel: (ch) => live[String(ch)] || null },
}

const { planPlaylistEdit } = require('../../src/engine/playlist-edit')
const pl = require('../../src/engine/scene-take-lbg-playlist')

function mockSelf() {
	const calls = []
	return {
		calls,
		self: {
			config: { screen_count: 1 },
			variables: { channel_1_framerate: '50' },
			programLayerBankByChannel: { 1: 'a' },
			log: () => {},
			amcp: {
				loadbg: async (ch, layer, clip, opts) => { calls.push({ cmd: 'LOADBG', ch, layer, clip, opts }) },
				play: async (ch, layer) => { calls.push({ cmd: 'PLAY', ch, layer }) },
				cgAdd: async () => {},
			},
		},
	}
}

const E = { id: 'e', type: 'empty', value: 'EMPTY', label: '— empty —', duration: 4 }
const list = (over = {}) => ({
	layerNumber: 11,
	sourceMode: 'list',
	playlistAdvance: 'manual',
	playlistLoop: false,
	playlistTransition: { type: 'MIX', duration: 12 },
	playlist: [{ id: 'a', type: 'media', value: 'kategoria/01.mp4' }, E, { id: 'c', type: 'media', value: 'kategoria/03.mp4' }],
	...over,
})
const tick = () => new Promise((r) => setTimeout(r, 20))
const clearTimers = (self) => Object.values(self.playlistImageTimers || {}).forEach(clearTimeout)

test('planner: add_empty at the end or at a row; an empty item is never the layer source', () => {
	const L = { playlist: [{ type: 'media', value: 'a.mp4' }, { type: 'media', value: 'b.mp4' }] }
	const end = planPlaylistEdit(L, 'add_empty', {}).patch.playlist
	assert.equal(end.length, 3)
	assert.deepEqual({ ...end[2], id: undefined }, { id: undefined, type: 'empty', value: 'EMPTY', label: '— empty —', duration: 20 })
	assert.equal(planPlaylistEdit(L, 'add_empty', { at: 1 }).patch.playlist[1].type, 'empty')
	assert.match(planPlaylistEdit(L, 'add_empty', { at: 9 }).error, /range/)
	assert.equal(planPlaylistEdit({ playlist: [] }, 'add_empty', {}).patch.source, undefined, 'no source from an empty item')

	const withE = { playlist: [E, { type: 'media', value: 'b.mp4' }] }
	assert.equal(planPlaylistEdit({ playlist: [E] }, 'add', { items: { value: 'x.mp4' } }).patch.source.value, 'x.mp4')
	assert.equal(planPlaylistEdit(withE, 'remove', { index: 1 }).patch.source, null)
	assert.equal(planPlaylistEdit({ playlist: [E, ...L.playlist] }, 'remove', { index: 1 }).patch.source.value, 'b.mp4')
	assert.equal(planPlaylistEdit(withE, 'move', { from: 1, to: 0 }).patch.source.value, 'b.mp4')
	assert.equal(planPlaylistEdit(withE, 'mode', { mode: 'single' }).patch.source.value, 'b.mp4')
	assert.match(planPlaylistEdit(withE, 'item', { index: 0, fadeOut: true }).error, /length/)
})

test('manual Next onto the empty item: LOADBG EMPTY with the playlist MIX, PLAY, nothing armed', async () => {
	const { self, calls } = mockSelf()
	const layer = list()
	pl.triggerPlaylistAdvance(self, 1, 11, { id: 'look', layers: [layer] }, layer, 1)
	await tick()
	assert.deepEqual(calls, [
		{ cmd: 'LOADBG', ch: 1, layer: 11, clip: 'EMPTY', opts: { loop: false, transition: 'MIX', duration: 12 } },
		{ cmd: 'PLAY', ch: 1, layer: 11 },
	])
	assert.equal(self.playlistActiveIndices['1:look-11'], 1)
	assert.equal(Object.keys(self.playlistImageTimers || {}).length, 0)
	calls.length = 0
	pl.triggerPlaylistAdvance(self, 1, 11, { id: 'look', layers: [layer] }, layer, 2)
	await tick()
	assert.equal(calls[0].clip, 'KATEGORIA/03', 'the next Next mixes the next clip in from nothing')
})

test('auto: the empty item holds for its duration; a clip before it preloads EMPTY AUTO', async () => {
	const { self, calls } = mockSelf()
	const layer = list({ playlistAdvance: 'auto' })
	pl.triggerPlaylistAdvance(self, 1, 11, { id: 'look', layers: [layer] }, layer, 1)
	await tick()
	assert.ok(self.playlistImageTimers['1:look-11'], 'timeless timer armed for the empty item')
	clearTimers(self)
	calls.length = 0
	pl.triggerPlaylistAdvance(self, 1, 11, { id: 'look', layers: [layer] }, layer, 0)
	await tick()
	assert.deepEqual(calls.at(-1), { cmd: 'LOADBG', ch: 1, layer: 11, clip: 'EMPTY', opts: { auto: true, loop: false, transition: 'MIX', duration: 12 } })
})

test('auto OSC: a clip before an empty item ends into it; stale file fields on the empty item change nothing', async () => {
	const { self, calls } = mockSelf()
	const layer = list({ playlistAdvance: 'auto' })
	const scene = { id: 'look', layers: [layer] }
	live['1'] = { sceneId: 'look', scene }
	self.playlistActiveIndices = { '1:look-11': 0 }
	const snap = { channels: { 1: { layers: { 11: { file: { name: 'kategoria/01.mp4', elapsed: 6.95, duration: 7 } } } } } }
	pl.handlePlaylistOscUpdate(self, snap)
	assert.equal(self.playlistFadeEndArmed['1:look-11'], 0, 'end of clip 0 armed')
	await new Promise((r) => setTimeout(r, 200))
	assert.equal(self.playlistActiveIndices['1:look-11'], 1, 'the empty item took over at the clip end')
	assert.ok(self.playlistImageTimers['1:look-11'], 'and holds for its duration')
	calls.length = 0
	pl.handlePlaylistOscUpdate(self, snap) // Caspar still reports 01.mp4 after the swap to color
	assert.equal(self.playlistActiveIndices['1:look-11'], 1)
	assert.equal(calls.length, 0)
	clearTimers(self)
	delete live['1']
})

test('take onto an empty start item: bare EMPTY, no LOOP / SEEK / AF', async () => {
	const { buildTakeJobs } = require('../../src/engine/scene-take-lbg-jobs')
	const layer = list({ playlistLoop: true, trimOutMs: 3000 })
	const incoming = { id: 'look-3', layers: [layer] }
	const result = await buildTakeJobs({
		incomingSorted: incoming.layers,
		currentMap: new Map(),
		channel: 2,
		incoming,
		self: { config: { screen_count: 1 }, log: () => {}, playlistStartIndices: { 'look-3-11': 1 } },
		amcp: {},
		phys: (n, bank) => n + (bank === 'b' ? 100 : 0),
		inactiveBank: 'b',
		activeBank: 'a',
		shouldRunBankCrossfade: false,
		forceCut: false,
		isMergeTransition: false,
		globalT: { type: 'MIX', duration: 25 },
		framerate: 50,
		skipLayerVisualEquality: false,
	})
	const job = result.takeJobs[0]
	assert.equal(job.clip, 'EMPTY')
	assert.equal(job.loadOpts.loop, false)
	for (const k of ['audioFilter', 'seek', 'in', 'length']) assert.equal(job.loadOpts[k], undefined, k)
	assert.equal(job.loadOpts.transition, 'MIX')
})

test('EMPTY is never a file: not missing, not project-rewritten, not replicated; rows say empty', () => {
	const { clipMissing } = require('../../src/media/media-exists')
	assert.equal(clipMissing('EMPTY', { ready: true, ids: new Set(), basenames: new Set() }), null)
	const { collectProjectAssetRefs } = require('../../src/replication/project-media-refs')
	assert.deepEqual(collectProjectAssetRefs({ scenes: [{ layers: [{ playlist: [E, { type: 'media', value: 'b.mp4' }] }] }] }).media, ['b.mp4'])
	const root = fs.readFileSync(path.join(__dirname, '../../src/media/project-media-root.js'), 'utf8')
	assert.match(root, /t === 'live' \|\| t === 'empty'\) return \/\/ WO-768/)
	const { describeRows } = require('../../src/api/routes-playlist-edit')
	const [row] = describeRows([E], {})
	assert.equal(row.empty, true)
	assert.equal(row.missing, false)
	assert.equal(row.timeless, true)
	assert.equal(row.name, '— empty —')
})

test('inspector: "+ Empty" inserts after the selected row', () => {
	const gd = fs.readFileSync(path.join(__dirname, '../../godot/client/features/live/playlist_section.gd'), 'utf8')
	assert.match(gd, /add_empty\.text = "\+ Empty"/)
	assert.match(gd, /_edit\("add_empty", \{"at": sel\.get_index\(\) \+ 1\} if sel != null else \{\}\)/)
})
