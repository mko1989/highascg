'use strict'

/**
 * WO-603 — the Playlists panel's rules run in node: GET /api/playlist/state items carry `timeless` / `missing`, each
 * playlist `timelessSecs`; POST /api/playlist/control action:'set_timeless' plans "Set all" from the look and patches
 * the running engine's copy. Parity with the web modules it replaces (client/lib/playlist-timeless.js,
 * client/lib/media-exists.js).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const panel = require('../../src/api/routes-playlist-panel')
const { buildMediaIndex, clipMissing } = require('../../src/media/media-exists')
const liveSceneState = require('../../src/state/live-scene-state')

const ROOT = path.join(__dirname, '../..')
const ITEMS = [
	{ value: 'clips/intro.mov', type: 'media' },
	{ value: 'stills/logo.png', type: 'media', duration: 7 },
	{ value: 'shaders/plasma', type: 'shader' },
	{ value: 'clips/MISSING_ONE', type: 'media' },
	{ value: 'route://3', type: 'route' },
	{ value: 'audio/bed.wav', type: 'media' },
]
const MEDIA = [{ id: 'CLIPS/INTRO' }, { id: 'stills/logo' }, { id: 'AUDIO/BED' }]

describe('WO-603 playlist panel rules — parity with the web modules', () => {
	it('timeless + timelessSecsOf match client/lib/playlist-timeless.js', async () => {
		const web = await import(pathToFileURL(path.join(ROOT, 'client/lib/playlist-timeless.js')).href)
		const rows = panel.panelItems(ITEMS, buildMediaIndex(MEDIA))
		assert.deepEqual(
			rows.map((r) => r.timeless),
			ITEMS.map((it) => web.isTimelessItem(it))
		)
		assert.equal(panel.timelessSecsOf(ITEMS), web.timelessSecsOf(ITEMS))
		assert.equal(panel.timelessSecsOf([{ value: 'a.mov' }]), 20)
	})

	it('missing matches web clipMissing (case-insensitive, extension-stripped, non-media never flagged)', () => {
		const idx = buildMediaIndex(MEDIA)
		const rows = panel.panelItems(ITEMS, idx)
		assert.deepEqual(
			rows.map((r) => r.missing),
			[false, false, false, true, false, false]
		)
		assert.equal(clipMissing('elsewhere/intro.mp4', idx), false, 'basename fallback')
		assert.equal(clipMissing('clips/x.mov', buildMediaIndex([])), null, 'no media list → not judged')
	})

	it('planTimeless sets only timeless items, clamps, refuses non-positive', () => {
		const r = panel.planTimeless(ITEMS, 12)
		assert.equal(r.touched, 4, 'png, shader, extensionless clip, route — the engine rule')
		assert.deepEqual(
			r.playlist.map((it) => it.duration),
			[undefined, 12, 12, 12, 12, undefined]
		)
		assert.equal(panel.planTimeless(ITEMS, 999999).secs, 86400)
		assert.ok(panel.planTimeless(ITEMS, 0).error)
		assert.ok(panel.planTimeless(ITEMS, 'x').error)
	})
})

describe('WO-603 set_timeless — planned from the look, pushed to the live copy', () => {
	it('returns the new playlist and patches a channel where the look is live', async () => {
		const scene = { id: 'look1', layers: [{ layerNumber: 10, sourceMode: 'list', playlist: ITEMS }] }
		await liveSceneState.setChannel(1, { sceneId: 'look1', scene })
		const ctx = { _wsBroadcast: () => {} }
		const r = await panel.setTimeless({ sceneId: 'look1', layerNumber: 10, secs: 9 }, ctx, { resolveScene: () => scene })
		assert.equal(r.status, 200)
		assert.equal(r.body.touched, 4)
		assert.equal(r.body.patched, 1)
		const live = liveSceneState.getChannel(1).scene.layers[0].playlist
		assert.equal(live[1].duration, 9)
		assert.equal(ITEMS[1].duration, 7, 'the look itself is not mutated (the client stores the result)')
		assert.equal(
			(await panel.setTimeless({ sceneId: 'look1', layerNumber: 11, secs: 9 }, ctx, { resolveScene: () => scene })).status,
			404
		)
		assert.equal((await panel.setTimeless({ sceneId: '', layerNumber: 10 }, ctx)).status, 400)
		await liveSceneState.clearChannel(1)
	})

	it('the control route dispatches set_timeless; state rows come from the panel module', () => {
		const src = require('node:fs').readFileSync(path.join(ROOT, 'src/api/routes-playlist.js'), 'utf8')
		assert.match(src, /if \(action === 'set_timeless'\) \{/)
		assert.match(src, /items: panel\.panelItems\(layer\.playlist, mediaIndex\)/)
		assert.match(src, /const patched = await panel\.patchLivePlaylist\(ctx, sceneId, layerNumber, items\)/)
	})
})
