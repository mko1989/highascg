'use strict'

/**
 * WO-603 slice 6 — the look-layer playlist editor's mutations run in node (POST /api/playlist/edit): the web
 * inspector-layer-playlist.js rules (item building, single↔list, reorder / delete keep `source` = first item,
 * timeless-only durations, settings) plus the rows the inspector shows (⚠ missing, clip length) and Next ▶ on the
 * program channel where the look is live.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { planPlaylistEdit, flattenSources, showsNext } = require('../../src/engine/playlist-edit')
const { buildDurationIndex, mediaDurationMs, formatClipDuration } = require('../../src/media/media-duration')
const routes = require('../../src/api/routes-playlist-edit')
const liveSceneState = require('../../src/state/live-scene-state')

const still = { type: 'media', value: 'stills/logo.png', label: 'stills/logo.png' }
const clip = { type: 'media', value: 'clips/intro.mov', label: 'clips/intro.mov' }
const tpl = { type: 'template', value: 'lower-thirds/name', label: 'Name' }

describe('WO-603 planPlaylistEdit — the web inspector-layer-playlist.js mutations', () => {
	it('add: a multi payload appends in order; stills become images with the playlist timeless length; first add sets source', () => {
		const r = planPlaylistEdit({ playlist: [] }, 'add', {
			items: { type: 'multi', items: [still, clip, { type: 'effect', value: 'blur' }, tpl] },
		})
		const pl = r.patch.playlist
		assert.deepEqual(
			pl.map((it) => [it.type, it.value, it.duration]),
			[
				['image', 'stills/logo.png', 20],
				['media', 'clips/intro.mov', undefined],
				['template', 'lower-thirds/name', 20],
			]
		)
		assert.ok(pl.every((it) => /^pl_\d+_/.test(it.id)) && new Set(pl.map((it) => it.id)).size === 3, 'unique pl_ ids')
		assert.deepEqual(r.patch.source, { type: 'image', value: 'stills/logo.png', label: 'stills/logo.png' })
		const more = planPlaylistEdit({ playlist: [{ ...pl[0], duration: 7 }] }, 'add', { items: still })
		assert.equal(more.patch.playlist[1].duration, 7, 'timeless length follows the playlist (timelessSecsOf)')
		assert.equal(more.patch.source, undefined, 'source only changes on the first add')
		assert.ok(planPlaylistEdit({}, 'add', { items: { type: 'effect', value: 'x' } }).error)
		assert.equal(flattenSources(clip).length, 1)
	})

	it('mode: list seeds the single source; single takes the first item back', () => {
		const seeded = planPlaylistEdit({ source: still, playlist: [] }, 'mode', { mode: 'list' })
		assert.equal(seeded.patch.sourceMode, 'list')
		assert.deepEqual(
			seeded.patch.playlist.map((it) => [it.type, it.value, it.duration]),
			[['media', 'stills/logo.png', 20]]
		)
		const movie = planPlaylistEdit({ source: clip }, 'mode', { mode: 'list' })
		assert.equal(movie.patch.playlist[0].duration, undefined, 'WO-370: no duration stamped on a movie')
		const back = planPlaylistEdit({ playlist: [clip, still] }, 'mode', { mode: 'single' })
		assert.deepEqual(back.patch, {
			sourceMode: 'single',
			source: { type: 'media', value: 'clips/intro.mov', label: 'clips/intro.mov' },
		})
		assert.ok(planPlaylistEdit({}, 'mode', { mode: 'x' }).error)
	})

	it('move / remove keep source = the first item; item edits; settings; timeless', () => {
		const pl = [
			{ ...still, id: 'a' },
			{ ...clip, id: 'b' },
			{ ...tpl, id: 'c' },
		]
		const mv = planPlaylistEdit({ playlist: pl }, 'move', { from: 2, to: 0 })
		assert.deepEqual(
			mv.patch.playlist.map((it) => it.id),
			['c', 'a', 'b']
		)
		assert.equal(mv.patch.source.value, 'lower-thirds/name')
		assert.equal(planPlaylistEdit({ playlist: pl }, 'move', { from: 1, to: 2 }).patch.source, undefined)
		assert.deepEqual(planPlaylistEdit({ playlist: pl }, 'remove', { index: 0 }).patch.source.value, 'clips/intro.mov')
		assert.equal(planPlaylistEdit({ playlist: [pl[0]] }, 'remove', { index: 0 }).patch.source, null)
		assert.equal(planPlaylistEdit({ playlist: pl }, 'item', { index: 0, duration: 4.6 }).patch.playlist[0].duration, 5)
		assert.ok(
			planPlaylistEdit({ playlist: pl }, 'item', { index: 1, duration: 4 }).error,
			'timed media has its own length'
		)
		assert.equal(planPlaylistEdit({ playlist: pl }, 'item', { index: 1, loop: true }).patch.playlist[1].loop, true)
		const st = planPlaylistEdit({ playlistTransition: { type: 'MIX', duration: 12, tween: 'linear' } }, 'settings', {
			advance: 'manual',
			loop: false,
			transition: { type: 'wipe', duration: 25 },
		})
		assert.deepEqual(st.patch, {
			playlistAdvance: 'manual',
			playlistLoop: false,
			playlistTransition: { type: 'WIPE', duration: 25, tween: 'linear' },
		})
		assert.equal(st.playlistChanged, false, 'settings never touch the live playlist (web)')
		assert.ok(planPlaylistEdit({}, 'settings', { transition: { type: 'PUSH' } }).error)
		const tl = planPlaylistEdit({ playlist: pl }, 'timeless', { secs: 9 })
		assert.deepEqual([tl.touched, tl.patch.playlist.map((it) => it.duration)], [2, [9, undefined, 9]])
		assert.ok(
			showsNext({ playlistAdvance: 'manual' }) && showsNext({ playlist: [{ loop: true }] }) && !showsNext({ playlist: [] })
		)
	})
})

describe('WO-603 media-duration — server copy of client/lib/media-duration.js', () => {
	it('probed rows win, sub-1-fps CINF lengths are refused, basename fallback, format', () => {
		const idx = buildDurationIndex([
			{ id: 'CLIPS/INTRO', durationMs: 999999, fps: 0.5 },
			{ id: 'clips/intro.mov', durationMs: 53000, codec: 'hap' },
			{ id: 'other/long', durationMs: 5046000 },
		])
		assert.equal(mediaDurationMs('clips/intro.mov', idx), 53000)
		assert.equal(mediaDurationMs('x/long.mp4', idx), 5046000)
		assert.equal(mediaDurationMs('nope.mov', idx), null)
		assert.deepEqual(
			[formatClipDuration(53000), formatClipDuration(5046000), formatClipDuration(null)],
			['0:53', '1:24:06', '']
		)
	})
})

describe('WO-603 POST /api/playlist/edit + /edit/next', () => {
	const ctx = {
		_wsBroadcast: () => {},
		state: {
			getState: () => ({ media: [{ id: 'clips/intro.mov', durationMs: 53000, codec: 'hap' }, { id: 'stills/logo' }] }),
		},
		config: {},
	}

	it('returns the patch + editor rows and pushes a changed playlist into the live copy', async () => {
		const layer = { layerNumber: 10, sourceMode: 'list', playlist: [{ ...clip, id: 'a' }] }
		await liveSceneState.setChannel(1, { sceneId: 'L', scene: { id: 'L', layers: [layer] } })
		const r = await routes.handleEdit(
			{ sceneId: 'L', layer, op: 'add', items: { type: 'multi', items: [still, { type: 'media', value: 'gone.png' }] } },
			ctx
		)
		const b = JSON.parse(r.body)
		assert.equal(r.status, 200, r.body)
		assert.equal(b.patch.playlist.length, 3)
		assert.deepEqual(
			b.rows.map((x) => [x.name, x.timeless, x.missing, x.duration, x.length]),
			[
				['intro.mov', false, false, null, '0:53'],
				['logo.png', true, false, 20, ''],
				['gone.png', true, true, 20, ''],
			]
		)
		assert.equal(b.patched, 1)
		assert.equal(liveSceneState.getChannel(1).scene.layers[0].playlist.length, 3)
		const s = JSON.parse((await routes.handleEdit({ sceneId: 'L', layer, op: 'settings', advance: 'manual' }, ctx)).body)
		assert.deepEqual([s.patched, s.showsNext], [0, true])
		assert.equal((await routes.handleEdit({ layer, op: 'bogus' }, ctx)).status, 400)
		assert.equal((await routes.handleEdit({ op: 'describe' }, ctx)).status, 400)
		await liveSceneState.clearChannel(1)
	})

	it('Next resolves the program channel where the look is live; 409 when it is not', async () => {
		const r = await routes.handleNext({ sceneId: 'L', layerNumber: 10 }, ctx)
		assert.equal(r.status, 409)
		await liveSceneState.setChannel(2, { sceneId: 'L', scene: { id: 'L', layers: [] } })
		assert.equal(routes.liveProgramChannel(ctx, 'L'), null, 'a PRV recall (default map: ch2) is not live')
		await liveSceneState.setChannel(1, { sceneId: 'L', scene: { id: 'L', layers: [] } })
		assert.equal(routes.liveProgramChannel(ctx, 'L'), 1)
		await liveSceneState.clearChannel(1)
		await liveSceneState.clearChannel(2)
	})
})
