'use strict'

/**
 * WO-781 — look presets as on a Barco E2: a destination saved while empty stays in the preset, and a recall leaves it
 * empty again (PRV → clear that screen's PRV, PGM → fade it to black; a cut = 0 frames) while the other destinations
 * take their looks in the same batch. The Godot side (destinations, strip, deck toggles) is pinned here by source.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { handleLookPresetRecall, recallItems } = require('../../src/api/routes-scene-look-preset')

const GD = path.join(__dirname, '../../godot/client/features/live')
const read = (f) => fs.readFileSync(path.join(GD, f), 'utf8')

const preset = [
	{
		id: 'p',
		name: 'E2',
		items: [
			{ mainIdx: 0, sceneId: 'a' },
			{ mainIdx: 1, sceneId: '', empty: true },
		],
	},
]

function rig() {
	const takes = []
	const clears = []
	const deps = {
		project: () => ({ scenes: { lookPresets: preset } }),
		resolveSceneById: (id) => (id === 'a' ? { id } : null),
		fps: 50,
		takeLook: async (b) => (takes.push(b), { status: 200, body: '{}' }),
		clearDestination: async (m, target, cut) => (clears.push({ m, target, cut }), { status: 200, body: '{}' }),
	}
	return { takes, clears, deps }
}

describe('WO-781 empty destinations', () => {
	it('recallItems keeps a destination saved empty; a deleted look still drops out', () => {
		const exists = (id) => id === 'a'
		assert.deepEqual(recallItems(preset[0], exists), [
			{ mainIdx: 0, sceneId: 'a' },
			{ mainIdx: 1, sceneId: '', empty: true },
		])
		assert.deepEqual(
			recallItems({ items: [{ mainIdx: 1, sceneId: '' }] }, exists),
			[],
			'no empty flag = not a destination'
		)
		assert.deepEqual(
			recallItems({ items: [{ mainIdx: 2, empty: true }] }, exists),
			[{ mainIdx: 2, sceneId: '', empty: true }],
			'empty only is a preset'
		)
	})

	it('PRV recall: look to screen 1, screen 2 cleared', async () => {
		const r = rig()
		const res = await handleLookPresetRecall({ id: 'p' }, {}, r.deps)
		assert.equal(res.status, 200)
		assert.deepEqual(
			r.takes.map((t) => [t.sceneId, t.mainIdx, t.target]),
			[['a', 0, 'preview']]
		)
		assert.deepEqual(r.clears, [{ m: 1, target: 'preview', cut: false }])
		assert.equal(JSON.parse(res.body).items.length, 2)
	})

	it('PGM recall fades the empty destination; Cut cuts it', async () => {
		const r = rig()
		await handleLookPresetRecall({ id: 'p', target: 'program' }, {}, r.deps)
		await handleLookPresetRecall({ id: 'p', target: 'program', forceCut: true }, {}, r.deps)
		assert.deepEqual(r.clears, [
			{ m: 1, target: 'program', cut: false },
			{ m: 1, target: 'program', cut: true },
		])
	})

	it('Godot: titles toggle destinations, saves keep empty ones, the card section toggles Looks / Presets', () => {
		assert.match(read('deck_head.gd'), /dest\.toggled\.connect\(func\(_p: bool\) -> void: Destinations\.toggle\(main\)\)/)
		assert.match(
			read('look_preset_page.gd'),
			/M\.capture_items\(source, Destinations\.selected\(\), true_buses\(\), .*, true\)/
		)
		assert.match(read('look_preset_page.gd'), /Destinations\.set_only\(M\.mains_of\(p\)\)/)
		assert.match(read('look_preset_strip.gd'), /var bus: Dictionary = page\.true_buses\(\)/)
		const tab = read('live_tab.gd')
		assert.match(tab, /for k in \["looks", "presets"\]:/)
		assert.match(tab, /cfg\.set_value\("live", "show_" \+ kind, on\)/)
		assert.match(read('deck_view.gd'), /for s in \(looks if show_looks else \[\]\):/)
	})
})
