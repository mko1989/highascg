'use strict'

/**
 * WO-601 — look presets recalled on the server (POST /api/scene/look-preset/recall): each screen's look goes through
 * take-look at once; "Take (global)" swaps in the deck default transition (web runLookRecall / takeScenesToProgram).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { handleLookPresetRecall, recallItems } = require('../../src/api/routes-scene-look-preset')
const { handleTakeLook } = require('../../src/api/routes-scene-take-look')

const LOOKS = new Set(['a', 'b'])
const project = (lookPresets, t = { type: 'MIX', duration: 12, tween: 'linear' }) => () => ({ scenes: { lookPresets, globalDefaultTransition: t } })

function rig(lookPresets, opts = {}) {
	const calls = []
	const deps = {
		project: project(lookPresets, opts.transition),
		resolveSceneById: (id) => (LOOKS.has(id) ? { id } : null),
		fps: 50,
		takeLook: async (b) => {
			calls.push(b)
			return opts.fail?.(b) ? { status: 502, body: JSON.stringify({ error: 'boom' }) } : { status: 200, body: '{}' }
		},
	}
	return { calls, deps }
}
const two = [{ id: 'p1', name: 'Both', items: [{ mainIdx: 0, sceneId: 'a' }, { mainIdx: 1, sceneId: 'b' }] }]
const json = (r) => JSON.parse(r.body)

describe('WO-601 look preset recall items (web lookRecallItemsFromPreset)', () => {
	it('keeps items whose look exists, clamps mains, falls back to the legacy single look', () => {
		const exists = (id) => LOOKS.has(id)
		assert.deepEqual(recallItems({ items: [{ mainIdx: 7, sceneId: 'a' }, { mainIdx: 1, sceneId: 'gone' }] }, exists), [{ mainIdx: 0, sceneId: 'a' }])
		assert.deepEqual(recallItems({ items: [{ sceneId: 'gone' }], sceneId: 'b', targetMain: 2 }, exists), [{ mainIdx: 2, sceneId: 'b' }])
		assert.deepEqual(recallItems({ sceneId: 'gone' }, exists), [])
	})
})

describe('WO-601 POST /api/scene/look-preset/recall', () => {
	it('PRV: every item staged on its own screen, no cut, no transition override', async () => {
		const r = rig(two)
		const res = await handleLookPresetRecall({ id: 'p1' }, {}, r.deps)
		assert.equal(res.status, 200)
		const group = r.calls[0].takeGroup // WO-782: one take group, so both screens' PLAYs go out in one batch
		assert.equal(group.size, 2)
		assert.deepEqual(r.calls, [
			{ sceneId: 'a', mainIdx: 0, target: 'preview', forceCut: false, takeGroup: group },
			{ sceneId: 'b', mainIdx: 1, target: 'preview', forceCut: false, takeGroup: group },
		])
		assert.equal(json(res).ok, true)
	})
	it('Take (global): the deck default with its auto duration resolved at 50 fps', async () => {
		const r = rig(two)
		await handleLookPresetRecall({ id: 'p1', target: 'program', useGlobalTransition: true }, {}, r.deps)
		assert.deepEqual(r.calls.map((c) => c.transitionOverride), Array(2).fill({ type: 'MIX', tween: 'linear', duration: 25 }))
	})
	it('Cut ignores the global transition; plain Take keeps each look\'s own', async () => {
		const r = rig(two)
		await handleLookPresetRecall({ id: 'p1', target: 'program', forceCut: true, useGlobalTransition: true }, {}, r.deps)
		await handleLookPresetRecall({ id: 'p1', target: 'program' }, {}, r.deps)
		assert.deepEqual(r.calls.map((c) => [c.forceCut, 'transitionOverride' in c]), [[true, false], [true, false], [false, false], [false, false]])
	})
	it('the live deck wins over the autosave; unknown id 404, no look left 409, all screens failing 502', async () => {
		const r = rig([])
		const ctx = { sceneDeck: { lookPresets: two } }
		assert.equal((await handleLookPresetRecall({ id: 'p1' }, ctx, r.deps)).status, 200)
		assert.equal((await handleLookPresetRecall({ id: 'p1' }, {}, r.deps)).status, 404)
		assert.equal((await handleLookPresetRecall({ id: 'x' }, { sceneDeck: { lookPresets: [{ id: 'x', items: [{ sceneId: 'gone' }] }] } }, r.deps)).status, 409)
		const bad = rig(two, { fail: () => true })
		const res = await handleLookPresetRecall({ id: 'p1', target: 'program' }, {}, bad.deps)
		assert.equal(res.status, 502)
		assert.deepEqual(json(res).items.map((i) => i.error), ['boom', 'boom'])
		const half = rig(two, { fail: (b) => b.mainIdx === 1 })
		const r2 = await handleLookPresetRecall({ id: 'p1', target: 'program' }, {}, half.deps)
		assert.equal(r2.status, 200)
		assert.equal(json(r2).ok, false, 'one screen failed')
	})
})

describe('WO-601 take-look transitionOverride', () => {
	const deps = (map, sink) => ({
		resolveSceneById: () => ({ id: 'a', name: 'A', layers: [], defaultTransition: { type: 'CUT', duration: 0 } }),
		getChannelMap: () => map,
		withBorder: (s) => s,
		take: async (b) => (sink.push(b), { status: 200, body: '{}' }),
	})
	const over = { type: 'MIX', duration: 25, tween: 'linear' }
	it('replaces the look transition on program; pgm-only maps it the web way (MIX → + Animate)', async () => {
		const sink = []
		await handleTakeLook({ sceneId: 'a', target: 'program', transitionOverride: over }, {}, deps({ programChannels: [1], previewChannels: [2] }, sink))
		await handleTakeLook({ sceneId: 'a', target: 'program', transitionOverride: over }, {}, deps({ programChannels: [1], previewChannels: [] }, sink))
		await handleTakeLook({ sceneId: 'a', target: 'preview', transitionOverride: over }, {}, deps({ programChannels: [1], previewChannels: [2] }, sink))
		assert.deepEqual(sink[0].incomingScene.defaultTransition, over)
		assert.match(sink[1].incomingScene.defaultTransition.type, /ANIMATE/i)
		assert.notDeepEqual(sink[2].incomingScene.defaultTransition, over, 'PRV keeps the look transition')
	})
})
