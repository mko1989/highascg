'use strict'

/**
 * WO-968 (owner 05.11: "when playlist is being edited on prv it should play the playlist items, not just the
 * first") — WO-371 option B: a playlist look recalled on PRV runs its list like PGM does.
 *  - a PRV recall plays every item and loops (or stops at the end with loop off); every AMCP line goes to PRV;
 *  - PGM and PRV of one look run independent chains: different progress at the same time, a PGM take wipes
 *    only the PGM channel's state, PRV's advance never moves the sticky start item a PGM take starts on;
 *  - the OSC pass advances a PRV clip list (AUTO preload of the next item on PRV); a stale frame naming the clip
 *    the bank-less PRV layer held before the stage is not an advance;
 *  - a still's timer hops through the list as it is NOW (an edit patched into the live scene); a clip → still hop
 *    reads the still from file/path (the image producer sends no file/name, the clip's stays behind);
 *  - a jump off a still onto a clip clears the still's timer (it used to hop the list a second time);
 *  - the inspector marks the item PRV plays when the look is only on PRV; Shader Live resolves PRV's item.
 * Default channel map: PGM 1, PRV 2.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const liveSceneState = require('../../src/state/live-scene-state')
let LIVE = {}
liveSceneState.getAll = () => LIVE
liveSceneState.getChannel = (ch) => LIVE[ch] || null

const engine = require('../../src/engine/scene-take-lbg-playlist')
const { resolvePlaylistStartIndex } = require('../../src/engine/scene-take-playlist-start')

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const still = (value, duration) => ({ type: 'image', value, duration })
const look = (id, layer) => ({ id, name: id, layers: [{ layerNumber: 10, sourceMode: 'list', playlistAdvance: 'auto', playlistLoop: true, playlistTransition: { type: 'CUT', duration: 0 }, ...layer }] })

function mockSelf() {
	const calls = []
	return {
		calls,
		self: {
			config: {},
			log: () => {},
			programLayerBankByChannel: { 1: 'a', 2: 'a' },
			playlistStartIndices: {},
			playlistActiveIndices: {},
			playlistImageTimers: {},
			amcp: {
				loadbg: async (ch, layer, clip, opts) => calls.push({ cmd: 'LOADBG', ch, layer, clip: String(clip), opts }),
				play: async (ch, layer) => calls.push({ cmd: 'PLAY', ch, layer }),
				cgAdd: async () => {},
			},
		},
	}
}
const stopAll = (self) => {
	engine.clearChannelPlaylistState(self, 1)
	engine.clearChannelPlaylistState(self, 2)
}
const loads = (calls, ch) => calls.filter((c) => c.cmd === 'LOADBG' && (ch == null || c.ch === ch)).map((c) => bare(c.clip))
/* resolveSceneClipForAmcp drops the extension (Caspar clip names) */
const bare = (clip) => String(clip).replace(/\.[a-z0-9]+$/i, '').toLowerCase()

test('a PRV recall plays the list end to end and loops — PRV channel only', async () => {
	const sc = look('L1', { playlist: [still('a.png', 0.04), still('b.png', 0.04), still('c.png', 0.04)] })
	LIVE = { 2: { sceneId: sc.id, scene: sc } }
	const { self, calls } = mockSelf()
	engine.setupLayerPlaylists(self, 2, sc, [{ layer: sc.layers[0], pLayer: 10 }])
	assert.ok(self.playlistImageTimers['2:L1-10'], "the start item's timer armed on PRV")
	await wait(400)
	stopAll(self)
	const seq = loads(calls)
	assert.deepEqual(seq.slice(0, 4), ['b', 'c', 'a', 'b'], `every item, then the wrap (${seq})`)
	assert.ok(calls.every((c) => c.ch === 2), 'never a program channel')
})

test('loop off: PRV stops on the last item; manual: PRV arms nothing', async () => {
	const sc = look('L2', { playlistLoop: false, playlist: [still('a.png', 0.04), still('b.png', 0.04)] })
	LIVE = { 2: { sceneId: sc.id, scene: sc } }
	let m = mockSelf()
	engine.setupLayerPlaylists(m.self, 2, sc, [{ layer: sc.layers[0], pLayer: 10 }])
	await wait(250)
	assert.deepEqual(loads(m.calls), ['b'], 'played once, held on the last item')
	stopAll(m.self)
	m = mockSelf()
	const manual = look('L2', { playlistAdvance: 'manual', playlist: sc.layers[0].playlist })
	engine.setupLayerPlaylists(m.self, 2, manual, [{ layer: manual.layers[0], pLayer: 10 }])
	assert.equal(Object.keys(m.self.playlistImageTimers).length, 0, 'manual advance honoured on PRV')
	assert.equal(m.self.playlistActiveIndices['2:L2-10'], 0)
})

