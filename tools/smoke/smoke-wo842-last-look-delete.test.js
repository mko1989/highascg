'use strict'

/**
 * WO-842 4h (client half) — deleting the LAST look sends `allowEmpty: true` with the deck sync, so the server's
 * anti-wipe guard (project-scenes.js mergeDeckSyncIntoProject) lets the deletion persist. A blank/stale deck (never
 * emptied by a delete, or reloaded since) must not carry it.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')

describe('WO-842 4h last look delete', () => {
	it('web buildSceneDeckPayload marks only a delete-emptied deck', async () => {
		const { buildSceneDeckPayload } = await import('../../client/lib/app-scene-deck.js')
		const base = { previewSceneId: null, layerPresets: [], lookPresets: [] }
		assert.equal(buildSceneDeckPayload({ ...base, scenes: [], deckEmptiedByDelete: true }).allowEmpty, true)
		assert.equal(buildSceneDeckPayload({ ...base, scenes: [] }).allowEmpty, undefined, 'blank deck: no override')
		assert.equal(
			buildSceneDeckPayload({ ...base, scenes: [{ id: 'a', name: 'A' }], deckEmptiedByDelete: true }).allowEmpty,
			undefined,
			'a non-empty deck never carries it',
		)
	})

	it('web scene-state sets the flag on the last removeScene and clears it on load/reset', () => {
		const src = fs.readFileSync(path.join(ROOT, 'client/lib/scene-state.js'), 'utf8')
		assert.match(src, /if \(!this\.scenes\.length\) this\.deckEmptiedByDelete = true/)
		assert.match(src, /this\.scenes = \[\]; this\.deckEmptiedByDelete = false;/)
		const load = fs.readFileSync(path.join(ROOT, 'client/lib/scene-state-persistence-logic.js'), 'utf8')
		assert.match(load, /state\.deckEmptiedByDelete = false/)
	})

	it('Godot: delete_look flags the empty deck, send_deck_sync adds allowEmpty, reset() clears it', () => {
		const deck = fs.readFileSync(path.join(ROOT, 'godot/client/features/live/deck_view.gd'), 'utf8')
		assert.match(deck, /ProjectSync\.deck_emptied_by_delete = true/)
		const sync = fs.readFileSync(path.join(ROOT, 'godot/client/core/project_sync.gd'), 'utf8')
		assert.match(sync, /if deck_emptied_by_delete and \(data\.get\("looks", \[\]\) as Array\)\.is_empty\(\):\n\t\tdata\["allowEmpty"\] = true/)
		assert.match(sync, /func reset\(\) -> void:[\s\S]*?deck_emptied_by_delete = false/)
	})
})
