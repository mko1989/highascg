'use strict'

/**
 * WO-1029 — a look belongs to a destination, not to a screen number (src/config/dest-scope.js,
 * src/engine/project-dest-scope.js). Box B (10.11): two destinations deleted, the wall moved from index 2 to 1, its
 * looks still said mainScope "2" and a take without mainIdx answered 400 "no program channel for main 2".
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const DS = require('../../src/config/dest-scope')
const PDS = require('../../src/engine/project-dest-scope')
const { normalizeScreenDestinations } = require('../../src/config/screen-destinations')
const { handleTakeLook } = require('../../src/api/routes-scene-take-look')
const { recallItems } = require('../../src/api/routes-scene-look-preset')
const { handleRescopeLooks } = require('../../src/api/routes-project-rescope')
const { showOf, diff, apply } = require('../../src/cluster/show-merge')

const dest = (id, idx, mode = 'pgm_prv') => ({ id, label: id, mode, mainScreenIndex: idx })
const LIST = [dest('dst_gui', 0, 'operator_gui'), dest('dst_led', 0), dest('dst_zoom', 1), dest('dst_wall', 2), dest('dst_stream', 3)]
const cfgOf = (list) => ({ screenDestinations: normalizeScreenDestinations({ destinations: list }) })
const without = (list, ...ids) => list.filter((d) => !ids.includes(d.id))
const look = (id, mainScope, extra = {}) => ({ id, name: id, mainScope, layers: [], ...extra })

function project(list) {
	return {
		name: 'show',
		hardwareConfig: { screenDestinations: { destinations: list } },
		scenes: {
			scenes: [look('led', '0'), look('zoom', '1'), look('wall', '2'), look('stream', '3'), look('global', 'all')],
			lookPresets: [{ id: 'p', name: 'P', targetMain: 2, sceneId: 'wall', items: [{ mainIdx: 0, sceneId: 'led' }, { mainIdx: 2, sceneId: 'wall' }] }],
		},
		timelines: { timelines: [{ id: 't', sendTo: { preview: false, program: true, screenIdx: 2 }, layers: [{ id: 'l1', screenIdx: 3 }, { id: 'l2' }] }] },
	}
}
const byId = (p, id) => p.scenes.scenes.find((s) => s.id === id)

describe('WO-1029 dest scope — rules', () => {
	it('screen rows: the first main-bus destination of each index; null without a list (legacy box)', () => {
		assert.deepEqual(DS.screenRows(cfgOf(LIST)).map((r) => [r.idx, r.destId]), [[0, 'dst_led'], [1, 'dst_zoom'], [2, 'dst_wall'], [3, 'dst_stream']])
		assert.equal(DS.screenRows({}), null)
	})

	it('old project without ids: stamped on load from its own list, indices unchanged (identical behaviour)', () => {
		const p = project(LIST)
		PDS.adaptOnRead(p, cfgOf(LIST))
		assert.deepEqual(p.scenes.scenes.map((s) => [s.mainScope, s.destScope]), [['0', 'dst_led'], ['1', 'dst_zoom'], ['2', 'dst_wall'], ['3', 'dst_stream'], ['all', 'all']])
		assert.equal(p.scenes.lookPresets[0].items[1].destId, 'dst_wall')
		assert.equal(p.scenes.lookPresets[0].destId, 'dst_wall')
		assert.equal(p.timelines.timelines[0].sendTo.destId, 'dst_wall')
		assert.equal(p.timelines.timelines[0].layers[0].destId, 'dst_stream')
		assert.equal('destId' in p.timelines.timelines[0].layers[1], false, 'a layer with no screen pin stays unpinned')
		const rows = DS.screenRows(cfgOf(LIST))
		for (const s of p.scenes.scenes.slice(0, 4)) assert.equal(DS.screenOf(s, rows), parseInt(s.mainScope, 10))
	})

	it('deleting destinations in the middle: the others keep their screen, the deleted one has no screen', () => {
		const p = project(LIST)
		const before = DS.screenRows(cfgOf(LIST))
		const after = DS.screenRows(cfgOf(without(LIST, 'dst_zoom', 'dst_stream')))
		const st = DS.reconcileProject(p, { stampWith: before, indexWith: after })
		assert.equal(st.changed, true)
		assert.equal(byId(p, 'wall').mainScope, '1', 'the wall slid to index 1 — its look follows')
		assert.equal(byId(p, 'wall').destScope, 'dst_wall')
		assert.equal(byId(p, 'led').mainScope, '0')
		assert.equal(DS.screenOf(byId(p, 'zoom'), after), null, 'zoom is gone: unscoped, not attached to the wall')
		assert.equal(DS.resolveScope(byId(p, 'stream'), after).unscoped, true)
		assert.equal(DS.screenOf(byId(p, 'global'), after), 'all')
		assert.equal(p.scenes.lookPresets[0].items[1].mainIdx, 1)
		assert.equal(p.timelines.timelines[0].sendTo.screenIdx, 1)
	})

	it('reorder: looks follow their destination to its new index', () => {
		const p = project(LIST)
		const before = DS.screenRows(cfgOf(LIST))
		const swapped = LIST.map((d) => (d.id === 'dst_led' ? { ...d, mainScreenIndex: 2 } : d.id === 'dst_wall' ? { ...d, mainScreenIndex: 0 } : d))
		DS.reconcileProject(p, { stampWith: before, indexWith: DS.screenRows(cfgOf(swapped)) })
		assert.equal(byId(p, 'led').mainScope, '2')
		assert.equal(byId(p, 'wall').mainScope, '0')
	})

	it('data already shifted by an earlier delete: an index with no screen is stamped unscoped, never guessed', () => {
		const p = project(LIST)
		const st = DS.reconcileProject(p, { stampWith: DS.screenRows(cfgOf(without(LIST, 'dst_zoom', 'dst_stream'))) })
		assert.equal(byId(p, 'wall').destScope, 'unscoped')
		assert.equal(byId(p, 'stream').destScope, 'unscoped')
		assert.equal(byId(p, 'zoom').destScope, 'dst_wall', 'index 1 names the wall today: kept where the deck shows it')
		assert.equal(st.unscoped >= 2, true)
	})

	it('preset items resolve by destination; an item whose destination is gone has no screen', () => {
		const rows = DS.screenRows(cfgOf(without(LIST, 'dst_zoom')))
		const items = recallItems({ items: [{ mainIdx: 2, destId: 'dst_wall', sceneId: 'a' }, { mainIdx: 1, destId: 'dst_zoom', sceneId: 'b' }] }, () => true, rows)
		assert.deepEqual(items.map((i) => i.mainIdx), [1, null])
	})
})

describe('WO-1029 take-look without mainIdx resolves the look by destination', () => {
	const MAP = { screenCount: 2, programChannels: [2, 4], previewChannels: [3, 5], programResolutions: [{ fps: 50 }, { fps: 50 }] }
	const ctx = { config: cfgOf(without(LIST, 'dst_zoom', 'dst_stream')) }
	function deps(scene, calls) {
		return {
			cluster: null,
			resolveSceneById: () => scene,
			getChannelMap: () => MAP,
			withBorder: (s) => s,
			take: async (b) => {
				calls.push(b)
				return { status: 200, headers: {}, body: '{"ok":true}' }
			},
		}
	}

	it('a wall look ("2", scoped to the wall now at index 1) lands on the wall', async () => {
		const calls = []
		const res = await handleTakeLook(JSON.stringify({ sceneId: 'w' }), ctx, deps(look('w', '2', { destScope: 'dst_wall' }), calls))
		assert.equal(res.status, 200)
		assert.equal(calls[0].channel, 4)
	})

	it('a look whose destination is gone → 409 NO_SCREEN; with mainIdx it is taken there', async () => {
		const calls = []
		const gone = look('z', '1', { destScope: 'dst_zoom' })
		const res = await handleTakeLook(JSON.stringify({ sceneId: 'z' }), ctx, deps(gone, calls))
		assert.equal(res.status, 409)
		assert.equal(JSON.parse(res.body).code, 'NO_SCREEN')
		assert.equal(calls.length, 0, 'never put on the screen that sits at its old index')
		const ok = await handleTakeLook(JSON.stringify({ sceneId: 'z', mainIdx: 0 }), ctx, deps(gone, calls))
		assert.equal(ok.status, 200)
		assert.equal(calls[0].channel, 2)
	})

	it('old data without ids: by index when that screen exists (byte-identical), else 409', async () => {
		const calls = []
		assert.equal((await handleTakeLook(JSON.stringify({ sceneId: 'x' }), ctx, deps(look('x', '1'), calls))).status, 200)
		assert.equal(calls[0].channel, 4)
		assert.equal((await handleTakeLook(JSON.stringify({ sceneId: 'y' }), ctx, deps(look('y', '3'), calls))).status, 409)
		// a box with no destination list: exactly as before
		const legacy = []
		await handleTakeLook(JSON.stringify({ sceneId: 'y' }), {}, deps(look('y', '1'), legacy))
		assert.equal(legacy[0].channel, 4)
	})
})

describe('WO-1029 repair + shared show', () => {
	it('POST /api/project/rescope-looks { from: "2", to: wall } attaches the unscoped "2" looks only', async () => {
		const ctx = { config: cfgOf(without(LIST, 'dst_zoom', 'dst_stream')), sceneDeck: { sceneSnapshots: [] } }
		const p = project(LIST)
		DS.reconcileProject(p, { stampWith: DS.screenRows(ctx.config) }) // the live show: shifted, wall looks unscoped
		ctx.sceneDeck.sceneSnapshots = structuredClone(p.scenes.scenes)
		let saved = null
		const res = await handleRescopeLooks(JSON.stringify({ from: '2', to: 'dst_wall' }), ctx, { project: () => p, persist: (x) => (saved = x) })
		assert.equal(res.status, 200)
		assert.deepEqual(JSON.parse(res.body).ids, ['wall'])
		assert.equal(byId(saved, 'wall').mainScope, '1')
		assert.equal(byId(saved, 'stream').destScope, 'unscoped', '"3" untouched')
		assert.equal(ctx.sceneDeck.sceneSnapshots.find((s) => s.id === 'wall').destScope, 'dst_wall')
		const bad = await handleRescopeLooks(JSON.stringify({ from: 'unscoped', to: 'dst_zoom' }), ctx, { project: () => p, persist: () => {} })
		assert.equal(bad.status, 404)
	})

	it('the shared show carries destScope; an older peer that knows nothing of it round-trips it unchanged', () => {
		const p = project(LIST)
		PDS.adaptOnRead(p, cfgOf(LIST))
		const base = showOf(p)
		assert.equal(base.scenes.scenes[2].destScope, 'dst_wall')
		const theirs = structuredClone(base)
		theirs.scenes.scenes[2].name = 'wall renamed' // an old peer edits a look and keeps the unknown key
		const merged = apply(base, diff(base, theirs)).doc
		assert.equal(merged.scenes.scenes[2].destScope, 'dst_wall')
		assert.equal(merged.scenes.scenes[2].name, 'wall renamed')
		// both servers stamp the same shared list → identical stamps, no merge conflict
		const q = project(LIST)
		PDS.adaptOnRead(q, cfgOf(LIST))
		assert.deepEqual(diff(showOf(p), showOf(q)), [])
	})
})

describe('WO-1029 the destination commit point (POST /api/device-view removeDestination)', () => {
	it('deleting a destination in the middle re-indexes the stored looks and announces the list', async () => {
		const store = require('../../src/engine/project-store')
		const persistence = require('../../src/utils/persistence')
		const scheme = require('../../src/engine/project-channel-scheme')
		const ctx = { config: cfgOf(LIST), log: () => {}, persistence }
		const sent = []
		ctx._wsBroadcast = (type, data) => sent.push([type, data?.path])
		scheme.setChannelSchemeConfigSource(() => ctx.config)
		try {
			const p = project(LIST)
			delete p.hardwareConfig // as an autosave before this build: ids come from the live list
			store.writeProjectFile('show', p)
			store.setActiveSlug(persistence, 'show')
			const { handlePost } = require('../../src/api/routes-device-view')
			const res = await handlePost(JSON.stringify({ removeDestination: { id: 'dst_zoom' } }), ctx)
			assert.equal(res.status, 200)
			const raw = JSON.parse(require('fs').readFileSync(require('path').join(store.projectsDir(), 'show.json'), 'utf8'))
			const w = raw.scenes.scenes.find((s) => s.id === 'wall')
			assert.deepEqual([w.mainScope, w.destScope], ['1', 'dst_wall'], 'the wall look moved with the wall, on disk')
			assert.equal(raw.scenes.scenes.find((s) => s.id === 'zoom').destScope, 'dst_zoom')
			assert.ok(sent.some(([t, path]) => t === 'change' && path === 'screenDestinations'))
		} finally {
			scheme.setChannelSchemeConfigSource(null)
		}
	})
})