test('PGM and PRV of one look: independent chains, different progress, start item untouched', async () => {
	const sc = look('L3', { playlist: [still('a.png', 30), still('b.png', 30), still('c.png', 30)] })
	LIVE = { 1: { sceneId: sc.id, scene: sc }, 2: { sceneId: sc.id, scene: sc } }
	const { self, calls } = mockSelf()
	self.playlistStartIndices = { 'L3-10': 0 }
	engine.setupLayerPlaylists(self, 1, sc, [{ layer: sc.layers[0], pLayer: 10 }])
	engine.setupLayerPlaylists(self, 2, sc, [{ layer: sc.layers[0], pLayer: 10 }])
	const pgmTimer = self.playlistImageTimers['1:L3-10']
	assert.ok(pgmTimer && self.playlistImageTimers['2:L3-10'] && pgmTimer !== self.playlistImageTimers['2:L3-10'], 'one timer per channel')
	// PRV moves on by itself (step / its own timer) — PGM keeps its own position and timer
	assert.equal(await engine.triggerPlaylistAdvance(self, 2, 10, sc, sc.layers[0], 2), true)
	assert.equal(self.playlistActiveIndices['2:L3-10'], 2)
	assert.equal(self.playlistActiveIndices['1:L3-10'], 0, 'PGM is still on its item')
	assert.equal(self.playlistImageTimers['1:L3-10'], pgmTimer, "PGM's timer untouched")
	assert.ok(calls.length > 0 && calls.every((c) => c.ch === 2), "PRV's advance sent nothing to PGM")
	assert.equal(resolvePlaylistStartIndex(self, 'L3', sc.layers[0]), 0, 'a PGM take still starts on the start item')
	// a PGM take wipes the PGM channel's playlist state only (WO-355)
	engine.clearChannelPlaylistState(self, 1)
	assert.equal(self.playlistImageTimers['1:L3-10'], undefined)
	assert.ok(self.playlistImageTimers['2:L3-10'], 'PRV keeps running')
	stopAll(self)
})

test('the OSC pass advances a PRV clip list and preloads the next item on PRV', async () => {
	const sc = look('L4', { playlist: [{ type: 'media', value: 'a.mov' }, { type: 'media', value: 'b.mov' }, { type: 'media', value: 'c.mov' }] })
	LIVE = { 2: { sceneId: sc.id, scene: sc } }
	const { self, calls } = mockSelf()
	self.playlistActiveIndices['2:L4-10'] = 0
	engine.handlePlaylistOscUpdate(self, { channels: { 2: { layers: { 10: { file: { name: 'b.mov', elapsed: 0.1, duration: 4 } } } } } })
	await wait(10)
	assert.equal(self.playlistActiveIndices['2:L4-10'], 1, 'PRV followed its clip')
	assert.deepEqual(calls.map((c) => [c.cmd, c.ch, bare(c.clip), c.opts?.auto]), [['LOADBG', 2, 'c', true]])
	stopAll(self)
})

test('a stale OSC frame (the clip the bank-less PRV layer held) is not read as an advance right after a stage', async () => {
	const sc = look('L8', { playlist: [{ type: 'media', value: 'a.mov' }, { type: 'media', value: 'b.mov' }, { type: 'media', value: 'c.mov' }] })
	LIVE = { 2: { sceneId: sc.id, scene: sc } }
	const { self, calls } = mockSelf()
	engine.setupLayerPlaylists(self, 2, sc, [{ layer: sc.layers[0], pLayer: 10 }])
	const osc = (name) => engine.handlePlaylistOscUpdate(self, { channels: { 2: { layers: { 10: { file: { name, elapsed: 1, duration: 9 } } } } } })
	osc('c.mov') // the previous recall's clip, still reported for a frame
	await wait(10)
	assert.equal(self.playlistActiveIndices['2:L8-10'], 0, 'still on the staged start item')
	assert.deepEqual(loads(calls), ['b'], "only setup's own preload of item 1")
	await wait(450)
	osc('b.mov') // a real advance after the window
	await wait(10)
	assert.equal(self.playlistActiveIndices['2:L8-10'], 1)
	assert.deepEqual(loads(calls), ['b', 'c'])
	stopAll(self)
})

test("a clip → still AUTO hop: the still's file/path wins over the clip's stale file/name, its timer arms", async () => {
	const sc = look('L9', { playlist: [{ type: 'media', value: 'testowe/forest.mov' }, still('testowe/t9.png', 30)] })
	LIVE = { 2: { sceneId: sc.id, scene: sc } }
	const { self } = mockSelf()
	self.playlistActiveIndices['2:L9-10'] = 0
	const file = { name: 'TESTOWE/FOREST', path: '/media/testowe/t9.png' } // what the box OSC state held (05.11)
	engine.handlePlaylistOscUpdate(self, { channels: { 2: { layers: { 10: { file } } } } })
	assert.equal(self.playlistActiveIndices['2:L9-10'], 1, 'the still is on air')
	assert.ok(self.playlistImageTimers['2:L9-10'], "the still's duration timer armed")
	stopAll(self)
})

test("a still's timer hops the list as patched into the live scene since it armed", async () => {
	const sc = look('L5', { playlist: [still('a.png', 0.05), still('b.png', 0.05)] })
	LIVE = { 2: { sceneId: sc.id, scene: sc } }
	const { self, calls } = mockSelf()
	engine.setupLayerPlaylists(self, 2, sc, [{ layer: sc.layers[0], pLayer: 10 }])
	const edited = look('L5', { playlist: [still('a.png', 0.05), still('x.png', 30)] })
	LIVE = { 2: { sceneId: sc.id, scene: edited } } // patchLivePlaylist replaces the live scene
	await wait(150)
	assert.equal(loads(calls)[0], 'x', 'the edited list plays')
	stopAll(self)
})

test("a jump off a still onto a clip clears the still's timer", async () => {
	const sc = look('L6', { playlist: [still('a.png', 30), { type: 'media', value: 'b.mov' }, { type: 'media', value: 'c.mov' }] })
	LIVE = { 1: { sceneId: sc.id, scene: sc } }
	const { self, calls } = mockSelf()
	engine.setupLayerPlaylists(self, 1, sc, [{ layer: sc.layers[0], pLayer: 10 }])
	assert.ok(self.playlistImageTimers['1:L6-10'])
	await engine.triggerPlaylistAdvance(self, 1, 10, sc, sc.layers[0], 1)
	assert.equal(self.playlistImageTimers['1:L6-10'], undefined, 'no stale still timer left to hop again')
	assert.ok(calls.some((c) => c.opts?.auto === true && bare(c.clip) === 'c'), 'the clip chain preloads its next item')
	stopAll(self)
})

test('inspector marker: the item PRV plays when the look is only on PRV; Shader Live resolves PRV too', async () => {
	const sc = look('L7', { playlist: [{ value: 'shaders/sh-one' }, { value: 'shaders/sh-two' }, { value: 'c.mov' }] })
	LIVE = { 2: { sceneId: sc.id, scene: sc } }
	const { handleEdit } = require('../../src/api/routes-playlist-edit')
	const ctx = { config: {}, log: () => {}, playlistStartIndices: { 'L7-10': 0 }, playlistActiveIndices: { '2:L7-10': 1 } }
	const marked = async () => JSON.parse((await handleEdit({ sceneId: 'L7', layer: sc.layers[0], op: 'describe' }, ctx)).body).currentIndex
	assert.equal(await marked(), 1, 'PRV playing item')
	delete ctx.playlistActiveIndices['2:L7-10']
	assert.equal(await marked(), 0, 'no PRV index → the start item')
	ctx.playlistActiveIndices = { '1:L7-10': 2, '2:L7-10': 1 }
	LIVE = { 1: { sceneId: sc.id, scene: sc }, 2: { sceneId: sc.id, scene: sc } }
	assert.equal(await marked(), 2, 'program wins when the look is on air')

	LIVE = { 2: { sceneId: sc.id, scene: { ...sc, layers: [{ ...sc.layers[0], source: { value: 'shaders/sh-one' } }] } } }
	const { liveShaderInstances } = require('../../src/shaderfx/shader-live-instances')
	const inst = liveShaderInstances({ config: {}, playlistActiveIndices: { '2:L7-10': 1 } })
	assert.deepEqual(inst.map((i) => [i.shaderId, i.channel, i.isPrv]), [['sh-two', 2, true]])
})

test('source pins: PRV clear wipes the PRV playlist state; the program-only gate is gone', () => {
	const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8')
	assert.match(read('src/api/routes-scene-preview.js'), /clearChannelPlaylistState\(ctx, previewCh\)/)
	const src = read('src/engine/scene-take-lbg-playlist.js')
	assert.doesNotMatch(src, /if \(!runs\) continue|isPreviewCasparChannel/, 'no preview-channel gate in the playlist engine')
})
